/* ============================================================
   战报生成 · report.js
   把一次定格的结果画成一张可以保存 / 发朋友圈的图
   ============================================================ */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, x, y, maxW, lh, maxLines = 3) {
  const chars = Array.from(text);
  let line = "";
  let n = 0;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + n * lh);
      n++;
      line = ch;
      if (n >= maxLines) return n;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, y + n * lh); n++; }
  return n;
}

function drawImageCover(ctx, img, x, y, w, h, r) {
  if (!img || !img.naturalWidth) return;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** 整张放进相框（不裁切），白底，适合竖图/方图 */
function drawImageContain(ctx, img, x, y, w, h) {
  if (!img || !img.naturalWidth) return;
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * @param {Object} data {pose, stars, verdict, energy, combo, title, photo(HTMLImageElement|canvas), date}
 */
export function buildReport(data) {
  const W = 900, H = 1280;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // 背景
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0c1712");
  g.addColorStop(0.55, "#0a1210");
  g.addColorStop(1, "#071010");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 光晕
  const rg = ctx.createRadialGradient(W * 0.78, 120, 20, W * 0.78, 120, 620);
  rg.addColorStop(0, "rgba(214,249,122,.20)");
  rg.addColorStop(1, "rgba(214,249,122,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  const rg2 = ctx.createRadialGradient(120, H - 60, 20, 120, H - 60, 520);
  rg2.addColorStop(0, "rgba(84,227,180,.16)");
  rg2.addColorStop(1, "rgba(84,227,180,0)");
  ctx.fillStyle = rg2;
  ctx.fillRect(0, 0, W, H);

  // 顶部
  ctx.fillStyle = "#63786e";
  ctx.font = "600 20px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.fillText("FROG POSE ARENA", 60, 78);
  ctx.fillStyle = "#eaffb0";
  ctx.font = "800 44px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.fillText("奶蛙凹造型 · 战报", 60, 132);

  // 主图（等比整张放进相框，不裁掉脑袋和脚）
  const iy = 172, ih = 560;
  if (data.img && data.img.naturalWidth) {
    ctx.save();
    roundRect(ctx, 60, iy, W - 120, ih, 26);
    ctx.clip();
    ctx.fillStyle = "#f6f8f2";
    ctx.fillRect(60, iy, W - 120, ih);
    drawImageContain(ctx, data.img, 60, iy, W - 120, ih);
    ctx.restore();
  }
  ctx.save();
  roundRect(ctx, 60, iy, W - 120, ih, 26);
  ctx.strokeStyle = "rgba(214,249,122,.38)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 名次角标
  ctx.fillStyle = "rgba(6,10,8,.72)";
  roundRect(ctx, 84, iy + 22, 118, 44, 12);
  ctx.fill();
  ctx.fillStyle = "#d6f95a";
  ctx.font = "800 22px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.fillText("#" + data.idx, 102, iy + 52);

  // 用户定格照
  if (data.photo) {
    const pw = 168, ph = 126, px = W - 60 - pw, py = iy + ih - ph - 22;
    ctx.save();
    roundRect(ctx, px - 4, py - 4, pw + 8, ph + 8, 16);
    ctx.fillStyle = "rgba(8,14,11,.86)";
    ctx.fill();
    ctx.restore();
    drawImageCover(ctx, data.photo, px, py, pw, ph, 12);
    // 角标放在小图内部左上角，浅色照片上也看得清
    ctx.save();
    roundRect(ctx, px + 7, py + 7, 62, 21, 8);
    ctx.fillStyle = "rgba(8,14,11,.66)";
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#eaffb0";
    ctx.font = "700 12px 'Microsoft YaHei', system-ui, sans-serif";
    ctx.fillText("你的定格", px + 14, py + 22);
  }

  // 名字
  let y = iy + ih + 74;
  ctx.fillStyle = "#f4ffe8";
  ctx.font = "900 50px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.fillText(data.name, 60, y);

  // 星星
  ctx.font = "800 34px system-ui, sans-serif";
  const stars = "★".repeat(data.stars) + "☆".repeat(5 - data.stars);
  ctx.fillStyle = "#ffd166";
  ctx.fillText(stars, 60 + ctx.measureText(data.name).width * 0 + 4, y + 46);

  // 描述
  ctx.fillStyle = "#8ba398";
  ctx.font = "500 21px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.fillText(data.tag, 60, y + 92);

  // 点评
  const vy = y + 132;
  ctx.save();
  roundRect(ctx, 60, vy, W - 120, 130, 20);
  ctx.fillStyle = "rgba(214,249,122,.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(214,249,122,.22)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#d9eecb";
  ctx.font = "500 24px 'Microsoft YaHei', system-ui, sans-serif";
  wrap(ctx, data.verdict, 84, vy + 44, W - 168, 36, 3);

  // 数据
  const sy = vy + 168;
  const cells = [
    ["蛙力值", String(data.energy)],
    ["连击", String(data.combo)],
    ["称号", data.title],
  ];
  const cw = (W - 120 - 24) / 3;
  cells.forEach((cell, i) => {
    const cx = 60 + i * (cw + 12);
    ctx.save();
    roundRect(ctx, cx, sy, cw, 104, 18);
    ctx.fillStyle = "rgba(255,255,255,.04)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#63786e";
    ctx.font = "600 16px 'Microsoft YaHei', system-ui, sans-serif";
    ctx.fillText(cell[0], cx + 20, sy + 34);
    ctx.fillStyle = "#d6f95a";
    ctx.font = "800 32px 'Microsoft YaHei', system-ui, sans-serif";
    ctx.fillText(cell[1], cx + 20, sy + 78);
  });

  // 底
  ctx.fillStyle = "#3f5349";
  ctx.font = "500 18px 'Microsoft YaHei', system-ui, sans-serif";
  ctx.fillText(data.date, 60, H - 46);
  ctx.textAlign = "right";
  ctx.fillText("和奶蛙一起凹造型 🐸", W - 60, H - 46);
  ctx.textAlign = "left";

  return c;
}

export function downloadReport(data) {
  const canvas = buildReport(data);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `奶蛙战报-${data.name}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); resolve(); }, 800);
    }, "image/png");
  });
}
