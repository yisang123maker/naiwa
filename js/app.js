/* ============================================================
   奶蛙凹造型 · app.js
   ============================================================ */

import { extractPoints, rankAll, prepTemplate, toBody, fromBody, gauge, starsOf, KEYS } from "./similarity.js";
import { PoseEngine, openCamera } from "./pose-engine.js";
import { Projector, drawSkeleton, drawFrogSkeleton, colorFor } from "./skeleton.js";
import * as fx from "./fx.js";
import { downloadReport } from "./report.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------------------------------------------------------------- */
/* 状态                                                              */
/* ---------------------------------------------------------------- */
const S = {
  poses: [],
  templates: [],
  mode: "boot",          // boot | live | counting | capture | result
  lockedId: null,
  pts: null,
  lm: null,
  rank: [],
  score: 0,
  bestStreakId: null,
  streak: 0,
  combo: 0,
  energy: 0,
  bestCombo: 0,
  bestScore: 0,
  result: null,
  photo: null,
  camReady: false,
  bonesOn: true,
  lastFrameT: 0,
  tickCount: 0,
  // 举手开拍（人站远了按不到空格）
  gateArmed: true,
  holdAt: 0,
  holdRatio: 0,
};

const proj = new Projector();
const engine = new PoseEngine();
let stream = null;
let overlayCtx = null;
let resultCtx = null;

/* ---------------------------------------------------------------- */
/* 文案                                                              */
/* ---------------------------------------------------------------- */
const TITLES = [
  [0, "菜鸟蛙", "继续练"],
  [120, "见习蛙", "有点天赋"],
  [300, "摆拍蛙", "已经稳了"],
  [600, "凹造型达人", "有内味了"],
  [1000, "姿势之神", "奶蛙服了"],
  [1600, "奶蛙本蛙", "就是你本人"],
];

const VERDICT = {
  5: [
    "奶蛙看了一眼就原地转圈：这不就是我本人吗？",
    "完美复刻。奶蛙决定把这张照片设成头像。",
    "一模一样到奶蛙开始怀疑谁才是照片里的那位。",
  ],
  4: [
    "很像了！再放松一点，你就能完全变成奶蛙。",
    "骨架几乎重合，就差奶蛙那个得意的表情。",
    "奶蛙点头：这个造型，可以上墙。",
  ],
  3: [
    "有内味了，但手脚还差一点点意思。",
    "奶蛙挠头：方向对了，细节再抠一抠。",
    "差一口气，再凹狠一点就完美。",
  ],
  2: [
    "奶蛙歪头看了半天：你这是在……模仿我吗？",
    "动作大概齐了，但奶蛙觉得你有点害羞。",
    "还能更好看，放开一点，没人看见你的。",
  ],
  1: [
    "奶蛙沉默了三秒，然后笑出了声。",
    "这个……奶蛙说它先记下了，当作黑历史。",
    "别急，先从「抱肚大笑」开始练。",
  ],
};

const QUIP = {
  p01: "腾空这一下，奶蛙说它给满分，虽然你脚还在地上。",
  p02: "抱肚大笑，笑到肚子都在抖，这就很奶蛙。",
  p03: "双手抱头仰天大笑，快乐值直接拉满。",
  p04: "举拳那个姿势，像在宣布今天你是主角。",
  p05: "四肢着地，奶蛙说这是它最擅长的一种走路方式。",
  p07: "捧着心的样子，奶蛙看了都想给你点赞。",
  p10: "高举单手挥动，这热情奶蛙隔着屏幕都感受到了。",
  p11: "一手叉腰一手平举，指点江山的味道出来了。",
  p12: "弯下腰笑，奶蛙说这个动作它练了很多年。",
  p13: "侧身抱肚，安静又有点小心思，很上镜。",
  p14: "双臂一抱，气势先到，奶蛙说这叫「我不听」。",
  p15: "双手比 V 还吐舌头，欠揍得恰到好处。",
  p16: "咬着手指陷入沉思，奶蛙问你在想什么难题。",
};

const SAY_START = ["来，三秒后定格", "准备，奶蛙在看着你", "摆好就别动", "准备好了吗"];
const SAY_GOOD = ["很可以啊", "这个不错", "有点东西", "奶蛙点头了"];

/* 奶蛙原声样本：a1 = 1技能（丢人不 / 噶酒森），a3 = 3技能（嘎嘎滴辣虾 / 齁辣干巴爹）
   laugh_ult = 招牌大笑，andi = 安迪。每次结算随机抽，权重让大笑最容易出现。 */
const CLIP_BANK = [
  { name: "laugh_ult", weight: 5, long: true },
  { name: "andi", weight: 2, long: false },
  { name: "a1_1", weight: 1.6, long: false },
  { name: "a1_2", weight: 1.6, long: false },
  { name: "a3_1", weight: 1.6, long: false },
  { name: "a3_2", weight: 1.6, long: false },
];
let lastClip = "";

