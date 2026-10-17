package com.yizhen.scanassistant

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 激活页（LAUNCHER）。
 *
 * - 已有 deviceToken 时直接进 [TaskActivity]：作业页启动即建立 WS 常驻连接，
 *   凭证失效会被服务端 4401 关闭，再由作业页清凭证回本页，无需 HTTP 探活；
 * - 服务器地址可手填并记住；设备码安装即生成（SH-XXXXXX）只读展示；
 * - 「扫描激活码」扫 PC 端 /api/device/activate?key= 二维码：origin 存为 serverUrl，key 作 akey；
 * - 「手动输入激活码激活」弹框录入 akey；
 * - 激活成功保存 token/门店/code/name 后进作业页。右上角「设置」进 [SettingsActivity]。
 */
class ActivateActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private val net = Executors.newSingleThreadExecutor()

    private lateinit var etServer: EditText
    private lateinit var etName: EditText
    private lateinit var btnScan: TextView
    private lateinit var btnManual: TextView
    private lateinit var boxState: View
    private lateinit var tvState: TextView

    /** 扫码得到/手填的激活码；扫码时同时锁定二维码里的 origin。 */
    private var pendingAkey: String? = null

    private val qrLauncher = registerForActivityResult(ScanContract()) { res ->
        val raw = res.contents?.trim().orEmpty()
        if (raw.isEmpty()) return@registerForActivityResult
        when (ApiClient.qrKind(raw)) {
            ApiClient.QrKind.ACTIVATE -> {
                val parsed = ApiClient.parseQr(raw)
                if (parsed == null) {
                    toast(getString(R.string.qr_invalid_activate)); return@registerForActivityResult
                }
                val (origin, key) = parsed
                // 服务器地址栏显示扫码得到的完整字符串（含路径与 key），便于人工核对；
                // 激活时由 ApiClient.serverOrigin() 剥出 origin，手填地址也同样兼容
                etServer.setText(raw)
                pendingAkey = key
                activate(key)
            }
            ApiClient.QrKind.CLAIM ->
                toast("本版本无需任务二维码，激活后在作业页直接领取任务")
            else -> toast(getString(R.string.qr_invalid_activate))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        setContentView(R.layout.activity_activate)

        etServer = findViewById(R.id.etServer)
        etName = findViewById(R.id.etName)
        btnScan = findViewById(R.id.btnScanActivate)
        btnManual = findViewById(R.id.btnManualActivate)
        boxState = findViewById(R.id.boxActivateState)
        tvState = findViewById(R.id.tvActivateState)

        findViewById<TextView>(R.id.tvDeviceCode).text = prefs.deviceCode
        etServer.setText(prefs.serverUrl)
        etName.setText(prefs.deviceName)
        // 部分 ROM（讯飞 IME）无视 stateHidden，进入页面仍把键盘顶起；
        // 主动清焦点并强制收起，用户点输入框时才重新弹出
        etServer.clearFocus()
        etName.clearFocus()
        hideIme()

        btnScan.setOnClickListener {
            // 激活二维码自带服务器 origin，地址栏为空也可直接扫；扫到后回填 origin
            val url = ApiClient.normalizeBase(etServer.text.toString())
            if (url.isNotBlank()) prefs.serverUrl = url
            scanActivateQr()
        }
        btnManual.setOnClickListener {
            val url = ApiClient.normalizeBase(etServer.text.toString())
            if (url.isBlank()) {
                toast(getString(R.string.need_url)); return@setOnClickListener
            }
            prefs.serverUrl = url
            showManualDialog()
        }
        findViewById<TextView>(R.id.btnSettings).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        if (prefs.deviceToken.isNotBlank() && prefs.serverUrl.isNotBlank()) goTask()
    }

    override fun onResume() {
        super.onResume()
        // 从设置页解绑回来时，按钮恢复可用（token 已被清除）
        if (prefs.deviceToken.isBlank()) setBusy(false, "")
        // 从扫码相机/设置页返回后再收一次，防止 IME 被重新拉起
        window.decorView.post { hideIme() }
    }

    private fun hideIme() {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(window.decorView.windowToken, 0)
        currentFocus?.clearFocus()
    }

    private fun scanActivateQr() {
        val opts = ScanOptions()
        opts.setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        opts.setPrompt("")
        opts.setBeepEnabled(false)
        opts.setOrientationLocked(true)
        opts.setCaptureActivity(PortraitCaptureActivity::class.java)
        qrLauncher.launch(opts)
    }

    private fun showManualDialog() {
        val input = EditText(this).apply {
            hint = getString(R.string.activate_code_hint)
            setText(pendingAkey.orEmpty())
            setSingleLine(true)
            setPadding(40, 28, 40, 28)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.activate_code_title)
            .setView(input)
            .setPositiveButton(R.string.dialog_ok) { _, _ ->
                val key = input.text.toString().trim()
                if (key.isEmpty()) {
                    toast(getString(R.string.activate_code_hint)); return@setPositiveButton
                }
                pendingAkey = key
                activate(key)
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    /** 阻塞激活调用（工作线程），成功落盘并进作业页，失败原样弹窗展示 detail。 */
    private fun activate(akey: String) {
        // 输入框可能是完整激活 URL（扫码整串）或手填的 ip:port，统一剥成 origin
        val base = ApiClient.serverOrigin(etServer.text.toString())
        if (base.isBlank()) {
            toast(getString(R.string.need_url)); return
        }
        val name = etName.text.toString().trim()
        prefs.serverUrl = base
        prefs.deviceName = name
        setBusy(true, getString(R.string.activating))
        net.execute {
            try {
                val resp: JSONObject = ApiClient.activate(
                    base, akey, prefs.deviceCode, name, AppConfig.APP_VERSION
                )
                prefs.deviceToken = resp.optString("device_token", "")
                resp.optJSONObject("store")?.let { s ->
                    prefs.storeId = s.optInt("id", 0)
                    prefs.storeName = s.optString("name", "")
                }
                val serverCode = resp.optString("code", "")
                if (serverCode.isNotEmpty()) prefs.deviceCode = serverCode
                val serverName = resp.optString("name", "")
                if (serverName.isNotEmpty()) prefs.deviceName = serverName
                runOnUiThread { goTask() }
            } catch (e: ApiClient.ApiException) {
                runOnUiThread {
                    setBusy(false, "")
                    AlertDialog.Builder(this)
                        .setTitle(R.string.activate_title)
                        .setMessage(e.detail)
                        .setPositiveButton(R.string.dialog_ok, null)
                        .show()
                }
            }
        }
    }

    private fun setBusy(busy: Boolean, stateText: String) {
        boxState.visibility = if (busy) View.VISIBLE else View.GONE
        tvState.text = stateText
        btnScan.isEnabled = !busy
        btnManual.isEnabled = !busy
        etServer.isEnabled = !busy
        etName.isEnabled = !busy
    }

    private fun goTask() {
        startActivity(Intent(this, TaskActivity::class.java))
        finish()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        super.onDestroy()
        net.shutdownNow()
    }
}
