package com.yizhen.rfid

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONArray
import org.json.JSONObject

/**
 * 通用网页容器——App 只是一个"壳"：
 * 业务页面（销售出单 sale.html、库存盘点 stock.html…）全部由服务端提供，
 * 本 Activity 负责 WebView 加载 + 注入统一 JS 桥 + 机身扳机转发 + 硬件反馈。
 *
 * JS 桥 window.YzApp：
 *  - scan('barcode'|'qrcode'|'epc')   单次识别（epc 用出单小功率，扫到第一枚即停）
 *  - device()                         设备信息 JSON：{key,name,stock,sale,ready}
 *  - setPower(dbm) / power()          设置 / 读取当前功率
 *  - stockStart() / stockStop()       连续盘点扫描（自动切盘点功率），标签批量回调
 *  - beep() / vibrate(ms)             提示音 / 震动（供页面按业务规则触发）
 * 网页回调 window.YzScanner：
 *  - onResult(code, type)             单次识别结果
 *  - onState(scanning)                EPC 扫描状态（开始/停止）
 *  - onTags(tags)                     盘点批量标签 [{epc,rssi},...]（约150ms一批）
 * 网页可定义 window.YzTrigger = { onTrigger() } 接管机身扳机。
 */
class WebActivity : BaseActivity() {

    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var tvTitle: TextView
    private lateinit var tvPower: TextView
    private val main = Handler(Looper.getMainLooper())

    private var tone: ToneGenerator? = null
    private var vibrator: Vibrator? = null

    private var pageUrl = "sale.html"

    // 单次 EPC 识别（出单）
    private var epcScanning = false
    // 连续盘点扫描
    private var stockScanning = false
    private val batch = LinkedHashMap<String, Int>() // 待推送给页面的 EPC->RSSI
    private var lastTriggerAt = 0L
    private var pendingScanType = "barcode"

