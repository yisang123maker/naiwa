/* ============================================================
   音效 / 粒子 / 奶蛙吐槽 · fx.js
   ============================================================ */

const PALETTE = ["#d6f95a", "#54e3b4", "#ffd166", "#fff3c9", "#a4e02f"];

let ctx = null;
let soundOn = true;
let voiceOn = true;
let noiseBuf = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const len = Math.floor(ctx.sampleRate * 0.4);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  return ctx;
}

export function setSound(on) { soundOn = on; }
export function setVoice(on) {
  voiceOn = on;
  if (!on && window.speechSynthesis) window.speechSynthesis.cancel();
}
export const isSoundOn = () => soundOn;
export const isVoiceOn = () => voiceOn;

/* ----------------------------------------------------------------
   真·奶蛙语音样本（本地 mp3，首次进入时预解码）
   laugh_ult 12s 大招笑声 / andi 安迪 / a1_* 丢人不·噶酒森 / a3_* 嘎嘎滴辣虾·齁辣干巴爹
   ---------------------------------------------------------------- */
const CLIP_NAMES = ["laugh_ult", "andi", "a1_1", "a1_2", "a3_1", "a3_2"];
const clipBuf = new Map();
let clipLoading = null;

export function preloadClips(base = "assets/audio/naiwa/") {
  if (clipLoading) return clipLoading;
  clipLoading = (async () => {
    const c = initAudio();
    if (!c) return false;
    await Promise.all(
      CLIP_NAMES.map(async (name) => {
        try {
          const r = await fetch(`${base}${name}.mp3`);
          if (!r.ok) return;
          const buf = await r.arrayBuffer();
          clipBuf.set(name, await c.decodeAudioData(buf));
        } catch (e) {
          /* 没有样本就退回合成音效，不影响玩 */
        }
      })
    );
    return clipBuf.size > 0;
  })();
  return clipLoading;
}

export const hasClips = () => clipBuf.size > 0;
export const clipNames = () => [...clipBuf.keys()];

/** 播放奶蛙语音样本；dur 为截断秒数（0 = 放完） */
export function playClip(name, { gain = 0.9, dur = 0, delay = 0, rate = 1 } = {}) {
  if (!soundOn) return false;
  const c = initAudio();
  const buf = clipBuf.get(name);
  if (!c || !buf || c.state !== "running") return false;
  const t0 = c.currentTime + delay;
  const play = Math.min(dur > 0 ? dur : buf.duration, buf.duration);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  if (dur > 0 && dur < buf.duration) {
    g.gain.setValueAtTime(gain, t0 + Math.max(0.03, play - 0.28));
    g.gain.linearRampToValueAtTime(0.0001, t0 + play);
  }
  src.connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + play + 0.05);
  return true;
}

function blip({ freq = 660, to = null, dur = 0.12, type = "sine", gain = 0.16, delay = 0 }) {
  if (!soundOn) return;
  const ac = initAudio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.14, gain = 0.3, freq = 1800, q = 0.9, delay = 0 }) {
  if (!soundOn) return;
  const ac = initAudio();
  if (!ac || !noiseBuf) return;
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export const sfx = {
  tick(n) { blip({ freq: 520 + (3 - n) * 90, dur: 0.1, type: "triangle", gain: 0.12 }); },
  go() { blip({ freq: 440, to: 1180, dur: 0.22, type: "triangle", gain: 0.18 }); },
  shutter() {
    noise({ dur: 0.09, gain: 0.34, freq: 2600, q: 0.6 });
    blip({ freq: 1500, to: 400, dur: 0.07, type: "square", gain: 0.08, delay: 0.02 });
  },
  match(tier) {
    const base = tier >= 4 ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : tier === 3 ? [523.25, 659.25, 783.99] : [440, 523.25];
    base.forEach((f, i) => blip({ freq: f, dur: 0.26, type: "triangle", gain: 0.15, delay: i * 0.075 }));
    if (tier >= 4) noise({ dur: 0.5, gain: 0.1, freq: 5200, q: 0.4, delay: 0.05 });
  },
  fail() {
    blip({ freq: 392, to: 262, dur: 0.26, type: "sine", gain: 0.13 });
    blip({ freq: 196, to: 165, dur: 0.3, type: "sine", gain: 0.1, delay: 0.12 });
  },
  combo(n) {
    blip({ freq: 900 + Math.min(n, 8) * 70, to: 1500 + Math.min(n, 8) * 60, dur: 0.14, type: "sine", gain: 0.13 });
  },
  lock() {
    blip({ freq: 880, dur: 0.07, type: "square", gain: 0.07 });
    blip({ freq: 1320, dur: 0.09, type: "square", gain: 0.06, delay: 0.06 });
  },
  pop() { blip({ freq: 1046, dur: 0.08, type: "sine", gain: 0.08 }); },
};

/* ---------------- 语音 ---------------- */
let voicePick = null;
export function pickVoice() {
  if (!window.speechSynthesis) return null;
  if (voicePick) return voicePick;
  const list = window.speechSynthesis.getVoices() || [];
  const zh = list.filter((v) => /zh|cmn|Chinese/i.test(v.lang) || /Chinese|中文|普通话/i.test(v.name));
  voicePick =
    zh.find((v) => /Xiaoxiao|Huihui|Yaoyao|Tingting|女/i.test(v.name)) ||
    zh[0] || list[0] || null;
  return voicePick;
}
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { voicePick = null; pickVoice(); };
}

