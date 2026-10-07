package com.yizhen.scanassistant

import android.app.Activity
import android.hardware.Camera
import android.os.Bundle
import android.view.ScaleGestureDetector
import android.widget.TextView
import com.journeyapps.barcodescanner.CameraPreview
import com.journeyapps.barcodescanner.CaptureManager
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.camera.CameraSettings
import kotlin.math.roundToInt

/**
 * 竖屏扫码页（替代库自带的 CaptureActivity）：
 * - 固定竖屏，不再横过来
 * - 连续自动对焦 + 条码场景/测光/曝光，靠得近也能自动合焦
 * - 镜头变焦：首次进入按镜头能力自动给一档近焦（小标签更好扫），双指捏合可手动放大/缩小
 *
 * 用于扫激活码/任务二维码（ScanContract 的 CaptureActivity）。
 * 复用 scanner-app 版本：改包名；去掉旧工程多语言 attachBaseContext 耦合。
 */
class PortraitCaptureActivity : Activity() {

    private lateinit var dbv: DecoratedBarcodeView
    private lateinit var tvZoom: TextView
    private lateinit var capture: CaptureManager
    private lateinit var scaleDetector: ScaleGestureDetector

    private var zoom = 0
    @Volatile private var maxZoom = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_capture)
        dbv = findViewById(R.id.dbv)
        tvZoom = findViewById(R.id.tvZoom)

        // 相机设置：连续自动对焦 + 条码场景 + 测光/曝光，提升小标签识别率
        val settings = CameraSettings()
        settings.isAutoFocusEnabled = true
        settings.isContinuousFocusEnabled = true
        settings.isBarcodeSceneModeEnabled = true
        settings.isMeteringEnabled = true
        settings.isExposureEnabled = true
        dbv.cameraSettings = settings
        dbv.decoderFactory = RotateDecoderFactory()   // 横放/竖放的条码都能扫

        capture = CaptureManager(this, dbv)
        capture.initializeFromIntent(intent, savedInstanceState)
        capture.decode()

        setupPinchZoom()
        // 预览启动后才能读到镜头最大变焦档位，此时再套用变焦
        dbv.barcodeView.addStateListener(object : CameraPreview.StateListener {
            override fun previewSized() {}
            // 每次进入都重新自动设置（连续自动对焦 + 自动近焦），不沿用上次的手动档
            override fun previewStarted() { zoom = 0; applyZoom() }
            override fun previewStopped() {}
            override fun cameraError(error: Exception?) {}
            override fun cameraClosed() {}
        })
    }

    private fun setupPinchZoom() {
        scaleDetector = ScaleGestureDetector(this,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    val f = detector.scaleFactor
                    if (f > 1.03) zoom += 1
                    else if (f < 0.97) zoom -= 1
                    applyZoom()   // 仅本次扫码有效，不记忆
                    return true
                }
            })
        dbv.setOnTouchListener { v, ev ->
            scaleDetector.onTouchEvent(ev)
            v.performClick()
            true
        }
    }

    private fun applyZoom() {
        dbv.changeCameraParameters { par ->
            if (par.isZoomSupported) {
                maxZoom = par.maxZoom
                // 0 = 自动档：取镜头最大变焦的 30%；
                // 手捏过之后 zoom 非 0，按手动档位走，退出页面即失效
                val z = if (zoom == 0) (par.maxZoom * 0.3f).roundToInt() else zoom
                par.zoom = z.coerceIn(0, par.maxZoom)
            }
            val modes = par.supportedFocusModes
            par.focusMode = when {
                modes?.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE) == true ->
                    Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE
                modes?.contains(Camera.Parameters.FOCUS_MODE_AUTO) == true ->
                    Camera.Parameters.FOCUS_MODE_AUTO
                else -> par.focusMode
            }
            par
        }
        runOnUiThread {
            val tag = if (zoom == 0) getString(R.string.capture_auto) else ""
            val shown = if (zoom == 0) (maxZoom * 0.3f).roundToInt() else zoom
            tvZoom.text = getString(R.string.capture_zoom, shown.coerceIn(0, maxZoom), maxZoom, tag)
        }
    }

    override fun onResume() {
        super.onResume()
        capture.onResume()
    }

    override fun onPause() {
        super.onPause()
        capture.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        capture.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        capture.onSaveInstanceState(outState)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        capture.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        setResult(RESULT_CANCELED)
        super.onBackPressed()
    }
}
