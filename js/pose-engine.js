/* ============================================================
   姿态检测引擎 · pose-engine.js
   MediaPipe Tasks Vision · PoseLandmarker（离线，本地 vendor）
   ============================================================ */

import { FilesetResolver, PoseLandmarker } from "../vendor/vision_bundle.js";

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

  async init() {
    const fileset = await FilesetResolver.forVisionTasks("vendor/wasm");
    const build = (delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "models/pose_landmarker_full.task",
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
