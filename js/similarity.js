/* ============================================================
   姿态相似度引擎 · similarity.js
   ------------------------------------------------------------
   输入：摄像头 33 关键点（归一化、未镜像） + 目标姿势（人体参考骨架）
   输出：0..1 的相似度，以及分项明细（供调试 / 特效使用）

   坐标系约定
   · metric  空间：x 向右（已镜像，和用户看到的画面一致），y 向上，
                  x 以画面高度为单位（x = (1-nx)*aspect），y = -ny
   · body    空间：原点=髋部中点，单位为躯干长度，
                  x 沿肩线右方向，y 沿身体向上（已抵消身体旋转）
   ============================================================ */

export const KEYS = ["head", "neck", "shL", "shR", "elL", "elR", "wrL", "wrR",
                     "hipL", "hipR", "knL", "knR", "anL", "anR"];

/** 33 点 → 我们用的 14 点（MediaPipe Pose 索引） */
const LM_INDEX = {
  shL: 11, elL: 13, wrL: 15,
  shR: 12, elR: 14, wrR: 16,
  hipL: 23, hipR: 24,
  knL: 25, knR: 26,
  anL: 27, anR: 28,
  head: 0,
};

export const BONES = [
  ["head", "neck"], ["neck", "shL"], ["neck", "shR"],
  ["shL", "elL"], ["elL", "wrL"], ["shR", "elR"], ["elR", "wrR"],
  ["shL", "shR"], ["shL", "hipL"], ["shR", "hipR"], ["hipL", "hipR"],
  ["hipL", "knL"], ["knL", "anL"], ["hipR", "knR"], ["knR", "anR"],
];

const SEGS = [["shL", "elL"], ["elL", "wrL"], ["shR", "elR"], ["elR", "wrR"],
              ["hipL", "knL"], ["knL", "anL"], ["hipR", "knR"], ["knR", "anR"]];

// 小臂/大臂/小腿/大腿同等重要，髋部与膝盖位置次要
const POS_KEYS = [
  ["wrL", 1.30], ["wrR", 1.30],
  ["anL", 0.85], ["anR", 0.85],
  ["head", 0.95], ["knL", 0.55], ["knR", 0.55],
];

const W_LIMB = 0.46;
const W_POS = 0.24;
const W_SHAPE = 0.30;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const unit = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const dot = (a, b) => a.x * b.x + a.y * b.y;

/* ---------------------------------------------------------------- */
/* 关键点提取                                                        */
/* ---------------------------------------------------------------- */

/**
 * @param {Array} landmarks MediaPipe 33 点（归一化 x/y，未镜像）
 * @param {number} aspect  画面宽/高
 * @returns {{pts: Object, score: number, missing: string[]}|null}
 */
export function extractPoints(landmarks, aspect, opts = {}) {
  if (!landmarks || landmarks.length < 29) return null;
  const pts = {};
  const missing = [];
  let visSum = 0;

  for (const key of KEYS) {
    if (key === "neck") continue;
    const idx = LM_INDEX[key];
    const p = landmarks[idx];
    if (!p) { missing.push(key); continue; }
    const vis = typeof p.visibility === "number" ? p.visibility : 1;
    // 跑到画面外太多的点视为不可靠
    if (vis < 0.28 || p.x < -0.22 || p.x > 1.22 || p.y < -0.12 || p.y > 1.22) {
      missing.push(key);
      continue;
    }
    pts[key] = { x: (1 - p.x) * aspect, y: -p.y, v: vis };
    visSum += vis;
  }

  if (missing.length > 2) {
    // 半身模式：腿脚出画不算问题，只要头肩肘手还在就行
    if (!opts.upper) return null;
    const ubMissing = missing.filter((k) => UB_KEYS.includes(k));
    if (ubMissing.length > 1) return null;
  }

  // 颈点 = 双肩中点
  if (pts.shL && pts.shR) pts.neck = mid(pts.shL, pts.shR);

  // 缺的点用邻近点补（尽量不让一次抖动直接判失败）
  const fill = (key, from, toward, t) => {
    if (pts[key] || !pts[from] || !pts[toward]) return;
    const d = sub(pts[toward], pts[from]);
    pts[key] = { x: pts[from].x + d.x * t, y: pts[from].y + d.y * t, v: 0.5 };
  };
  fill("wrL", "shL", "elL", 1.85);
  fill("elL", "shL", "wrL", 0.5);
  fill("wrR", "shR", "elR", 1.85);
  fill("elR", "shR", "wrR", 0.5);
  fill("anL", "hipL", "knL", 1.85);
  fill("knL", "hipL", "anL", 0.5);
  fill("anR", "hipR", "knR", 1.85);
  fill("knR", "hipR", "anR", 0.5);
  if (!pts.head && pts.neck) pts.head = { x: pts.neck.x, y: pts.neck.y + 0.12, v: 0.4 };

  for (const key of KEYS) {
    if (pts[key]) continue;
    if (opts.upper && !UB_KEYS.includes(key)) continue;  // 半身模式不要求腿脚
    return null;
  }

  let confidence = clamp(visSum / Math.max(1, KEYS.length - 1), 0, 1);
  if (opts.upper) {
    let s2 = 0, n2 = 0;
    for (const k of UB_KEYS) { if (pts[k]) { s2 += pts[k].v || 0; n2++; } }
    confidence = n2 ? clamp(s2 / n2, 0, 1) : 0;
  }
  return { pts, confidence, missing };
}

