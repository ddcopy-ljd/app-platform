package com.yizhen.rfid

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 启动登录页：扫网页端【手持机登录】二维码 → 网页确认 → 获取当天有效会话 → 进入主界面。
 * 已有有效会话（当天）则直接进入主界面。
 */
class LoginActivity : BaseActivity() {

    private lateinit var prefs: Prefs
    private lateinit var tvStatus: TextView
    private lateinit var tvServer: TextView
    private lateinit var etName: EditText
    private val main = Handler(Looper.getMainLooper())
    private val net = Executors.newSingleThreadExecutor()
    private var polling = false
    private var pollHkey = ""
    private var pollOrigin = ""

    private val qrLauncher = registerForActivityResult(ScanContract()) { res ->
        val code = res.contents?.trim().orEmpty()
        if (code.isNotEmpty()) onQr(code)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        prefs = Prefs(this)
        tvStatus = findViewById(R.id.tvLoginStatus)
        tvServer = findViewById(R.id.tvServer)
        etName = findViewById(R.id.etDeviceName)

        etName.setText(prefs.deviceName.ifBlank { prefs.deviceKey })
        tvServer.text = prefs.authOrigin

        findViewById<TextView>(R.id.btnLang).setOnClickListener {
            cycleLang()
            recreate()
        }
        findViewById<TextView>(R.id.btnScanLogin).setOnClickListener { scanQr() }

        tryAutoLogin()
    }

    /** 已保存 token 且当天仍有效 → 直接进入主界面。 */
    private fun tryAutoLogin() {
        if (prefs.authToken.isBlank() || prefs.authOrigin.isBlank()) return
        tvStatus.setText(R.string.login_status_checking)
        net.execute {
            val me = AuthApi.checkSession(prefs.authOrigin, prefs.authToken)
            main.post {
                if (me != null) {
                    prefs.authUserJson = me.optJSONObject("user")?.toString() ?: "{}"
                    goHome()
                } else {
                    prefs.clearAuth()
                    tvStatus.setText(R.string.login_status_expired)
                    tvServer.text = ""
                }
            }
        }
    }

    private fun scanQr() {
        val opts = ScanOptions()
        opts.setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        opts.setPrompt("")
        opts.setBeepEnabled(false)
        opts.setOrientationLocked(true)
        opts.setCaptureActivity(PortraitCaptureActivity::class.java)
        qrLauncher.launch(opts)
    }

    private fun onQr(raw: String) {
        val parsed = AuthApi.parseLoginQr(raw)
        if (parsed == null) {
            tvStatus.setText(R.string.login_qr_invalid)
            return
        }
        val (origin, hkey) = parsed
        // 保存设备名（网页确认时显示）
        val name = etName.text.toString().trim()
        prefs.deviceName = name
        pollOrigin = origin
        pollHkey = hkey
        tvStatus.text = getString(R.string.login_status_reporting)
        net.execute {
            try {
                AuthApi.reportDevice(origin, hkey, prefs.deviceKey, name)
                main.post { startPolling() }
            } catch (e: Exception) {
                main.post { tvStatus.text = e.message ?: "error" }
            }
        }
    }

    private fun startPolling() {
        if (polling) return
        polling = true
        tvStatus.text = getString(R.string.login_status_waiting)
        tvServer.text = pollOrigin
        pollTick()
    }

    /** 每 2 秒轮询登录结果，直到网页确认/拒绝或二维码过期。 */
    private fun pollTick() {
        if (!polling || isFinishing) return
        net.execute {
            var delay = 2000L
            try {
                val r = AuthApi.poll(pollOrigin, pollHkey)
                when (r.optString("status")) {
                    "confirmed" -> {
                        polling = false
                        val token = r.optString("token")
                        main.post {
                            if (token.isNotBlank()) {
                                prefs.authToken = token
                                prefs.authOrigin = pollOrigin
                                prefs.authUserJson = r.optJSONObject("user")?.toString() ?: "{}"
                                Toast.makeText(this@LoginActivity,
                                    getString(R.string.login_ok, displayName()), Toast.LENGTH_SHORT).show()
                                goHome()
                            } else {
                                tvStatus.setText(R.string.login_status_expired)
                            }
                        }
                        return@execute
                    }
                    "denied" -> {
                        polling = false
                        main.post { tvStatus.setText(R.string.login_denied) }
                        return@execute
                    }
                    "expired" -> {
                        polling = false
                        main.post { tvStatus.setText(R.string.login_status_expired) }
                        return@execute
                    }
                }
            } catch (_: Exception) {
                delay = 3000 // 网络抖动：稍后重试
            }
            if (polling) main.postDelayed({ pollTick() }, delay)
        }
    }

    private fun displayName(): String =
        JSONObject(prefs.authUserJson).optString("display_name", "")

    private fun goHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        polling = false
        main.removeCallbacksAndMessages(null)
        net.shutdownNow()
    }
}