/** 按权重随机抽一条，尽量不连续重复 */
function rollClip(exclude) {
  const pool = CLIP_BANK.filter((c) => c.name !== exclude);
  const total = pool.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}

/** 匹配成功后的结算音：随机奶蛙原声，星级只影响音量/笑多久 */
function playSettlement(stars) {
  if (!fx.hasClips()) return;
  const first = rollClip(lastClip);
  lastClip = first.name;

  if (first.long) {
    const dur = stars >= 4 ? 3.4 : stars === 3 ? 2.4 : 1.4;
    const gain = stars >= 4 ? 0.95 : stars === 3 ? 0.82 : 0.55;
    fx.playClip(first.name, { gain, dur, delay: 0.05 });
    // 笑完再补一句话，让它像在自言自语
    if (stars >= 3 && Math.random() < 0.6) {
      const second = rollClip(first.name);
      lastClip = second.name;
      setTimeout(() => fx.playClip(second.name, { gain: 0.82 }), dur * 1000 + 240);
    }
  } else {
    fx.playClip(first.name, { gain: stars >= 3 ? 0.95 : 0.7, delay: 0.12 });
    // 偶尔连着嘟囔第二句
    if (Math.random() < 0.4) {
      const second = rollClip(first.name);
      lastClip = second.name;
      setTimeout(() => fx.playClip(second.name, { gain: 0.8 }), 1500);
    }
  }
}

/* ---------------------------------------------------------------- */
/* 基础 UI                                                           */
/* ---------------------------------------------------------------- */
function setStatus(text, cls = "") {
  const pill = $("statusPill");
  const t = $("statusText");
  if (!pill || !t) return;
  t.textContent = text;
  pill.className = "status-pill " + cls;
}

function titleOf(energy) {
  let cur = TITLES[0];
  for (const t of TITLES) if (energy >= t[0]) cur = t;
  return cur;
}

function save() {
  try {
    localStorage.setItem("frog.bestCombo", String(S.bestCombo));
    localStorage.setItem("frog.energy", String(S.energy));
    localStorage.setItem("frog.bestScore", String(S.bestScore));
  } catch (_) {}
}

function restore() {
  try {
    S.bestCombo = Number(localStorage.getItem("frog.bestCombo") || 0) || 0;
    S.bestScore = Number(localStorage.getItem("frog.bestScore") || 0) || 0;
  } catch (_) {}
  S.energy = 0;
}

function paintMeters(bump = false) {
  $("mCombo").textContent = S.combo;
  $("mComboSub").textContent = "×" + (1 + Math.min(S.combo, 8) * 0.1).toFixed(1);
  $("mEnergy").textContent = S.energy;
  $("mBest").textContent = S.bestCombo;
  const t = titleOf(S.energy);
  $("mTitle").textContent = t[1];
  $("mTitleSub").textContent = t[2];
  if (bump) {
    document.querySelectorAll(".meter").forEach((m) => {
      m.classList.remove("bump");
      void m.offsetWidth;
      m.classList.add("bump");
    });
  }
}

/* ---------------------------------------------------------------- */
/* 载入数据                                                          */
/* ---------------------------------------------------------------- */
async function loadPoses() {
  const res = await fetch("data/poses.json");
  if (!res.ok) throw new Error("姿势数据读取失败");
  const data = await res.json();
  S.poses = data.poses.map((p) => {
    const tpl = prepTemplate(p.human);
    return { pose: p, tpl, img: null, thumb: null };
  });
  S.templates = S.poses.map((x) => ({ pose: x.pose, tpl: x.tpl }));

  // 图片预加载
  await Promise.all(
    S.poses.map(
      (item) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => { item.img = im; resolve(); };
          im.onerror = () => resolve();
          im.src = `assets/poses/${item.pose.file}`;
        })
    )
  );

  buildCards();
  $("poseCount").textContent = S.poses.length;
}

function buildCards() {
  const grid = $("poseGrid");
  grid.innerHTML = "";
  S.poses.forEach((item, i) => {
    const p = item.pose;
    const card = document.createElement("div");
    card.className = "pose-card";
    card.dataset.id = p.id;
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.title = `${p.name} · ${p.desc}`;
    card.innerHTML = `
      <img src="assets/poses/thumbs/${p.file}" alt="${p.name}" loading="lazy" />
      <span class="pc-idx">${String(i + 1).padStart(2, "0")}</span>
      <span class="pc-tag"></span>
      <span class="pc-name">${p.name}</span>`;
    card.addEventListener("click", () => toggleLock(p.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        toggleLock(p.id);
      }
    });
    grid.appendChild(card);
  });
}

