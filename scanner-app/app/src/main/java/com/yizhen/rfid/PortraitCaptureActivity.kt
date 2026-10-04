package com.yizhen.rfid

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
 * - 镜头变焦：首次进入按镜头能力自动给一档近焦（小标签更好扫），双指捏合可手动放大/缩小，档位会记住
 */
class PortraitCaptureActivity : Activity() {

    private lateinit var dbv: DecoratedBarcodeView
    private lateinit var tvZoom: TextView
    private lateinit var capture: CaptureManager
    private lateinit var prefs: Prefs
    private lateinit var scaleDetector: ScaleGestureDetector

    private var zoom = 0
    @Volatile private var maxZoom = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
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

        capture = CaptureManager(this, dbv)
        capture.initializeFromIntent(intent, savedInstanceState)
        capture.decode()

        zoom = prefs.camZoom
        setupPinchZoom()
        // 预览启动后才能读到镜头最大变焦档位，此时再套用变焦
        dbv.barcodeView.addStateListener(object : CameraPreview.StateListener {
            override fun previewSized() {}
            override fun previewStarted() { applyZoom() }
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
                    prefs.camZoomAuto = false   // 手动调过之后不再自动
                    applyZoom()
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
        val manual = !prefs.camZoomAuto
        dbv.changeCameraParameters { par ->
            if (par.isZoomSupported) {
                maxZoom = par.maxZoom
                // 自动档：取镜头最大变焦的 30%（首饰条码/二维码都很小，稍近一点更好扫）；手动档用手捏过的档位
                val z = if (manual) zoom else (par.maxZoom * 0.3f).roundToInt()
                par.zoom = z.coerceIn(0, par.maxZoom)
                if (!manual) { zoom = z; prefs.camZoom = z }
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
            val auto = if (prefs.camZoomAuto) getString(R.string.capture_auto) else ""
            tvZoom.text = getString(R.string.capture_zoom,
                zoom.coerceIn(0, maxZoom), maxZoom, auto)
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