/* ---------------------------------------------------------------- */
/* 躯干坐标系                                                        */
/* ---------------------------------------------------------------- */

export function bodyFrame(pts) {
  const hipMid = mid(pts.hipL, pts.hipR);
  const shMid = mid(pts.shL, pts.shR);
  const torso = sub(shMid, hipMid);
  const T = len(torso);
  let right = sub(pts.shR, pts.shL);
  let up = torso;
  if (len(right) < 1e-5 || T < 1e-4) {
    // 退化：直接给一个竖直坐标系
    return { origin: hipMid, right: { x: 1, y: 0 }, up: { x: 0, y: 1 }, T: Math.max(T, 1e-3) };
  }
  right = unit(right);
  up = unit(up);
  // 用肩线把 up 正交化（肩线是可信的，躯干方向只借一点）
  const k = dot(up, right);
  up = unit({ x: up.x - right.x * k, y: up.y - right.y * k });
  if (!isFinite(up.x) || (up.x === 0 && up.y === 0)) up = { x: -right.y, y: right.x };
  if (up.y < 0) { up = { x: -up.x, y: -up.y }; }  // 保证指向头的方向
  return { origin: hipMid, right, up, T };
}

/** 把点集变换到 body 空间（x 沿肩线，y 向上，单位 = 躯干长） */
export function toBody(pts) {
  const fr = bodyFrame(pts);
  const out = {};
  for (const key of KEYS) {
    const d = sub(pts[key], fr.origin);
    out[key] = {
      x: dot(d, fr.right) / fr.T,
      y: dot(d, fr.up) / fr.T,
    };
  }
  return { coords: out, frame: fr };
}

