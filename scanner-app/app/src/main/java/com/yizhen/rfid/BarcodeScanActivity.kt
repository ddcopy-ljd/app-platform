package com.yizhen.rfid

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.zxing.ResultPoint
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import java.util.Locale

/**
 * 摄像头连续条码扫描页（手机兜底：设备上没有 UHF RFID 模块时使用）。
 *
 * 与 UHF 扳机完全等价的盘点入口：识别到的条码内容（统一转大写）即视为 EPC，
 * 逐条回调给 MainActivity，后续比对/去重/上传走同一套流程。
 *
 * 本页负责会话级去重：同一个条码在本次扫码过程中只回调一次，重复拍到只计重复数，
 * 不入库、不上传，避免同一标签被连续识别造成的流量浪费。
 */
class BarcodeScanActivity : AppCompatActivity() {

    companion object {
        /** 由 MainActivity 在打开本页前设置，每识别到一个【新】条码在主线程回调一次。
         *  返回 false 表示盘点任务已结束，本页自动关闭。页面关闭时由 MainActivity 置空。 */
        @Volatile
        var onBarcode: ((String) -> Boolean)? = null
    }

    private lateinit var barcodeView: DecoratedBarcodeView
    private lateinit var tvCounter: TextView
    private val seen = HashSet<String>()
    private var dupCount = 0
    private var cameraStarted = false

    private val permLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startCamera()
            else {
                Toast.makeText(this, R.string.camera_no_permission, Toast.LENGTH_LONG).show()
                finish()
            }
        }

    override fun attachBaseContext(base: Context) {
        val lang = base.getSharedPreferences("rfid", Context.MODE_PRIVATE).getString("lang", "zh") ?: "zh"
        val locale = if (lang == "en") Locale.ENGLISH else Locale.SIMPLIFIED_CHINESE
        Locale.setDefault(locale)
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(locale)
        super.attachBaseContext(base.createConfigurationContext(cfg))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_barcode)

        barcodeView = findViewById(R.id.barcodeView)
        tvCounter = findViewById(R.id.tvCameraCounter)
        findViewById<TextView>(R.id.btnCameraDone).setOnClickListener { finish() }

        barcodeView.decodeContinuous(object : BarcodeCallback {
            override fun barcodeResult(result: BarcodeResult?) {
                val raw = result?.text?.trim().orEmpty()
                if (raw.isEmpty()) return
                // 条码内容统一转大写当 EPC；同一会话内同码只处理一次
                val code = raw.uppercase()
                if (!seen.add(code)) {
                    dupCount++
                    updateCounter()
                    return
                }
                val accepted = try {
                    onBarcode?.invoke(code) ?: false
                } catch (_: Exception) {
                    false
                }
                if (!accepted) {
                    // 主管已结束任务 / 任务进入待核对：停止扫描并退出
                    Toast.makeText(
                        this@BarcodeScanActivity,
                        R.string.task_stopped_remote, Toast.LENGTH_SHORT
                    ).show()
                    finish()
                    return
                }
                updateCounter()
            }

            override fun possibleResultPoints(resultPoints: MutableList<ResultPoint>?) {}
        })

        if (hasCameraPermission()) startCamera()
        else if (!permissionRequested) {
            permissionRequested = true
            permLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun hasCameraPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED

    private fun startCamera() {
        if (cameraStarted) return
        cameraStarted = true
        barcodeView.resume()
        updateCounter()
    }

    private fun updateCounter() {
        if (!::tvCounter.isInitialized) return
        tvCounter.text = getString(R.string.camera_counter, seen.size, dupCount)
    }

    override fun onResume() {
        super.onResume()
        if (cameraStarted) barcodeView.resume()
    }

    override fun onPause() {
        super.onPause()
        barcodeView.pause()
    }
}
