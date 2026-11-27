/* ============================================================
   画骨架 · skeleton.js
   ------------------------------------------------------------
   所有 drawing 都在"屏幕坐标系"里做（x 向右，与用户看到的画面一致）：
   摄像头画面被镜像显示，所以关键点要先做 1-nx 的水平翻转。
   ============================================================ */

import { BONES, KEYS } from "./similarity.js";

/** 摄像头画面 → 画布像素的映射（object-fit: cover） */
export class Projector {
  constructor() {
    this.boxW = 0; this.boxH = 0;
    this.drawW = 0; this.drawH = 0;
    this.offX = 0; this.offY = 0;
    this.aspect = 4 / 3;
    this.ready = false;
  }

  update(boxW, boxH, videoW, videoH) {
    if (!boxW || !boxH || !videoW || !videoH) return;
    this.boxW = boxW; this.boxH = boxH;
    const s = Math.max(boxW / videoW, boxH / videoH);
    this.drawW = videoW * s;
    this.drawH = videoH * s;
    this.offX = (boxW - this.drawW) / 2;
    this.offY = (boxH - this.drawH) / 2;
    this.aspect = videoW / videoH;
    this.ready = true;
  }

  /** metric(x 右, y 上) → 像素 */
  px(mx, my) {
    const nx = mx / this.aspect;
    const ny = -my;
    return [this.offX + nx * this.drawW, this.offY + ny * this.drawH];
  }

  /** 归一化（未镜像）→ 镜像后的像素 */
  pxRaw(nx, ny) {
    return [this.offX + (1 - nx) * this.drawW, this.offY + ny * this.drawH];
  }
}

/** object-fit: contain 的实际显示区域 */
export function containRect(boxW, boxH, imgW, imgH) {
  if (!boxW || !boxH || !imgW || !imgH) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * s, h = imgH * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

function boneWeight(a, b) {
  if ((a === "shL" && b === "elL") || (a === "shR" && b === "elR")) return 1.5; // 大臂
  if (a === "elL" || a === "elR") return 1.35; // 小臂
  if (a === "knL" || a === "knR") return 1.3; // 小腿
  if (a === "hipL" && b === "knL") return 1.4;
  if (a === "hipR" && b === "knR") return 1.4;
  if (a === "neck") return 0.55;
  if (a === "head") return 0.7;
  return 0.75;
}

/**
 * 画一副骨架
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} pts    metric 坐标点集
 * @param {Projector} proj
 * @param {Object} opt    {color, glow, width, alpha, dots, dotted}
 */
export function drawSkeleton(ctx, pts, proj, opt = {}) {
  const {
    color = "#d6f95a",
    glow = "rgba(214,249,122,.55)",
    width = 3.2,
    alpha = 1,
    dots = 3.4,
    dotted = false,
    pulse = 0,
    headR = 9,
    keys = KEYS,
    bones = BONES,
  } = opt;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const P = {};
  for (const k of keys) if (pts[k]) P[k] = proj.px(pts[k].x, pts[k].y);

  // 外发光
  ctx.strokeStyle = glow;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 18;
  ctx.lineWidth = width * 2.35;
  if (dotted) ctx.setLineDash([1, 9]);
  ctx.beginPath();
  for (const [a, b] of bones) {
    if (!P[a] || !P[b]) continue;
    ctx.moveTo(P[a][0], P[a][1]);
    ctx.lineTo(P[b][0], P[b][1]);
  }
  ctx.stroke();

  // 主线
  ctx.shadowBlur = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dotted) ctx.setLineDash([3, 7]);
  ctx.lineDashOffset = -pulse;
  ctx.beginPath();
  for (const [a, b] of bones) {
    if (!P[a] || !P[b]) continue;
    ctx.moveTo(P[a][0], P[a][1]);
    ctx.lineTo(P[b][0], P[b][1]);
  }
  ctx.stroke();

  // 关节点
  if (dots > 0) {
    ctx.setLineDash([]);
    for (const k of keys) {
      if (!P[k]) continue;
      const [x, y] = P[k];
      if (k === "head") {
        ctx.beginPath();
        ctx.arc(x, y, headR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha * 0.9;
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, headR * 0.52, 0, Math.PI * 2);
        ctx.fillStyle = "#0a130e";
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, dots, 0, Math.PI * 2);
      ctx.fillStyle = "#0a130e";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 骨骼强度提示（用肢体方向对不对来调色，不显示数字） */
export function colorFor(g, tier) {
  if (g > 0.72) return { color: "#d6f95a", glow: "rgba(214,249,122,.75)" };
  if (g > 0.45) return { color: "#54e3b4", glow: "rgba(84,227,180,.6)" };
  if (g > 0.22) return { color: "#ffd166", glow: "rgba(255,209,102,.55)" };
  return { color: "#8ba398", glow: "rgba(139,163,152,.4)" };
}

/** 目标图片上的奶蛙骨架 */
export function drawFrogSkeleton(ctx, canvas, img, frogPts, opt = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const boxW = canvas.clientWidth, boxH = canvas.clientHeight;
  if (!boxW || !boxH) return;
  if (canvas.width !== Math.round(boxW * dpr) || canvas.height !== Math.round(boxH * dpr)) {
    canvas.width = Math.round(boxW * dpr);
    canvas.height = Math.round(boxH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, boxW, boxH);
  if (!img || !img.naturalWidth) return;

  const r = containRect(boxW, boxH, img.naturalWidth, img.naturalHeight);
  const P = {};
  for (const k of KEYS) {
    const p = frogPts[k];
    P[k] = [r.x + p[0] * r.w, r.y + p[1] * r.h];
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = opt.glow || "rgba(120,240,190,.55)";
  ctx.shadowColor = opt.glow || "rgba(120,240,190,.8)";
  ctx.shadowBlur = 14;
  ctx.lineWidth = 9;
  ctx.beginPath();
  for (const [a, b] of BONES) { ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); }
  ctx.stroke();

  ctx.strokeStyle = opt.color || "#eaffb0";
  ctx.shadowBlur = 6;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const [a, b] of BONES) { ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); }
  ctx.stroke();

  for (const k of KEYS) {
    const [x, y] = P[k];
    ctx.beginPath();
    ctx.arc(x, y, k === "head" ? 7 : 3.6, 0, Math.PI * 2);
    ctx.fillStyle = k === "head" ? "#ffd166" : "#f6ffe4";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "rgba(255,240,180,.9)";
    ctx.fill();
  }
  ctx.restore();
}
