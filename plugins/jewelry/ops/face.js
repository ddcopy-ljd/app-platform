/* 懿臻珠宝云运维端 · 人脸确认原语（face-api.js）
 *
 * 设计约束（实测经验）：
 * - 检测与提交解耦：检测循环只更新画面框选与缓存 latest，由用户点「确认」才产出 descriptor；
 * - 模型全部本地加载（vendor/models），不依赖任何外网 CDN；
 * - 非安全上下文（非 HTTPS 且非 localhost）无 mediaDevices，由调用方回落应急口令；
 * - stop() 必须停摄像头轨道与 RAF，否则摄像头灯常亮。
 */
(function () {
  "use strict";

  var modelsPromise = null;
  var stream = null;
  var rafId = null;
  var running = false;
  var latest = null;
  var detectTimer = 0;

  function loadModels(base) {
    if (modelsPromise) return modelsPromise;
    var uri = base.replace(/\/$/, "") + "/vendor/models";
    modelsPromise = faceapi.nets.tinyFaceDetector.loadFromUri(uri)
      .then(function () { return faceapi.nets.faceLandmark68Net.loadFromUri(uri); })
      .then(function () { return faceapi.nets.faceRecognitionNet.loadFromUri(uri); });
    return modelsPromise;
  }

  function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject({ code: "NO_MEDIA", message: "当前环境不可用摄像头（人脸需要 HTTPS 或本机访问）" });
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 360 }, height: { ideal: 270 } },
      audio: false,
    });
  }

  function drawBox(videoEl, canvasEl, det) {
    canvasEl.width = videoEl.videoWidth || videoEl.clientWidth;
    canvasEl.height = videoEl.videoHeight || videoEl.clientHeight;
    var ctx = canvasEl.getContext("2d");
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (!det) return;
    var b = det.detection.box;
    ctx.strokeStyle = "#12b76a";
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x, b.y, b.width, b.height);
  }

  function loop(videoEl, canvasEl, onUpdate) {
    if (!running) return;
    rafId = requestAnimationFrame(function () { loop(videoEl, canvasEl, onUpdate); });
    var now = Date.now();
    if (now - detectTimer < 250) return;  // ~4fps 检测，够用且省电
    detectTimer = now;
    faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor()
      .then(function (det) {
        if (!running) return;
        latest = det || null;
        drawBox(videoEl, canvasEl, det);
        onUpdate(!!det, det ? det.detection.score : 0);
      })
      .catch(function () { /* 单帧失败静默，下一帧重试 */ });
  }

  /**
   * 启动摄像头+检测。opts: {base, video, canvas, onUpdate(hasFace, score)}
   * 返回 Promise；失败 reject {code, message}，调用方回落应急口令。
   */
  function start(opts) {
    stop();
    latest = null;
    return loadModels(opts.base).then(openCamera).then(function (st) {
      stream = st;
      running = true;
      opts.video.srcObject = st;
      return opts.video.play().catch(function () {});  // autoplay 被策略拦截时不致命
    }).then(function () {
      loop(opts.video, opts.canvas, opts.onUpdate);
    });
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    latest = null;
  }

  /** 用户显式点击确认时取缓存特征（检测到脸才可点，调用方保证）。 */
  function descriptor() {
    return latest ? Array.prototype.slice.call(latest.descriptor) : null;
  }

  window.OpsFace = { loadModels: loadModels, start: start, stop: stop, descriptor: descriptor };
})();
