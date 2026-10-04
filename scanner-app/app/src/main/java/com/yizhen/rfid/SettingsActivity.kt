package com.yizhen.rfid

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.widget.EditText
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat

class SettingsActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs

    private lateinit var etUrl: EditText
    private lateinit var skPull: SeekBar
    private lateinit var tvPull: TextView
    private lateinit var skSalePower: SeekBar
    private lateinit var tvSalePower: TextView
    private lateinit var skPower: SeekBar
    private lateinit var tvPower: TextView
    private lateinit var btnTestSale: TextView
    private lateinit var btnTestStock: TextView
    private lateinit var spRegion: Spinner
    private lateinit var spSession: Spinner
    private lateinit var spQ: Spinner
    private lateinit var spTrigger: Spinner
    private lateinit var swRssi: SwitchCompat
    private lateinit var skRssi: SeekBar
    private lateinit var tvRssi: TextView
    private lateinit var swDedup: SwitchCompat
    private lateinit var swHv: SwitchCompat
    private lateinit var swVibrate: SwitchCompat

    private var tone: ToneGenerator? = null
    private var lastBeepAt = 0L

    // 试扫状态：0=未试扫 1=出单功率试扫 2=盘点功率试扫
    private var testMode = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        prefs = Prefs(this)
        tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
        bind()
        loadValues()

        findViewById<TextView>(R.id.btnBack).setOnClickListener { stopTestScan(); finish() }
        findViewById<TextView>(R.id.btnStSave).setOnClickListener { save() }
        findViewById<TextView>(R.id.btnReset).setOnClickListener {
            AlertDialog.Builder(this)
                .setMessage(R.string.st_confirm_reset)
                .setPositiveButton(android.R.string.ok) { _, _ -> resetUi() }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
        findViewById<TextView>(R.id.btnTestSaleScan).setOnClickListener { toggleTestScan(1) }
        findViewById<TextView>(R.id.btnTestStockScan).setOnClickListener { toggleTestScan(2) }
    }

    private fun bind() {
        etUrl = findViewById(R.id.stUrl)
        skPull = findViewById(R.id.stPull)
        tvPull = findViewById(R.id.stPullVal)
        skSalePower = findViewById(R.id.stSalePower)
        tvSalePower = findViewById(R.id.stSalePowerVal)
        skPower = findViewById(R.id.stPower)
        tvPower = findViewById(R.id.stPowerVal)
        btnTestSale = findViewById(R.id.btnTestSaleScan)
        btnTestStock = findViewById(R.id.btnTestStockScan)
        spRegion = findViewById(R.id.stRegion)
        spSession = findViewById(R.id.stSession)
        spQ = findViewById(R.id.stQValue)
        spTrigger = findViewById(R.id.stTriggerMode)
        swRssi = findViewById(R.id.stRssiEnabled)
        skRssi = findViewById(R.id.stRssiThreshold)
        tvRssi = findViewById(R.id.stRssiVal)
        swDedup = findViewById(R.id.stDedup)
        swHv = findViewById(R.id.stHvRemind)
        swVibrate = findViewById(R.id.stVibrate)

        val sec = getString(R.string.unit_seconds)
        skPull.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, p: Int, f: Boolean) {
                tvPull.text = "${p + 5} $sec"
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })
        // 功率滑杆：边拖边调——正在试扫对应功率时，实时停扫→设功率→重新开扫，
        // 通过提示音有无即可判断当前功率能扫到多远
        skSalePower.setOnSeekBarChangeListener(PowerListener(1) { it + 5 })
        skPower.setOnSeekBarChangeListener(PowerListener(2) { it + 5 })
        skRssi.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, p: Int, f: Boolean) {
                tvRssi.text = "${p - 90} dBm"
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })
    }

    private inner class PowerListener(
        private val mode: Int,
        private val toDbm: (Int) -> Int,
    ) : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) {
            if (mode == 1) tvSalePower.text = "${toDbm(p)} dBm" else tvPower.text = "${toDbm(p)} dBm"
            if (fromUser && testMode == mode) {
                restartTestScan(toDbm(p))
            }
        }
        override fun onStartTrackingTouch(sb: SeekBar?) {}
        override fun onStopTrackingTouch(sb: SeekBar?) {}
    }

    private fun loadValues() {
        etUrl.setText(prefs.serverUrl)
        skPull.progress = (prefs.pullInterval - 5).coerceIn(0, 115)
        skSalePower.progress = (prefs.salePower - 5).coerceIn(0, 25)
        skPower.progress = (prefs.power - 5).coerceIn(0, 25)
        spRegion.setSelection(prefs.region.coerceIn(0, 5))
        spSession.setSelection(prefs.session.coerceIn(0, 3))
        spQ.setSelection(prefs.qValue.coerceIn(0, 7))
        spTrigger.setSelection(prefs.triggerMode.coerceIn(0, 6))
        swRssi.isChecked = prefs.rssiEnabled
        skRssi.progress = (prefs.rssiThreshold + 90).coerceIn(0, 60)
        swDedup.isChecked = prefs.dedup
        swHv.isChecked = prefs.highValueRemind
        swVibrate.isChecked = prefs.vibrateAbnormal
        tvPull.text = "${prefs.pullInterval} ${getString(R.string.unit_seconds)}"
        tvSalePower.text = "${prefs.salePower} dBm"
        tvPower.text = "${prefs.power} dBm"
        tvRssi.text = "${prefs.rssiThreshold} dBm"

        findViewById<TextView>(R.id.stDeviceId).text = prefs.deviceKey
        findViewById<TextView>(R.id.stSdkVer).text = "DeviceAPI 20220518"
        findViewById<TextView>(R.id.stFwVer).text = RfidManager.version().ifBlank { "—" }
    }

    // -------------------------------- 试扫（边扫边调功率）

    private fun toggleTestScan(mode: Int) {
        if (testMode == mode) {
            stopTestScan()
            return
        }
        if (!RfidManager.ready) {
            // 无 UHF 模块的机器也允许进入设置，试扫给出提示即可
            Toast.makeText(this, R.string.demo_mode, Toast.LENGTH_SHORT).show()
            return
        }
        stopTestScan()
        testMode = mode
        val dbm = if (mode == 1) skSalePower.progress + 5 else skPower.progress + 5
        RfidManager.setPower(dbm)
        val ok = RfidManager.start { _, _ -> testBeep() }
        if (!ok) {
            testMode = 0
            Toast.makeText(this, R.string.rfid_fail, Toast.LENGTH_SHORT).show()
            return
        }
        refreshTestBtns()
    }

    /** 滑杆变动时重启试扫，使新功率立即生效。 */
    private fun restartTestScan(dbm: Int) {
        if (testMode == 0) return
        RfidManager.stop()
        RfidManager.setPower(dbm)
        val ok = RfidManager.start { _, _ -> testBeep() }
        if (!ok) {
            testMode = 0
            refreshTestBtns()
        }
    }

    private fun stopTestScan() {
        if (testMode != 0) {
            RfidManager.stop()
            testMode = 0
            refreshTestBtns()
        }
    }

    private fun refreshTestBtns() {
        btnTestSale.setText(if (testMode == 1) R.string.st_test_scan_stop else R.string.st_test_scan_start)
        btnTestStock.setText(if (testMode == 2) R.string.st_test_scan_stop else R.string.st_test_scan_start)
        btnTestSale.setBackgroundResource(if (testMode == 1) R.drawable.bg_btn_red else R.drawable.bg_btn_blue)
        btnTestStock.setBackgroundResource(if (testMode == 2) R.drawable.bg_btn_red else R.drawable.bg_btn_green)
    }

    /** 试扫提示音：同一标签连续读到也只按 400ms 节流响一声，用于听距离。 */
    private fun testBeep() {
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lastBeepAt < 400) return
        lastBeepAt = now
        try { tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 120) } catch (_: Exception) {}
    }

    // -------------------------------- 保存 / 重置

    private fun save() {
        stopTestScan()
        prefs.serverUrl = etUrl.text.toString().trim()
        prefs.pullInterval = skPull.progress + 5
        prefs.salePower = skSalePower.progress + 5
        prefs.power = skPower.progress + 5
        prefs.region = spRegion.selectedItemPosition
        prefs.session = spSession.selectedItemPosition
        prefs.qValue = spQ.selectedItemPosition
        prefs.triggerMode = spTrigger.selectedItemPosition
        prefs.rssiEnabled = swRssi.isChecked
        prefs.rssiThreshold = skRssi.progress - 90
        prefs.dedup = swDedup.isChecked
        prefs.highValueRemind = swHv.isChecked
        prefs.vibrateAbnormal = swVibrate.isChecked
        // 保存后恢复为盘点功率（默认工作档），出单页进入时会再切出单功率
        RfidManager.setPower(prefs.power)
        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun resetUi() {
        prefs.resetAll()
        loadValues()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopTestScan()
        try { tone?.release() } catch (_: Exception) {}
    }
}
