/* ============================================================
   姿态检测引擎 · pose-engine.js
   MediaPipe Tasks Vision · PoseLandmarker（离线，本地 vendor）
   ============================================================ */

import { FilesetResolver, PoseLandmarker } from "../vendor/vision_bundle.js";

const MODEL_URL = "models/pose_landmarker_full.task";
const MODEL_CACHE = "naiwa-model-v1";

/** 带进度的模型下载，并放进 Cache Storage，第二次打开直接命中缓存 */
async function loadModelBuffer(url, onProgress) {
  try {
    if ("caches" in window) {
      const c = await caches.open(MODEL_CACHE);
      const hit = await c.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        onProgress && onProgress(buf.byteLength, buf.byteLength, "cache");
        return new Uint8Array(buf);
      }
    }
  } catch (_) {}

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error("模型下载失败 HTTP " + res.status);

  const total = Number(res.headers.get("content-length")) || 0;
  let loaded = 0;
  let bytes;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress && onProgress(loaded, total, "net");
    }
    bytes = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
    onProgress && onProgress(bytes.byteLength, bytes.byteLength, "net");
  }

  try {
    if ("caches" in window) {
      const c = await caches.open(MODEL_CACHE);
      await c.put(url, new Response(bytes.slice().buffer, {
        headers: { "content-type": "application/octet-stream" },
      }));
    }
  } catch (_) {}
  return bytes;
}

export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this.running = false;
    this.raf = 0;
    this.video = null;
    this.onResult = null;
    this.onError = null;
    this.minGap = 1000 / 30;
    this.lastTs = -1;
    this.fps = 0;
    this._fpsT = 0;
    this._fpsN = 0;
    this.delegate = "GPU";
  }

  async init({ onProgress } = {}) {
    const fileset = await FilesetResolver.forVisionTasks("vendor/wasm");
    const modelBuffer = await loadModelBuffer(MODEL_URL, onProgress);

    const build = (delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetBuffer: modelBuffer,
          delegate,
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });

    try {
      this.landmarker = await build("GPU");
      this.delegate = "GPU";
    } catch (err) {
      console.warn("[奶蛙] GPU 委托失败，改用 CPU", err);
      this.landmarker = await build("CPU");
      this.delegate = "CPU";
    }
    return this;
  }

  attach(video) {
    this.video = video;
  }

  start() {
    if (this.running || !this.landmarker || !this.video) return;
    this.running = true;
    this.lastTs = -1;
    this._tick();
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  _tick = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._tick);
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;

    const now = performance.now();
    if (now - this.lastTs < this.minGap) return;
    this.lastTs = now;

    try {
      const res = this.landmarker.detectForVideo(v, now);
      const lm = res && res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
      this._fpsN++;
      if (now - this._fpsT > 900) {
        this.fps = Math.round((this._fpsN * 1000) / (now - this._fpsT));
        this._fpsT = now;
        this._fpsN = 0;
      }
      if (this.onResult) this.onResult(lm, res);
    } catch (err) {
      console.error("[奶蛙] 检测失败", err);
      if (this.onError) this.onError(err);
    }
  };

  close() {
    this.stop();
    try { this.landmarker && this.landmarker.close(); } catch (_) {}
    this.landmarker = null;
  }
}

/** 打开摄像头 */
export async function openCamera(video, { width = 1280, height = 960 } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("这个浏览器不支持摄像头访问，换 Chrome / Edge 试试");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: width },
      height: { ideal: height },
      aspectRatio: { ideal: 4 / 3 },
    },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  await new Promise((resolve) => {
    if (video.videoWidth) return resolve();
    video.onloadedmetadata = () => resolve();
    setTimeout(resolve, 2500);
  });
  return stream;
}
