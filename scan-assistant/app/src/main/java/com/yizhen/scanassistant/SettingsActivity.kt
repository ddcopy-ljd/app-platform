package com.yizhen.scanassistant

import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * 设置/关于页：
 * - 服务器地址（可改）、本机设备码（只读）/设备名称、绑定门店、软件/固件版本；
 * - UHF 功率滑杆（5..30dBm，保存时透传 RfidManager.setPower）；
 * - 扳机模式 Spinner（取值见 TriggerChannels，arrays/trigger_modes）；
 * - 「重新激活/解绑本机」：二次确认后 clearAuth + 清任务/队列，回激活页。
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private lateinit var etUrl: EditText
    private lateinit var etName: EditText
    private lateinit var tvCode: TextView
    private lateinit var tvStore: TextView
    private lateinit var tvAppVer: TextView
    private lateinit var tvFwVer: TextView
    private lateinit var skPower: SeekBar
    private lateinit var tvPower: TextView
    private lateinit var spTrigger: Spinner

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        prefs = Prefs(this)

        etUrl = findViewById(R.id.stUrl)
        etName = findViewById(R.id.stDeviceName)
        tvCode = findViewById(R.id.stDeviceCode)
        tvStore = findViewById(R.id.stStore)
        tvAppVer = findViewById(R.id.stAppVer)
        tvFwVer = findViewById(R.id.stFwVer)
        skPower = findViewById(R.id.stPower)
        tvPower = findViewById(R.id.tvPower)
        spTrigger = findViewById(R.id.stTriggerMode)

        loadValues()

        skPower.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                tvPower.text = getString(R.string.st_power, progress + POWER_MIN)
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })

        findViewById<TextView>(R.id.btnBack).setOnClickListener { finish() }
        findViewById<TextView>(R.id.btnStSave).setOnClickListener { save() }
        findViewById<TextView>(R.id.btnUnbind).setOnClickListener { confirmUnbind() }
    }

    private fun loadValues() {
        etUrl.setText(prefs.serverUrl)
        etName.setText(prefs.deviceName)
        tvCode.text = prefs.deviceCode
        tvStore.text = prefs.storeName.ifBlank { getString(R.string.st_store_none) }
        tvAppVer.text = AppConfig.APP_VERSION
        tvFwVer.text = "—"
        skPower.progress = (prefs.power - POWER_MIN).coerceIn(0, POWER_MAX - POWER_MIN)
        tvPower.text = getString(R.string.st_power, prefs.power)
        spTrigger.setSelection(prefs.triggerMode.coerceIn(0, 6))
        // getVersion() 是阻塞串口调用，放工作线程读取，避免 ANR
        Thread {
            val v = RfidManager.version()
            runOnUiThread { tvFwVer.text = v.ifBlank { "—" } }
        }.start()
    }

    private fun save() {
        prefs.serverUrl = etUrl.text.toString()
        prefs.deviceName = etName.text.toString().trim()
        prefs.power = skPower.progress + POWER_MIN
        prefs.triggerMode = spTrigger.selectedItemPosition
        if (RfidManager.ready) RfidManager.setPower(prefs.power)
        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun confirmUnbind() {
        AlertDialog.Builder(this)
            .setTitle(R.string.btn_unbind)
            .setMessage(R.string.unbind_confirm)
            .setPositiveButton(R.string.dialog_ok) { _, _ -> doUnbind() }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun doUnbind() {
        // 清凭证/门店/任务；旧任务的待传队列对新激活无意义，一并清空；设备码与硬件设置保留
        prefs.clearAuth()
        prefs.currentTask = null
        prefs.queue = emptyList()
        val intent = Intent(this, ActivateActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        startActivity(intent)
        finish()
    }

    private companion object {
        const val POWER_MIN = 5
        const val POWER_MAX = 30
    }
}