export function say(text) {
  if (!voiceOn || !text || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = "zh-CN";
    u.rate = 1.08;
    u.pitch = 1.45;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

/* ---------------- 粒子 ---------------- */
export function burst(layer, x, y, opts = {}) {
  if (!layer) return;
  const { count = 18, spread = 170, size = 8, dur = 1.05 } = opts;
  for (let i = 0; i < count; i++) {
    const s = document.createElement("i");
    s.className = "spark";
    const a = Math.random() * Math.PI * 2;
    const r = spread * (0.35 + Math.random() * 0.9);
    s.style.left = x + "px";
    s.style.top = y + "px";
    s.style.width = s.style.height = size * (0.5 + Math.random()) + "px";
    s.style.background = PALETTE[(Math.random() * PALETTE.length) | 0];
    s.style.borderRadius = Math.random() > 0.6 ? "50%" : "2px";
    s.style.setProperty("--dx", Math.cos(a) * r + "px");
    s.style.setProperty("--dy", Math.sin(a) * r - 40 + "px");
    s.style.setProperty("--rot", ((Math.random() - 0.5) * 720) | 0 + "deg");
    s.style.animationDuration = dur * (0.7 + Math.random() * 0.6) + "s";
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1800);
  }
}

export function rain(layer, duration = 1600) {
  if (!layer) return;
  const w = layer.clientWidth;
  const t0 = performance.now();
  const drop = () => {
    if (performance.now() - t0 > duration) return;
    const s = document.createElement("i");
    s.className = "spark";
    s.style.left = Math.random() * w + "px";
    s.style.top = "-14px";
    s.style.width = s.style.height = 5 + Math.random() * 7 + "px";
    s.style.background = PALETTE[(Math.random() * PALETTE.length) | 0];
    s.style.setProperty("--dx", (Math.random() - 0.5) * 60 + "px");
    s.style.setProperty("--dy", layer.clientHeight + 40 + "px");
    s.style.setProperty("--rot", ((Math.random() - 0.5) * 540) | 0 + "deg");
    s.style.animationDuration = 1.1 + Math.random() * 0.7 + "s";
    layer.appendChild(s);
    setTimeout(() => s.remove(), 2000);
    requestAnimationFrame(() => setTimeout(drop, 26));
  };
  drop();
}

export function floatWord(layer, text, x, y, color) {
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "float-word";
  el.textContent = text;
  el.style.left = (x ?? layer.clientWidth / 2) + "px";
  el.style.top = (y ?? layer.clientHeight * 0.42) + "px";
  if (color) el.style.color = color;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

/* ---------------- Toast ---------------- */
let toastTimer = 0;
export function toast(text, alt = false) {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast" + (alt ? " alt" : "");
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2800);
  clearTimeout(toastTimer);
  while (wrap.children.length > 3) wrap.firstChild.remove();
}

export function vibrate(ms = 18) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
}