    // -------------------------------- 生命周期

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_web)
        prefs = Prefs(this)
        tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
        vibrator = getSystemService(VIBRATOR_SERVICE) as? Vibrator

        pageUrl = intent?.getStringExtra("url")?.trim().orEmpty().ifBlank { "sale.html" }
        web = findViewById(R.id.webView)
        tvTitle = findViewById(R.id.tvWebTitle)
        tvPower = findViewById(R.id.tvWebPower)
        tvPower.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        findViewById<TextView>(R.id.btnWebBack).setOnClickListener { finish() }

        if (prefs.authToken.isBlank() || prefs.authOrigin.isBlank()) {
            backToLogin(); return
        }
        setupWebView()
        web.loadUrl("${prefs.authOrigin}/$pageUrl?token=${prefs.authToken}")

        // 功率角标：后台读一次真实功率（阻塞串口调用）
        Thread {
            val p = RfidManager.power()
            if (p in 1..33) main.post { if (!isFinishing) tvPower.text = "${p}dBm" }
        }.start()

        // 标签批量推送循环
        main.post(object : Runnable {
            override fun run() {
                flushBatch()
                main.postDelayed(this, 150)
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        stopStockScan()
        stopEpcSingle()
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
        web.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView?, title: String?) {
                if (!title.isNullOrBlank()) tvTitle.text = title
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                // 会话失效（隔日/服务端重启）：页面回落到未登录 → 回 App 登录页重新扫码
                main.postDelayed({
                    if (isFinishing) return@postDelayed
                    web.evaluateJavascript("window.__yzLoginOk === true") { ok ->
                        if (ok != "true") {
                            Toast.makeText(this@WebActivity,
                                R.string.sale_session_expired, Toast.LENGTH_SHORT).show()
                            backToLogin()
                        }
                    }
                }, 2500)
            }
        }
        web.addJavascriptInterface(YzBridge(), "YzApp")
    }

    private inner class YzBridge {

        @JavascriptInterface
        fun scan(type: String) {
            main.post { doScan(type) }
        }

        @JavascriptInterface
        fun device(): String = JSONObject()
            .put("key", prefs.deviceKey)
            .put("name", prefs.deviceName)
            .put("stock", prefs.power)
            .put("sale", prefs.salePower)
            .put("ready", RfidManager.ready)
            .toString()

        @JavascriptInterface
        fun setPower(dbm: Int) {
            RfidManager.setPower(dbm)
            main.post {
                if (!isFinishing) tvPower.text = "${dbm}dBm"
            }
        }

        @JavascriptInterface
        fun power(): Int = RfidManager.power()

        @JavascriptInterface
        fun stockStart(): Boolean {
            if (stockScanning) return true
            if (!RfidManager.ready) return false
            // 出单页可能把功率切成了出单小功率，盘点前恢复盘点功率
            RfidManager.setPower(prefs.power)
            main.post { if (!isFinishing) tvPower.text = "${prefs.power}dBm" }
            val ok = RfidManager.start { epc, rssi ->
                synchronized(batch) { batch[epc.uppercase()] = rssi }
            }
            if (!ok) return false
            stockScanning = true
            main.post { jsState(true) }
            return true
        }

        @JavascriptInterface
        fun stockStop() {
            main.post { stopStockScan() }
        }

        @JavascriptInterface
        fun beep() {
            main.post { this@WebActivity.beep() }
        }

        @JavascriptInterface
        fun vibrate(ms: Int) {
            try {
                val d = ms.coerceIn(20, 2000).toLong()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator?.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION") vibrator?.vibrate(d)
                }
            } catch (_: Exception) {}
        }
    }

    // -------------------------------- 单次识别（出单）

    private fun doScan(type: String) {
        when (type.lowercase()) {
            "barcode" -> launchCamera(ScanOptions.ONE_D_CODE_TYPES, "barcode")
            "qrcode" -> launchCamera(listOf(ScanOptions.QR_CODE), "qrcode")
            "epc" -> startEpcSingle()
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

    private fun launchCamera(formats: Collection<String>, type: String) {
        pendingScanType = type
        val opts = ScanOptions()
        opts.setDesiredBarcodeFormats(formats)
        opts.setPrompt("")
        opts.setBeepEnabled(false)
        opts.setOrientationLocked(true)
        opts.setCaptureActivity(PortraitCaptureActivity::class.java)
        cameraLauncher.launch(opts)
    }

    /** 出单 EPC：切出单小功率，扫到第一枚标签即停并回调网页。 */
    private fun startEpcSingle() {
        if (epcScanning) return
        if (!RfidManager.ready) {
            // 无 UHF 模块：退化为摄像头扫条码
            toast(R.string.demo_mode)
            launchCamera(ScanOptions.ONE_D_CODE_TYPES, "barcode")
            return
        }
        RfidManager.setPower(prefs.salePower)
        main.post { if (!isFinishing) tvPower.text = "${prefs.salePower}dBm" }
        epcScanning = true
        jsState(true)
        val ok = RfidManager.start { epc, _ ->
            if (!epcScanning) return@start
            stopEpcSingleInternal()
            beep()
            jsCallback(epc.uppercase(), "epc")
        }
        if (!ok) {
            epcScanning = false
            jsState(false)
            rfidErrorToast(this, R.string.rfid_fail)
        }
    }

    private fun stopEpcSingleInternal() {
        epcScanning = false
        RfidManager.stop()
        jsState(false)
    }

    private fun stopEpcSingle() {
        if (epcScanning) stopEpcSingleInternal()
    }

    // -------------------------------- 连续盘点扫描

    private fun stopStockScan() {
        if (!stockScanning) return
        stockScanning = false
        RfidManager.stop()
        flushBatch()
        jsState(false)
    }

    /** 把攒到的标签批量推给页面：window.YzScanner.onTags([{epc,rssi},...]) */
    private fun flushBatch() {
        synchronized(batch) {
            if (batch.isEmpty()) return
            val arr = JSONArray()
            for ((epc, rssi) in batch) {
                arr.put(JSONObject().put("epc", epc).put("rssi", rssi))
            }
            batch.clear()
            if (isFinishing) return
            web.evaluateJavascript(
                "window.YzScanner&&window.YzScanner.onTags($arr)", null)
        }
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

    // -------------------------------- 机身扳机（转发给页面接管）

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
        val now = SystemClock.elapsedRealtime()
        if (now - lastTriggerAt < 600) return
        lastTriggerAt = now
        if (isFinishing) return
        // 页面自定义 window.YzTrigger = { onTrigger() } 优先；未定义则由页面自行兜底
        web.evaluateJavascript("window.YzTrigger&&window.YzTrigger.onTrigger()", null)
    }

    override fun onResume() {
        super.onResume()
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
        try { unregisterReceiver(triggerReceiver) } catch (_: Exception) {}
    }

    override fun onStop() {
        super.onStop()
        // 离开页面即停止硬件扫描，回来由页面/扳机重新启动
        stopStockScan()
        stopEpcSingle()
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