/* ---------------------------------------------------------------- */
/* 目标锁定                                                          */
/* ---------------------------------------------------------------- */
function toggleLock(id) {
  if (S.mode !== "live" && S.mode !== "boot") return;
  S.lockedId = S.lockedId === id ? null : id;
  fx.initAudio();
  fx.sfx.lock();
  paintLock();
  const pose = S.poses.find((x) => x.pose.id === S.lockedId);
  if (pose) {
    fx.toast("锁定目标：" + pose.pose.name);
    if (fx.isVoiceOn()) fx.say("好，就凹" + pose.pose.name);
  } else {
    fx.toast("已取消锁定", true);
  }
  const card = document.querySelector(`.pose-card[data-id="${S.lockedId}"]`);
  if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function paintLock() {
  document.querySelectorAll(".pose-card").forEach((c) => {
    c.classList.toggle("locked", c.dataset.id === S.lockedId);
    c.classList.remove("live");
  });
  const mode = $("stageMode");
  const pose = S.poses.find((x) => x.pose.id === S.lockedId);
  if (pose) {
    mode.textContent = "锁定：" + pose.pose.name;
    mode.classList.add("locked");
  } else {
    mode.textContent = "自由发挥";
    mode.classList.remove("locked");
  }
  $("btnClearLock").style.display = pose ? "" : "none";
}

function randomChallenge() {
  if (S.mode !== "live") return;
  fx.initAudio();
  const pool = S.poses.filter((p) => p.pose.id !== S.lockedId);
  const pick = pool[(Math.random() * pool.length) | 0];
  S.lockedId = pick.pose.id;
  paintLock();
  fx.sfx.lock();
  fx.toast("奶蛙点名：" + pick.pose.name);
  const card = document.querySelector(`.pose-card[data-id="${pick.pose.id}"]`);
  if (card) {
    card.classList.add("pulse");
    setTimeout(() => card.classList.remove("pulse"), 950);
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  if (fx.isVoiceOn()) fx.say("来，试试" + pick.pose.name);
}

/* ---------------------------------------------------------------- */
/* 摄像头 + 引擎                                                     */
/* ---------------------------------------------------------------- */
function showCamMsg(text, showRetry = true) {
  const ph = $("camPlaceholder");
  ph.classList.remove("hidden");
  $("camMsg").textContent = text;
  $("btnRetryCam").style.display = showRetry ? "" : "none";
}

/* ---------------------------------------------------------------- */
/* 摄像头掉线：先自动重连，实在不行再让用户点重试                      */
/* ---------------------------------------------------------------- */
let reconnecting = false;
function onCamLost() {
  S.camReady = false;
  S.pts = null;
  S.conf = 0;
  $("liveDot").classList.remove("on");
  if (engine) engine.stop();
  S.camLost = (S.camLost || 0) + 1;
  if (S.mode === "counting") {
    S.mode = "live";
    $("btnStart").disabled = false;
    $("countdown").style.opacity = "0";
  }
  if (S.camLost <= 2 && !reconnecting) {
    reconnecting = true;
    showCamMsg("摄像头断开了，正在尝试重连…", false);
    setStatus("摄像头掉线，重连中", "err");
    setTimeout(async () => {
      try {
        const ok = await setupCamera();
        if (ok) {
          try { await setupEngine(); } catch (e) { console.error(e); }
          setStatus("奶蛙已就位 · 摆个造型吧");
          fx.toast("摄像头回来了 🐸");
        }
      } finally {
        reconnecting = false;
      }
    }, 800);
    return;
  }
  showCamMsg("摄像头断开了，检查一下线，然后点重试", true);
  setStatus("摄像头断开", "err");
  fx.toast("摄像头断开了 🥲");
}

async function setupCamera() {
  if (location.protocol === "file:") {
    showCamMsg("请用 start.bat 启动（浏览器不允许 file:// 打开摄像头）", false);
    setStatus("需要本地服务启动", "err");
    throw new Error("file protocol");
  }
  const video = $("video");
  try {
    stream = await openCamera(video, { width: 1280, height: 960 });
    S.camReady = true;
    $("camPlaceholder").classList.add("hidden");
    $("liveDot").classList.add("on");
    if (!video.videoWidth) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
    fitCamera();
    // 摄像头被拔掉 / 被别的程序抢走：先安静重连两次，不行再报错
    const track = stream.getVideoTracks && stream.getVideoTracks()[0];
    if (track) track.addEventListener("ended", onCamLost);
    S.camLost = 0;
    return true;
  } catch (err) {
    console.error(err);
    const m = String(err && err.message);
    let msg = "摄像头打不开，检查一下是不是被别的程序占用了";
    if (/permission|denied|NotAllowed/i.test(m)) msg = "浏览器拒绝了摄像头权限，点地址栏的小相机图标允许后再试";
    else if (/NotFound|Devices/i.test(m)) msg = "没找到摄像头设备";
    showCamMsg(msg);
    setStatus("摄像头未就绪", "err");
    S.camReady = false;
    return false;
  }
}

function sizeOverlay() {
  const canvas = $("overlay");
  const shell = $("cameraShell");
  const w = shell.clientWidth, h = shell.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  overlayCtx = canvas.getContext("2d");
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  proj.update(w, h, $("video").videoWidth || 4, $("video").videoHeight || 3);
}

/** 让摄像头画面按视频真实比例铺满可用空间，且永不裁掉人 */
function fitCamera() {
  const wrap = $("camWrap");
  const shell = $("cameraShell");
  if (!wrap || !shell) return;
  const v = $("video");
  const vw = v ? v.videoWidth : 0, vh = v ? v.videoHeight : 0;
  const ar = vw >= 64 && vh >= 64 ? vw / vh : 4 / 3;
  const aw = wrap.clientWidth;
  if (!aw) return;
  let ah = wrap.clientHeight;
  if (!ah || ah < 220) ah = Math.max(240, Math.min(aw / ar, window.innerHeight * 0.52));
  const w = Math.min(aw, ah * ar);
  shell.style.width = Math.round(w) + "px";
  shell.style.height = Math.round(w / ar) + "px";
  sizeOverlay();
}

async function setupEngine() {
  let lastPct = -1;
  await engine.init({
    onProgress: (loaded, total, phase) => {
      if (phase === "cache") { setStatus("奶蛙已经从缓存里就位 · 摆个造型吧"); return; }
      const pct = total ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
      if (pct === lastPct) return;
      lastPct = pct;
      const mb = (loaded / 1048576).toFixed(1);
      const tot = total ? (total / 1048576).toFixed(1) + "MB" : "";
      setStatus(`正在唤醒奶蛙 · 模型 ${mb}${tot ? "/" + tot : ""}MB (${pct}%)`);
      if (pct >= 100) setStatus("模型到齐了，正在准备识别…");
    },
  });
  engine.attach($("video"));
  engine.onResult = (lm) => {
    S.lm = lm;
    const e = lm ? extractPoints(lm, proj.aspect) : null;
    S.pts = e ? e.pts : null;
    S.conf = e ? e.confidence : 0;
    S.miss = e ? e.missing.length : 99;
  };
  engine.onError = () => {};
  engine.start();
}

/* ---------------------------------------------------------------- */
/* 主渲染循环                                                        */
/* ---------------------------------------------------------------- */
let rafId = 0;
let lastRankT = 0;
let frameNo = 0;

function loop() {
  rafId = requestAnimationFrame(loop);
  const now = performance.now();
  if (!overlayCtx) return;

  // 视频比例晚一点才稳定：偶尔校正一次画面尺寸
  if (++frameNo % 24 === 0) {
    const v = $("video"), s = $("cameraShell");
    if (v.videoWidth >= 64 && s.clientHeight > 0) {
      const want = v.videoWidth / v.videoHeight;
      const have = s.clientWidth / s.clientHeight;
      if (Math.abs(want - have) > 0.02) fitCamera();
    }
  }

  // 每隔一小段重算排名（UI 不抖）
  if (S.pts && now - lastRankT > 90) {
    lastRankT = now;
    S.rank = rankAll(S.pts, S.templates);
    S.score = S.rank[0] ? S.rank[0].total : 0;
  }

  drawOverlay(now);
  updateHandsFree(now);
  if (S.mode === "live") updateHudLive();
}

function drawOverlay(now) {
  const canvas = $("overlay");
  const w = canvas.clientWidth || proj.boxW;
  const h = canvas.clientHeight || proj.boxH;
  if (!w || !h) return;
  if (proj.boxW !== w || proj.boxH !== h) sizeOverlay();

  const ctx = overlayCtx;
  ctx.clearRect(0, 0, proj.boxW, proj.boxH);
  if (!S.pts || !S.bonesOn) return;

  const targetId = S.lockedId || (S.rank[0] && S.rank[0].pose.id);
  const target = S.poses.find((x) => x.pose.id === targetId);

  // 锁定目标的"影子骨架"
  if (target && S.mode !== "result") {
    const { frame } = toBody(S.pts);
    const ghost = fromBody(target.tpl.body, frame);
    drawSkeleton(ctx, ghost, proj, {
      color: "rgba(214,249,122,.55)",
      glow: "rgba(214,249,122,.28)",
      width: 2,
      alpha: 0.62,
      dots: 0,
      dotted: true,
      pulse: (now / 26) % 10,
    });
  }

  // 用户骨架
  const g = S.lockedId
    ? (S.rank.find((r) => r.pose.id === S.lockedId)?.total ?? 0)
    : S.score;
  const col = colorFor(gauge(g));
  drawSkeleton(ctx, S.pts, proj, {
    color: col.color,
    glow: col.glow,
    width: 3.2,
    dots: 3.2,
    headR: 8.5,
  });
}

let softHintDone = false;
function updateHudLive() {
  const hud = $("hudLive");
  const hint = $("camHint");
  if (!S.pts) {
    if (hint) {
      hint.textContent = "没找到你 · 站到画面中间，让上半身和腿都进来";
      hint.classList.toggle("show", S.mode === "live" && S.camReady && !reconnecting);
    }
    hud.classList.remove("show");
    return;
  }
  if (hint) {
    hint.textContent = "🙌 举起双手 = 开始（按空格也行）";
    hint.classList.toggle("show", !softHintDone && S.mode === "live");
  }
  hud.classList.add("show");
  let showName, val;
  if (S.lockedId) {
    const r = S.rank.find((x) => x.pose.id === S.lockedId);
    showName = S.poses.find((x) => x.pose.id === S.lockedId)?.pose.name || "—";
    val = r ? gauge(r.total) : 0;
  } else {
    const top = S.rank[0];
    showName = top ? top.pose.name : "—";
    val = top ? gauge(top.total) : 0;
  }
  $("hudName").textContent = showName;
  $("hudBar").style.width = clamp(val * 100, 0, 100).toFixed(1) + "%";
}

/* ---------------------------------------------------------------- */
/* 举手开拍：人得站 1.5~2 米才能被认出来，那时候够不着空格            */
/* ---------------------------------------------------------------- */
const HOLD_MS = 460;

function handsAboveHead(pts) {
  if (!pts || !pts.head || !pts.wrL || !pts.wrR) return false;
  const pad = 0.028;
  const up = (k) => {
    const p = pts[k];
    return !!p && p.y > pts.head.y + pad && (p.v === undefined || p.v > 0.35);
  };
  return up("wrL") && up("wrR");
}

function fireHandsFree() {
  fx.initAudio();
  fx.sfx.pop();
  if (S.mode === "live") {
    startRound();
  } else if (S.mode === "result") {
    backToBrowse();
    setTimeout(() => {
      if (S.mode === "live") startRound();
    }, 240);
  }
}

function updateHandsFree(now) {
  const cue = $("holdCue");
  if (!cue) return;
  const playing = S.mode === "live" || S.mode === "result";
  if (!playing) {
    // 倒计时/结算中：只收起提示，不动上膛状态（免得刚定格的手势又触发一次）
    S.holdAt = 0;
    S.holdRatio = 0;
    cue.classList.remove("show");
    return;
  }
  if (!S.camReady || !S.pts) {
    S.holdAt = 0;
    S.holdRatio = 0;
    S.gateArmed = true;
    cue.classList.remove("show");
    return;
  }
  if (!handsAboveHead(S.pts)) {
    // 手放下 = 重新上膛
    if (S.holdAt || S.holdRatio) {
      S.holdAt = 0;
      S.holdRatio = 0;
    }
    cue.classList.remove("show");
    S.gateArmed = true;
    return;
  }
  if (!S.gateArmed) {
    cue.classList.remove("show");
    return;
  }
  if (!S.holdAt) S.holdAt = now;
  const r = (now - S.holdAt) / HOLD_MS;
  S.holdRatio = r;
  $("holdText").textContent = S.mode === "result" ? "保持举手 · 再来一次" : "保持举手 · 开始";
  $("holdBar").style.width = clamp(r, 0, 1) * 100 + "%";
  cue.classList.add("show");
  if (r >= 1) {
    S.holdAt = 0;
    S.holdRatio = 0;
    S.gateArmed = false;
    cue.classList.add("fire");
    setTimeout(() => cue.classList.remove("fire", "show"), 280);
    fireHandsFree();
  }
}

/* ---------------------------------------------------------------- */
/* 一轮游戏                                                          */
/* ---------------------------------------------------------------- */
function showCount(text) {
  const el = $("countdown");
  el.textContent = text;
  el.classList.remove("go");
  void el.offsetWidth;
  el.classList.add("go");
}

async function startRound() {
  if (S.mode !== "live") return;
  fx.initAudio();
  if (!S.camReady) { fx.toast("摄像头还没准备好", true); return; }
  if (!S.pts) { fx.toast("站进画面里，让奶蛙看见你", true); return; }

  S.mode = "counting";
  S.gateArmed = false;
  S.holdAt = 0;
  softHintDone = true;
  $("holdCue").classList.remove("show");
  $("btnStart").disabled = true;
  $("countdown").style.opacity = "1";
  $("freezeBadge").classList.remove("show");
  $("scanLine").classList.remove("run");
  void $("scanLine").offsetWidth;
  $("scanLine").classList.add("run");

  if (fx.isVoiceOn()) fx.say(SAY_START[(Math.random() * SAY_START.length) | 0]);

  for (let n = 3; n >= 1; n--) {
    showCount(String(n));
    fx.sfx.tick(n);
    await sleep(820);
  }
  showCount("定格");
  fx.sfx.go();
  fx.vibrate(28);
  await sleep(230);
  capture();
}

let captureGuard = false;
function capture() {
  if (captureGuard) return;
  captureGuard = true;
  setTimeout(() => (captureGuard = false), 900);

  const pts = S.pts;
  const lowConf = typeof S.conf === "number" && S.conf < 0.35;
  const manyMiss = typeof S.miss === "number" && S.miss > 2;
  const shaky = !pts || lowConf || manyMiss;
  if (shaky) {
    S.mode = "live";
    $("btnStart").disabled = false;
    $("countdown").style.opacity = "0";
    $("freezeBadge").classList.remove("show");
    fx.toast(pts ? "有点模糊，站稳了再来一次" : "刚才没看清你，再来一次", true);
    return;
  }

  // 定格特效
  const flash = $("snapFlash");
  flash.classList.remove("go");
  void flash.offsetWidth;
  flash.classList.add("go");
  fx.sfx.shutter();
  $("freezeBadge").classList.add("show");
  $("liveDot").classList.remove("on");

  const rank = rankAll(pts, S.templates);
  const best = rank[0];
  const stars = starsOf(best.total);
  const gap = best.total - (rank[1] ? rank[1].total : 0);

  // 连击
  const hit = best.total >= 0.70;
  S.combo = hit ? S.combo + 1 : 0;
  if (hit) {
    S.bestCombo = Math.max(S.bestCombo, S.combo);
    if (S.combo > 1) fx.sfx.combo(S.combo);
  }
  const mult = 1 + Math.min(S.combo, 8) * 0.1;
  const gain = Math.round((best.total * 55 + stars * 12) * mult);
  S.energy += gain;
  S.bestScore = Math.max(S.bestScore, best.total);
  if (stars >= 4) S.streak++;
  else S.streak = 0;
  save();

  // 评语
  let verdict;
  if (stars >= 3 && QUIP[best.pose.id]) verdict = QUIP[best.pose.id];
  else {
    const pool = VERDICT[stars] || VERDICT[1];
    verdict = pool[(Math.random() * pool.length) | 0];
  }
  if (stars >= 4 && gap < 0.06 && rank[1]) verdict += ` 不过说实话，${rank[1].pose.name}也在抢镜。`;

  S.result = {
    rank,
    best,
    stars,
    gap,
    gain,
    verdict,
    photo: null,
    lockedRank: S.lockedId ? rank.findIndex((r) => r.pose.id === S.lockedId) + 1 : 0,
    targetName: S.lockedId ? S.poses.find((x) => x.pose.id === S.lockedId)?.pose.name : null,
  };

  showResult(S.result);
}

async function showResult(res) {
  S.mode = "result";
  $("btnStart").disabled = true;
  $("countdown").style.opacity = "0";
  $("camHint").classList.remove("show");
  $("catalogBrowse").classList.add("hidden");
  $("catalogResult").classList.remove("hidden");
  // 手机上结果在下方，自动滚过去，省得用户找
  if (window.innerWidth <= 760) {
    setTimeout(() => {
      const el = document.querySelector(".catalog");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 260);
  }

  const pose = res.best.pose;
  const idx = S.poses.findIndex((x) => x.pose.id === pose.id) + 1;
  $("resultIdx").textContent = "#" + String(idx).padStart(2, "0");
  $("resultName").textContent = pose.name;
  $("resultSub").textContent = pose.desc;
  $("resultVerdict").textContent = res.verdict;
  $("resultKicker").textContent = S.lockedId ? "奶蛙在 13 个姿势里找到最像的" : "奶蛙已经认出你的姿势";

  // 星级
  const starsEl = $("resultStars");
  starsEl.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const i2 = document.createElement("i");
    i2.textContent = "★";
    if (i < res.stars) i2.classList.add("on");
    starsEl.appendChild(i2);
  }
  starsEl.classList.remove("pop");
  void starsEl.offsetWidth;
  starsEl.classList.add("pop");

  // 大图 + 骨架
  const img = $("resultImg");
  const item = S.poses.find((x) => x.pose.id === pose.id);
  delete img.dataset.drawn;
  img.style.animation = "none";
  void img.offsetWidth;
  img.style.animation = "";
  img.src = `assets/poses/${pose.file}`;
  const paint = () => {
    if (!resultCtx) return;
    drawFrogSkeleton(resultCtx, $("resultSkeleton"), img, pose.frog);
  };
  if (img.complete && img.naturalWidth) paint();
  else img.onload = () => setTimeout(paint, 30);
  setTimeout(paint, 380);

  // 数据
  $("rsEnergy").textContent = "+" + res.gain;
  $("rsCombo").textContent = S.combo + (S.combo > 1 ? " ×" + (1 + Math.min(S.combo, 8) * 0.1).toFixed(1) : "");
  $("rsTitle").textContent = titleOf(S.energy)[1];
  paintMeters(true);

  // 定格照
  const snap = $("snapIn");
  const snapWrap = $("snapInWrap");
  snap.src = "";
  snapWrap.classList.remove("show");
  const photo = await snapshot();
  if (photo) {
    S.result.photo = photo.img;
    snap.src = photo.url;
    snapWrap.classList.add("show");
  }

  // 陪跑
  const list = $("runnerList");
  list.innerHTML = "";
  res.rank.slice(1, 7).forEach((r) => {
    const el = document.createElement("div");
    el.className = "runner-item";
    el.innerHTML = `<img src="assets/poses/thumbs/${r.pose.file}" alt="${r.pose.name}" /><span>${r.pose.name}</span>`;
    el.addEventListener("click", () => {
      S.lockedId = r.pose.id;
      backToBrowse();
      paintLock();
      fx.toast("锁定目标：" + r.pose.name);
    });
    list.appendChild(el);
  });

  // 特效
  const layer = $("fxLayer");
  const box = $("cameraShell").getBoundingClientRect();
  if (res.stars >= 4) {
    fx.burst(layer, box.width / 2, box.height * 0.45, { count: 34, spread: 240 });
    fx.rain(layer, 1500);
    fx.floatWord(layer, ["完美!", "灵魂共鸣!", "奶蛙附体!"][(Math.random() * 3) | 0], box.width / 2, box.height * 0.36);
    fx.sfx.match(res.stars);
    fx.vibrate(40);
  } else if (res.stars === 3) {
    fx.burst(layer, box.width / 2, box.height * 0.5, { count: 16, spread: 160 });
    fx.floatWord(layer, ["不错!", "有内味了", "接近了"][(Math.random() * 3) | 0], box.width / 2, box.height * 0.4);
    fx.sfx.match(3);
  } else {
    fx.sfx.fail();
    fx.floatWord(layer, ["差一点", "再来!", "嗯……"][(Math.random() * 3) | 0], box.width / 2, box.height * 0.42, "#ffd166");
  }

  // 奶蛙原声结算
  playSettlement(res.stars);

  // 语音吐槽：有奶蛙原声时就不抢戏了
  if (fx.isVoiceOn() && !fx.hasClips()) {
    const line =
      res.stars >= 4
        ? `这波很像，${SAY_GOOD[(Math.random() * SAY_GOOD.length) | 0]}`
        : res.stars === 3
        ? "有点意思，再凹狠一点"
        : "奶蛙说，你还可以更放开一点";
    setTimeout(() => fx.say(line), 420);
  }

  // 锁定目标排名提示
  if (S.lockedId && res.targetName) {
    if (res.lockedRank === 1) setTimeout(() => fx.toast(`锁定目标「${res.targetName}」被你拿下了`), 600);
    else if (res.lockedRank > 1) setTimeout(() => fx.toast(`锁定的「${res.targetName}」排第 ${res.lockedRank}`, true), 600);
  }
}

function backToBrowse() {
  S.mode = "live";
  $("btnStart").disabled = false;
  if (window.innerWidth <= 760) window.scrollTo({ top: 0, behavior: "smooth" });
  $("catalogResult").classList.add("hidden");
  $("catalogBrowse").classList.remove("hidden");
  $("freezeBadge").classList.remove("show");
  $("liveDot").classList.add("on");
  $("snapInWrap").classList.remove("show");
  S.result = null;
  const layer = $("fxLayer");
  if (layer) layer.innerHTML = "";
}

/* ---------------------------------------------------------------- */
/* 定格照                                                            */
/* ---------------------------------------------------------------- */
async function snapshot() {
  const video = $("video");
  if (!video.videoWidth) return null;
  const w = 640, h = Math.round((video.videoHeight / video.videoWidth) * 640);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.translate(w, 0);
  g.scale(-1, 1);
  g.drawImage(video, 0, 0, w, h);
  const url = c.toDataURL("image/jpeg", 0.88);
  const img = new Image();
  await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
  return { url, img };
}

/* ---------------------------------------------------------------- */
/* 战报                                                              */
/* ---------------------------------------------------------------- */
async function saveReport() {
  if (!S.result) return;
  const pose = S.result.best.pose;
  const idx = S.poses.findIndex((x) => x.pose.id === pose.id) + 1;
  fx.sfx.pop();
  await downloadReport({
    img: S.poses.find((x) => x.pose.id === pose.id)?.img,
    photo: S.result.photo,
    idx: String(idx).padStart(2, "0"),
    name: pose.name,
    tag: pose.tag + " · " + pose.desc,
    stars: S.result.stars,
    verdict: S.result.verdict,
    energy: S.energy,
    combo: S.combo,
    title: titleOf(S.energy)[1],
    date: new Date().toLocaleString("zh-CN", { hour12: false }),
  });
  fx.toast("战报已保存到下载文件夹");
}

/* ---------------------------------------------------------------- */
/* 事件                                                              */
/* ---------------------------------------------------------------- */
function bindUI() {
  $("btnStart").addEventListener("click", startRound);
  $("btnRandom").addEventListener("click", randomChallenge);
  $("btnBack").addEventListener("click", () => {
    backToBrowse();
    S.lockedId = null;
    paintLock();
    fx.toast("回到姿势库", true);
  });
  $("btnClearLock").addEventListener("click", () => {
    S.lockedId = null;
    paintLock();
    fx.toast("已取消锁定", true);
  });
  $("btnAgain").addEventListener("click", async () => {
    backToBrowse();
    await sleep(260);
    startRound();
  });
  $("btnGallery").addEventListener("click", backToBrowse);
  $("btnReport").addEventListener("click", saveReport);
  $("btnRetryCam").addEventListener("click", async () => {
    showCamMsg("正在请求摄像头权限…", false);
    const ok = await setupCamera();
    if (ok) { try { await setupEngine(); } catch (e) { console.error(e); } }
  });

  $("btnSound").addEventListener("click", () => {
    const on = !fx.isSoundOn();
    fx.setSound(on);
    $("btnSound").classList.toggle("is-on", on);
    if (on) { fx.initAudio(); fx.sfx.pop(); }
  });
  $("btnVoice").addEventListener("click", () => {
    const on = !fx.isVoiceOn();
    fx.setVoice(on);
    $("btnVoice").classList.toggle("is-on", on);
    if (on) fx.say("奶蛙上线");
  });
  $("btnBones").addEventListener("click", () => {
    S.bonesOn = !S.bonesOn;
    $("btnBones").classList.toggle("is-on", S.bonesOn);
    fx.sfx.pop();
  });

  $("btnHelp").addEventListener("click", () => $("helpModal").removeAttribute("hidden"));
  $("btnHelpClose").addEventListener("click", () => $("helpModal").setAttribute("hidden", ""));
  $("helpModal").addEventListener("click", (e) => {
    if (e.target === $("helpModal")) $("helpModal").setAttribute("hidden", "");
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (S.mode === "result") { backToBrowse(); startRound(); }
      else startRound();
    } else if (e.key === "r" || e.key === "R") randomChallenge();
    else if (e.key === "Escape") {
      $("helpModal").setAttribute("hidden", "");
      if (S.mode === "result") backToBrowse();
    }
  });

  window.addEventListener("resize", () => {
    fitCamera();
    if (S.mode === "result") {
      const pose = S.result?.best.pose;
      if (pose && resultCtx) drawFrogSkeleton(resultCtx, $("resultSkeleton"), $("resultImg"), pose.frog);
    }
  });
  if (window.ResizeObserver) {
    let raf = 0;
    new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; fitCamera(); });
    }).observe($("camWrap"));
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) engine.stop();
    else if (S.camReady) engine.start();
  });

  // 第一次点击解锁音频（浏览器策略）
  const unlock = () => { fx.initAudio(); fx.pickVoice(); window.removeEventListener("pointerdown", unlock); };
  window.addEventListener("pointerdown", unlock);
}

