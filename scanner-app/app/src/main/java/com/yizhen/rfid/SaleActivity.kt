package com.yizhen.rfid

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

/**
 * 销售出单页：WebView 内嵌服务端出单界面（与手机/电脑网页同源同界面）。
 *
 * - URL 携带 token，网页端免登录直接进入（token 当天有效，服务端校验）
 * - JS 桥 YzApp.scan(type)：barcode / qrcode 走摄像头扫码；epc 用【出单功率】小功率单次识别，
 *   扫到第一枚标签即停并回调网页 window.YzScanner.onResult(code, type)
 * - 机身扳机 = 快捷 EPC 识别（与网页“扫EPC码”按钮等效）
 */
class SaleActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var tvPower: TextView
    private val main = Handler(Looper.getMainLooper())

    private var tone: ToneGenerator? = null
    private var epcScanning = false
    private var lastTriggerAt = 0L

    // -------------------------------- 生命周期

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_sale)
        prefs = Prefs(this)
        tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)

        web = findViewById(R.id.webSale)
        tvPower = findViewById(R.id.tvSalePower)
        tvPower.text = "EPC ${prefs.salePower}dBm"
        tvPower.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        findViewById<TextView>(R.id.btnSaleBack).setOnClickListener { finish() }

        if (prefs.authToken.isBlank() || prefs.authOrigin.isBlank()) {
            backToLogin(); return
        }
        setupWebView()
        web.loadUrl("${prefs.authOrigin}/?token=${prefs.authToken}")
    }

    override fun onResume() {
        super.onResume()
        tvPower.text = "EPC ${prefs.salePower}dBm"
        // FUN_KEY 扳机广播（与 MainActivity 同一机制）：出单页内扳机 = EPC 识别
        val filter = IntentFilter().apply {
            TriggerChannels.actionsForMode(prefs.triggerMode).forEach { addAction(it) }
        }
        if (filter.countActions() > 0) {
            try {
                ContextCompat.registerReceiver(this, triggerReceiver, filter,
                    ContextCompat.RECEIVER_EXPORTED)
            } catch (_: Exception) {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(triggerReceiver, filter)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        stopEpcScan()
        try { unregisterReceiver(triggerReceiver) } catch (_: Exception) {}
    }

    override fun onDestroy() {
        super.onDestroy()
        stopEpcScan()
        try { tone?.release() } catch (_: Exception) {}
        main.removeCallbacksAndMessages(null)
    }

    // -------------------------------- WebView 与 JS 桥

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                // 会话失效（隔日/服务端重启）：网页回落到登录页 → 回 App 登录页重新扫码
                main.postDelayed({
                    if (isFinishing) return@postDelayed
                    web.evaluateJavascript("window.__yzLoginOk === true") { ok ->
                        if (ok != "true") {
                            Toast.makeText(this@SaleActivity, R.string.sale_session_expired, Toast.LENGTH_SHORT).show()
                            backToLogin()
                        }
                    }
                }, 2500)
            }
        }
        web.addJavascriptInterface(YzBridge(), "YzApp")
    }

    /** 注入网页的 JS 接口：window.YzApp.scan('barcode'|'qrcode'|'epc')。 */
    private inner class YzBridge {
        @JavascriptInterface
        fun scan(type: String) {
            main.post { doScan(type) }
        }
    }

    private fun doScan(type: String) {
        when (type.lowercase()) {
            "barcode" -> launchCamera(ScanOptions.ONE_D_CODE_TYPES, "barcode")
            "qrcode" -> launchCamera(listOf(ScanOptions.QR_CODE), "qrcode")
            "epc" -> startEpcScan()
            else -> toast(R.string.sale_scan_type_unknown)
        }
    }

    private val cameraLauncher = registerForActivityResult(ScanContract()) { res ->
        val code = res.contents?.trim().orEmpty()
        if (code.isNotEmpty()) {
            beep()
            jsCallback(code, pendingScanType)
        }
    }

    private var pendingScanType = "barcode"

    private fun launchCamera(formats: Collection<String>, type: String) {
        pendingScanType = type
        val opts = ScanOptions()
        opts.setDesiredBarcodeFormats(formats)
        opts.setPrompt("")
        opts.setBeepEnabled(false)
        opts.setOrientationLocked(false)
        cameraLauncher.launch(opts)
    }

    // -------------------------------- EPC 小功率识别

    private fun startEpcScan() {
        if (epcScanning) return
        if (!RfidManager.ready) {
            // 无 UHF 模块：退化为摄像头扫条码（与盘点页兜底策略一致）
            toast(R.string.demo_mode)
            launchCamera(ScanOptions.ONE_D_CODE_TYPES, "barcode")
            return
        }
        jsState(true)
        epcScanning = true
        val ok = RfidManager.start { epc, _ -> onEpcTag(epc) }
        if (!ok) {
            epcScanning = false
            jsState(false)
            toast(R.string.rfid_fail)
        }
    }

    private fun onEpcTag(epcRaw: String) {
        if (!epcScanning) return
        val epc = epcRaw.uppercase()
        stopEpcScan()
        beep()
        jsCallback(epc, "epc")
    }

    private fun stopEpcScan() {
        if (!epcScanning) return
        epcScanning = false
        RfidManager.stop()
        jsState(false)
    }

    // -------------------------------- 网页回调

    private fun jsEscape(s: String) =
        s.replace("\\", "\\\\").replace("'", "\\'").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "")

    private fun jsCallback(code: String, type: String) {
        if (isFinishing) return
        web.evaluateJavascript(
            "window.YzScanner && window.YzScanner.onResult('${jsEscape(code)}','$type')", null)
    }

    private fun jsState(scanning: Boolean) {
        if (isFinishing) return
        web.evaluateJavascript(
            "window.YzScanner && window.YzScanner.onState($scanning)", null)
    }

    // -------------------------------- EPC 扫描功率切换

    override fun onStart() {
        super.onStart()
        // 进出单页即切到出单小功率，离开（onStop）恢复盘点功率
        if (RfidManager.ready) RfidManager.setPower(prefs.salePower)
    }

    override fun onStop() {
        super.onStop()
        stopEpcScan()
        if (RfidManager.ready) RfidManager.setPower(prefs.power)
    }

    // -------------------------------- 机身扳机（广播 + 按键兜底）

    private val triggerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            if (!TriggerChannels.handlesBroadcast(prefs.triggerMode)) return
            if (prefs.triggerMode != TriggerChannels.MODE_AUTO &&
                action != TriggerChannels.actionForMode(prefs.triggerMode)) return
            val down = when (val v = intent.extras?.get("keydown")) {
                is Boolean -> v
                is String -> v.equals("true", ignoreCase = true) || v == "1"
                is Int -> v != 0
                null -> true
                else -> intent.getBooleanExtra("keydown", true)
            }
            if (down) onTrigger()
        }
    }

    private fun onTrigger() {
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lastTriggerAt < 800) return
        lastTriggerAt = now
        if (epcScanning) stopEpcScan() else startEpcScan()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!TriggerChannels.handlesKeyEvent(prefs.triggerMode))
            return super.dispatchKeyEvent(event)
        val code = event.keyCode
        val focusEditable = currentFocus is android.widget.EditText
        val candidate = (code == 66 || code == 82 || code in 96..110 || code in 131..143 || code in 280..300)
                && !(code == 66 && focusEditable)
        val src = event.source
        val physical = (src and android.view.InputDevice.SOURCE_GAMEPAD) == android.view.InputDevice.SOURCE_GAMEPAD ||
                (src and android.view.InputDevice.SOURCE_JOYSTICK) == android.view.InputDevice.SOURCE_JOYSTICK
        if (candidate || physical) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) onTrigger()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // -------------------------------- 其它

    private fun beep() {
        try {
            val ok = tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 150) ?: false
            if (!ok) {
                try { tone?.release() } catch (_: Exception) {}
                tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
                tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
            }
        } catch (_: Exception) {}
    }

    private fun toast(resId: Int) = Toast.makeText(this, resId, Toast.LENGTH_SHORT).show()

    private fun backToLogin() {
        prefs.clearAuth()
        val i = Intent(this, LoginActivity::class.java)
        i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(i)
        finish()
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