/** body 空间坐标 → metric 空间（用于把目标骨架画到用户身上） */
export function fromBody(coords, frame) {
  const out = {};
  for (const key of KEYS) {
    const c = coords[key];
    out[key] = {
      x: frame.origin.x + frame.right.x * c.x * frame.T + frame.up.x * c.y * frame.T,
      y: frame.origin.y + frame.right.y * c.x * frame.T + frame.up.y * c.y * frame.T,
    };
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* 模板预处理                                                        */
/* ---------------------------------------------------------------- */

/**
 * 目标姿势的 human 骨架（作者坐标：y 向下，单位=躯干长）
 * @returns {{body:Object, raw:Object, frame:Object}}
 */
export function prepTemplate(human) {
  const pts = {};
  for (const key of KEYS) {
    const p = human[key];
    pts[key] = { x: p[0], y: p[1] };
  }
  // 转成 y 向上的 metric 式坐标
  const raw = {};
  for (const key of KEYS) raw[key] = { x: pts[key].x, y: -pts[key].y };
  const { coords } = toBody(raw);
  return { body: coords, raw };
}

/* ---------------------------------------------------------------- */
/* 三个分项                                                          */
/* ---------------------------------------------------------------- */

function limbScore(u, t) {
  let sum = 0, wsum = 0;
  for (const [a, b] of SEGS) {
    const du = unit(sub(u[b], u[a]));
    const dt = unit(sub(t[b], t[a]));
    const c = clamp(dot(du, dt), -1, 1);
    // 0..1，但把 90° 误差压到 0.28，让"方向反了"真正惩罚
    const s = Math.pow((1 + c) / 2, 1.35);
    sum += s;
    wsum += 1;
  }
  return wsum ? sum / wsum : 0;
}

function posScore(u, t) {
  let sum = 0, wsum = 0;
  for (const [key, w] of POS_KEYS) {
    const d = len(sub(u[key], t[key]));
    const s = Math.exp(-Math.pow(d / 0.62, 2));
    sum += s * w;
    wsum += w;
  }
  return wsum ? sum / wsum : 0;
}

function shapeScore(u, t) {
  const cu = { x: 0, y: 0 }, ct = { x: 0, y: 0 };
  for (const key of KEYS) { cu.x += u[key].x; cu.y += u[key].y; ct.x += t[key].x; ct.y += t[key].y; }
  cu.x /= KEYS.length; cu.y /= KEYS.length; ct.x /= KEYS.length; ct.y /= KEYS.length;

  let ru = 0, rt = 0;
  for (const key of KEYS) {
    ru += Math.pow(len(sub(u[key], cu)), 2);
    rt += Math.pow(len(sub(t[key], ct)), 2);
  }
  ru = Math.sqrt(ru / KEYS.length);
  rt = Math.sqrt(rt / KEYS.length);
  if (ru < 1e-6 || rt < 1e-6) return 0;
  const k = rt / ru;

  let d = 0;
  for (const key of KEYS) {
    const p = { x: (u[key].x - cu.x) * k, y: (u[key].y - cu.y) * k };
    d += len(sub(p, { x: t[key].x - ct.x, y: t[key].y - ct.y }));
  }
  d /= KEYS.length;
  return Math.exp(-Math.pow(d / 0.44, 2));
}

/* ---------------------------------------------------------------- */
/* 主入口                                                            */
/* ---------------------------------------------------------------- */

/**
 * @param {Object} userPts  extractPoints() 的结果点集（metric 空间）
 * @param {Object} tpl      prepTemplate() 的结果
 * @returns {{total:number, limb:number, pos:number, shape:number}}
 */
export function compare(userPts, tpl) {
  const { coords } = toBody(userPts);
  const limb = limbScore(coords, tpl.body);
  const pos = posScore(coords, tpl.body);
  const shape = shapeScore(userPts, tpl.raw);
  const total = W_LIMB * limb + W_POS * pos + W_SHAPE * shape;
  return { total, limb, pos, shape };
}

/** 对全部姿势打分，按分数降序 */
export function rankAll(userPts, templates) {
  const out = [];
  for (const t of templates) {
    const s = compare(userPts, t.tpl);
    out.push({ pose: t.pose, ...s });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

/* ---------------------------------------------------------------- */
/* 分档（内部用；界面不显示百分比）                                   */
/* ---------------------------------------------------------------- */

export function tierOf(score) {
  if (score >= 0.90) return 5;
  if (score >= 0.82) return 4;
  if (score >= 0.73) return 3;
  if (score >= 0.62) return 2;
  return 1;
}

export function starsOf(score) {
  return tierOf(score);
}

/** 0..1 → 0..100 的"锁定进度"，只用于进度条与特效强度 */
export function gauge(score) {
  return clamp((score - 0.45) / 0.5, 0, 1);
}

/* ================================================================
   上半身模式（坐着玩）
   ----------------------------------------------------------------
   只比对：头、双肩、双肘、双手腕。
   坐标系：原点 = 颈点（肩中点），x 沿肩线向右，y 垂直向上，
          单位 = 肩宽。这样身体前后/远近/整体倾斜都不影响打分，
          只比"手臂怎么摆、手放在哪、头歪向哪"。
   ================================================================ */

export const UB_KEYS = ["head", "neck", "shL", "shR", "elL", "elR", "wrL", "wrR"];

export const UB_BONES = [
  ["head", "neck"], ["neck", "shL"], ["neck", "shR"],
  ["shL", "elL"], ["elL", "wrL"], ["shR", "elR"], ["elR", "wrR"],
  ["shL", "shR"],
];

const UB_SEGS = [["shL", "elL"], ["elL", "wrL"], ["shR", "elR"], ["elR", "wrR"]];
const UB_HANDS = [["wrL", 1.0], ["wrR", 1.0]];
const UB_ELBOWS = [["elL", 1.0], ["elR", 1.0]];

const W_UB_ARM = 0.40;   // 四段手臂方向
const W_UB_HAND = 0.28;  // 手腕落点（手势的核心）
const W_UB_ELBOW = 0.16; // 肘部落点（区分抱头 / 比耶 / 交臂）
const W_UB_HEAD = 0.16;  // 头相对双肩的位置（歪头、后仰、前探）

/** 肩宽为尺度的上半身坐标系 */
export function upperFrame(pts) {
  const sh = sub(pts.shR, pts.shL);
  const width = len(sh) || 1e-6;
  const right = unit(sh);
  let up = { x: -right.y, y: right.x };
  const origin = mid(pts.shL, pts.shR);
  // 头在下方说明坐标系反了（倒立 / 侧躺），翻回来
  if (dot(up, sub(pts.head, origin)) < 0) up = { x: -up.x, y: -up.y };
  return { origin, right, up, S: width };
}

export function toUpperBody(pts) {
  const frame = upperFrame(pts);
  const coords = {};
  for (const key of UB_KEYS) {
    const v = sub(pts[key], frame.origin);
    coords[key] = { x: dot(v, frame.right) / frame.S, y: dot(v, frame.up) / frame.S };
  }
  return { coords, frame };
}

export function fromUpperBody(coords, frame) {
  const out = {};
  for (const key of UB_KEYS) {
    const c = coords[key];
    out[key] = {
      x: frame.origin.x + (frame.right.x * c.x + frame.up.x * c.y) * frame.S,
      y: frame.origin.y + (frame.right.y * c.x + frame.up.y * c.y) * frame.S,
    };
  }
  return out;
}

/** 目标姿势 human 骨架（y 向下、躯干为单位）→ 上半身模板 */
export function prepUpper(human) {
  const raw = {};
  for (const key of UB_KEYS) {
    const p = human[key];
    raw[key] = { x: p[0], y: -p[1] };
  }
  const { coords } = toUpperBody(raw);
  return { body: coords, raw };
}

function ubArmScore(u, t) {
  let sum = 0;
  for (const [a, b] of UB_SEGS) {
    const c = clamp(dot(unit(sub(u[b], u[a])), unit(sub(t[b], t[a]))), -1, 1);
    sum += Math.pow((1 + c) / 2, 1.25);
  }
  return sum / UB_SEGS.length;
}

function ubPointScore(u, t, keys, sigma) {
  let sum = 0, wsum = 0;
  for (const [key, w] of keys) {
    const d = len(sub(u[key], t[key]));
    sum += Math.exp(-Math.pow(d / sigma, 2)) * w;
    wsum += w;
  }
  return wsum ? sum / wsum : 0;
}

/**
 * @param {Object} userPts extractPoints() 的点集
 * @param {Object} tpl     prepUpper() 的结果
 */
export function compareUpper(userPts, tpl) {
  const { coords } = toUpperBody(userPts);
  const arm = ubArmScore(coords, tpl.body);
  const hand = ubPointScore(coords, tpl.body, UB_HANDS, 0.46);
  const elbow = ubPointScore(coords, tpl.body, UB_ELBOWS, 0.58);
  const head = ubPointScore(coords, tpl.body, [["head", 1]], 0.50);
  const total = W_UB_ARM * arm + W_UB_HAND * hand + W_UB_ELBOW * elbow + W_UB_HEAD * head;
  return { total, arm, hand, elbow, head };
}

export function rankUpper(userPts, templates) {
  const out = [];
  for (const t of templates) {
    out.push({ pose: t.pose, ...compareUpper(userPts, t.utpl) });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

/** 上半身模式只需要这些点，腿脚缺了也能玩 */
export function upperReady(pts) {
  if (!pts) return { ok: false, missing: UB_KEYS.slice() };
  const missing = UB_KEYS.filter((k) => !pts[k]);
  return { ok: missing.length <= 1, missing };
}