/* ---------------------------------------------------------------- */
/* 启动                                                              */
/* ---------------------------------------------------------------- */
// 调试句柄（本地小工具，方便我自己截图验证；不影响正常使用）
window.__FROG__ = { S, engine, proj, capture, startRound, backToBrowse, prepTemplate, toBody, fromBody, rankAll, fx, playSettlement, rollClip };

async function boot() {
  restore();
  paintMeters();
  paintLock();
  bindUI();
  guardFileProtocol();
  fx.preloadClips();

  resultCtx = $("resultSkeleton").getContext("2d");

  try {
    await loadPoses();
    setStatus("奶蛙已经来了，正在等摄像头…");
  } catch (err) {
    console.error(err);
    setStatus("姿势数据没加载上", "err");
    fx.toast("姿势库加载失败：" + err.message, true);
    return;
  }

  const [camOk, engOk] = await Promise.all([
    setupCamera(),
    setupEngine().then(() => true).catch((e) => { console.error("[奶蛙] 模型初始化失败", e); return false; }),
  ]);

  if (!camOk) { setStatus("摄像头未就绪", "err"); }
  else if (!engOk) { setStatus("姿态模型加载失败", "err"); fx.toast("模型加载失败，刷新试试", true); }
  else {
    setStatus("奶蛙已就位 · 摆个造型吧", "ok");
    S.mode = "live";
    loop();
    setTimeout(() => {
      fx.toast("选一个奶蛙，或者直接凹造型");
    }, 800);
  }

  if (camOk && !engOk) { loop(); }
}

function guardFileProtocol() {
  if (location.protocol !== "file:") return;
  showCamMsg("请用 start.bat 启动：浏览器不允许 file:// 打开摄像头", false);
  setStatus("需要本地服务启动", "err");
}

boot();
