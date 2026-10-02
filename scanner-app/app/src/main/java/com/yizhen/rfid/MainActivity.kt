package com.yizhen.rfid

import android.content.Context
import android.content.res.Configuration
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.KeyEvent
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private lateinit var api: ApiClient
    private lateinit var engine: StockEngine
    private val main = Handler(Looper.getMainLooper())
    private val net = Executors.newSingleThreadExecutor()
    private lateinit var adapter: ScanAdapter

    // 视图
    private lateinit var tvNet: TextView
    private lateinit var dotNet: View
    private lateinit var tvTask: TextView
    private lateinit var tvSnapshot: TextView
    private lateinit var tvDeviceNo: TextView
    private lateinit var tvHv: TextView
    private lateinit var statSelf: TextView
    private lateinit var statAbnormal: TextView
    private lateinit var statGlobal: TextView
    private lateinit var statBook: TextView
    private lateinit var btnStart: TextView
    private lateinit var btnPause: TextView
    private lateinit var btnResume: TextView
    private lateinit var btnFinish: TextView
    private lateinit var tabStore: TextView
    private lateinit var tabAbnormal: TextView
    private lateinit var tvEmpty: TextView

    // 状态
    private var joined = false
    private var active = false       // 任务处于进行中
    private var snapshotReady = false
    private var scanning = false
    private var submitted = false
    private var abnormalTab = false
    private var rulesOpen = false

    private val pending = LinkedHashMap<String, Int>() // 待上报 EPC->RSSI
    private var lastNetworkOk = false

    private var tone: ToneGenerator? = null
    private var vibrator: Vibrator? = null
    private val hhmmss = SimpleDateFormat("HH:mm:ss", Locale.US)

    override fun attachBaseContext(base: Context) {
        val lang = base.getSharedPreferences("rfid", Context.MODE_PRIVATE).getString("lang", "zh") ?: "zh"
        val locale = if (lang == "en") Locale.ENGLISH else Locale.SIMPLIFIED_CHINESE
        Locale.setDefault(locale)
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(locale)
        super.attachBaseContext(base.createConfigurationContext(cfg))
    }

    private val qrLauncher = registerForActivityResult(ScanContract()) { res ->
        val code = res.contents
        if (!code.isNullOrBlank()) {
            prefs.serverUrl = code
            doJoin(autoSnapshot = true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        engine = StockEngine(prefs)
        api = ApiClient(prefs)
        setContentView(R.layout.activity_main)

        tone = ToneGenerator(AudioManager.STREAM_MUSIC, 60)
        vibrator = getSystemService(VIBRATOR_SERVICE) as? Vibrator

        bindViews()
        setupRecycler()
        setupListeners()
        initRfid()
        restoreSnapshot()
        refreshUi()
        startLoops()
    }

    private fun bindViews() {
        tvNet = findViewById(R.id.tvNet)
        dotNet = findViewById(R.id.dotNet)
        tvTask = findViewById(R.id.tvTask)
        tvSnapshot = findViewById(R.id.tvSnapshot)
        tvDeviceNo = findViewById(R.id.tvDeviceNo)
        tvHv = findViewById(R.id.tvHvAlert)
        statSelf = findViewById(R.id.statSelf)
        statAbnormal = findViewById(R.id.statAbnormal)
        statGlobal = findViewById(R.id.statGlobal)
        statBook = findViewById(R.id.statBook)
        btnStart = findViewById(R.id.btnStart)
        btnPause = findViewById(R.id.btnPause)
        btnResume = findViewById(R.id.btnResume)
        btnFinish = findViewById(R.id.btnFinish)
        tabStore = findViewById(R.id.tabStore)
        tabAbnormal = findViewById(R.id.tabAbnormal)
        tvEmpty = findViewById(R.id.tvEmpty)
    }

    private fun setupRecycler() {
        adapter = ScanAdapter(this)
        findViewById<RecyclerView>(R.id.rvScan).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = this@MainActivity.adapter
        }
    }

    private fun setupListeners() {
        findViewById<TextView>(R.id.btnLang).setOnClickListener {
            prefs.lang = if (prefs.lang == "en") "zh" else "en"
            recreate()
        }
        findViewById<TextView>(R.id.btnSettings).setOnClickListener {
            startActivity(android.content.Intent(this, SettingsActivity::class.java))
        }
        findViewById<View>(R.id.rulesHead).setOnClickListener {
            rulesOpen = !rulesOpen
            findViewById<View>(R.id.tvRulesBody).visibility =
                if (rulesOpen) View.VISIBLE else View.GONE
            findViewById<TextView>(R.id.tvRulesToggle).setText(
                if (rulesOpen) R.string.rules_fold else R.string.rules_expand)
        }
        findViewById<TextView>(R.id.btnJoin).setOnClickListener { scanQrOrJoin() }
        findViewById<TextView>(R.id.btnDownload).setOnClickListener { downloadSnapshot() }
        btnStart.setOnClickListener { startScan() }
        btnPause.setOnClickListener { pauseScan() }
        btnResume.setOnClickListener { startScan() }
        btnFinish.setOnClickListener { confirmFinish() }
        tabStore.setOnClickListener { abnormalTab = false; refreshList() }
        tabAbnormal.setOnClickListener { abnormalTab = true; refreshList() }
    }

    private fun initRfid() {
        net.execute {
            RfidManager.init(applicationContext)
            main.post {
                if (RfidManager.ready) {
                    RfidManager.setPower(prefs.power)
                } else {
                    Toast.makeText(this, R.string.demo_mode, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun restoreSnapshot() {
        if (prefs.snapshotJson.isNotBlank()) {
            val n = engine.loadSnapshot(prefs.snapshotJson)
            if (n > 0) {
                snapshotReady = true
                engine.initHighValueUnscanned()
            }
        }
        if (prefs.deviceNo > 0) tvDeviceNo.text = getString(R.string.device_me, prefs.deviceNo)
    }

    // -------------------------------- 任务连接

    private fun scanQrOrJoin() {
        if (api.isConfigured) {
            doJoin(autoSnapshot = false)
        } else {
            val opts = ScanOptions()
            opts.setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            opts.setPrompt("")
            opts.setBeepEnabled(false)
            opts.setOrientationLocked(false)
            qrLauncher.launch(opts)
        }
    }

    private fun doJoin(autoSnapshot: Boolean) {
        if (!api.isConfigured) {
            toast(R.string.need_join); return
        }
        net.execute {
            try {
                val j = api.join()
                val no = j.optInt("device_no")
                val isActive = j.optBoolean("active", false)
                val taskNo = j.optString("task_no")
                val isNewTask = taskNo.isNotEmpty() && taskNo != prefs.taskNo
                if (isNewTask) {
                    prefs.pullSinceId = 0
                    prefs.snapshotJson = ""
                    submitted = false
                    engine.reset()
                    snapshotReady = false
                }
                prefs.deviceNo = no
                prefs.taskNo = taskNo
                main.post {
                    joined = true
                    active = isActive
                    lastNetworkOk = true
                    tvDeviceNo.text = getString(R.string.device_me, no)
                    toast(getString(R.string.joined_ok, no))
                    if (isNewTask || autoSnapshot) downloadSnapshot()
                    refreshUi()
                }
            } catch (e: Exception) {
                main.post {
                    lastNetworkOk = false
                    joined = false
                    toast(e.message ?: "join error")
                    refreshUi()
                }
            }
        }
    }

    private fun downloadSnapshot() {
        if (!api.isConfigured) { toast(R.string.need_join); return }
        net.execute {
            try {
                val s = api.snapshot()
                val items = s.optJSONArray("items") ?: JSONArray()
                prefs.snapshotJson = items.toString()
                val n = engine.loadSnapshot(items.toString())
                engine.initHighValueUnscanned()
                main.post {
                    snapshotReady = n > 0
                    lastNetworkOk = true
                    if (!joined) joined = true
                    active = s.optString("status") == "进行中"
                    toast(getString(R.string.snapshot_downloaded, n))
                    refreshUi()
                }
            } catch (e: Exception) {
                main.post { lastNetworkOk = false; toast(e.message ?: "snapshot error"); refreshUi() }
            }
        }
    }

    // -------------------------------- 扫描

    private fun canScan() = joined && active && snapshotReady && !submitted

    private fun startScan() {
        if (!canScan()) { toast(R.string.need_join); return }
        if (scanning) return
        val burst = prefs.readMode == 1
        val ok = if (RfidManager.ready)
            RfidManager.start(burst) { epc, rssi -> onTag(epc, rssi) }
        else true // 演示模式
        if (!ok && RfidManager.ready) {
            toast(R.string.rfid_fail); return
        }
        scanning = true
        if (!RfidManager.ready) {
            // 无硬件：不产生数据，仅演示状态
        }
        refreshUi()
    }

    private fun pauseScan() {
        scanning = false
        RfidManager.stop()
        refreshUi()
    }

    private fun onTag(epcRaw: String, rssi: Int) {
        if (!scanning) return
        val epc = epcRaw.uppercase()
        if (prefs.rssiEnabled && rssi != 0 && rssi < prefs.rssiThreshold) return

        val r = engine.onSelfScan(epc, rssi, hhmmss.format(java.util.Date()))
        when (r) {
            1 -> { beep(); pending[epc] = rssi }
            2 -> { beep(); abnormalFeedback(); pending[epc] = rssi }
            0 -> {
                if (!prefs.dedup) beep()
                pending[epc] = rssi // 重复也上传，服务端去重；流量可接受
            }
        }
        if (prefs.readMode == 1) { scanning = false }
        refreshUi()
    }

    private fun confirmFinish() {
        AlertDialog.Builder(this)
            .setMessage(R.string.confirm_finish)
            .setPositiveButton(android.R.string.ok) { _, _ -> finishDevice() }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun finishDevice() {
        pauseScan()
        submitted = true
        flushUploads(blocking = true)
        net.execute {
            try {
                api.finish()
                main.post { toast(R.string.upload_finished); refreshUi() }
            } catch (e: Exception) {
                main.post { toast(e.message ?: "finish error"); refreshUi() }
            }
        }
        refreshUi()
    }

    // -------------------------------- 上报 / 拉取 循环

    private fun startLoops() {
        main.post(object : Runnable {
            override fun run() {
                if (scanning || pending.isNotEmpty()) flushUploads(blocking = false)
                main.postDelayed(this, 1200)
            }
        })
        main.post(object : Runnable {
            override fun run() {
                if (joined) pullOthers()
                main.postDelayed(this, (prefs.pullInterval.coerceAtLeast(5)) * 1000L)
            }
        })
        main.post(object : Runnable {
            override fun run() {
                if (joined) pollTask()
                main.postDelayed(this, 20000)
            }
        })
    }

    private fun flushUploads(blocking: Boolean) {
        if (pending.isEmpty()) return
        val batch = ArrayList(pending.entries)
        val action = Runnable {
            try {
                val tags = batch.map { it.key to it.value }
                val resp = api.scan(tags)
                val global = resp.optInt("global_count", engine.globalScanned)
                main.post {
                    batch.forEach { pending.remove(it.key) }
                    engine.globalScanned = global
                    lastNetworkOk = true
                    engine.online = true
                    prefs.offlineQueue = "[]"
                    refreshUi()
                }
            } catch (e: Exception) {
                main.post {
                    lastNetworkOk = false
                    engine.online = false
                    persistOffline()
                    refreshUi()
                }
            }
        }
        if (blocking) {
            val f = net.submit(action)
            try { f.get(6, java.util.concurrent.TimeUnit.SECONDS) } catch (_: Exception) {}
        } else net.execute(action)
    }

    private fun persistOffline() {
        val arr = JSONArray()
        pending.keys.forEach { arr.put(it) }
        prefs.offlineQueue = arr.toString()
    }

    private fun pullOthers() {
        if (!api.isConfigured) return
        net.execute {
            try {
                val resp = api.pull(prefs.pullSinceId)
                val items = resp.optJSONArray("items") ?: JSONArray()
                var maxId = resp.optInt("max_id", prefs.pullSinceId)
                var changed = false
                for (i in 0 until items.length()) {
                    val o = items.getJSONObject(i)
                    engine.mergeOther(o.optString("epc"), o.optInt("device_no"))
                    changed = true
                }
                if (maxId > prefs.pullSinceId) prefs.pullSinceId = maxId
                val isActive = resp.optString("status") == "进行中"
                main.post {
                    lastNetworkOk = true
                    engine.online = true
                    active = isActive
                    if (!isActive && scanning) pauseScan()
                    if (changed) refreshList()
                    refreshUi()
                }
            } catch (e: Exception) {
                main.post { lastNetworkOk = false; engine.online = false; refreshUi() }
            }
        }
    }

    private fun pollTask() {
        if (!api.isConfigured) return
        net.execute {
            try {
                val t = api.task()
                val isActive = t.optBoolean("active", false)
                val status = t.optString("status")
                main.post {
                    lastNetworkOk = true
                    if (joined && !isActive && active) {
                        pauseScan()
                        toast(if (status == "待核对") R.string.task_waiting else R.string.task_ended)
                    }
                    active = isActive
                    refreshUi()
                }
            } catch (_: Exception) {}
        }
    }

    // -------------------------------- 反馈

    private fun beep() {
        try { tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 60) } catch (_: Exception) {}
    }

    private fun abnormalFeedback() {
        if (!prefs.vibrateAbnormal) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(300, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION") vibrator?.vibrate(300)
            }
        } catch (_: Exception) {}
    }

    private fun toast(resId: Int) = Toast.makeText(this, resId, Toast.LENGTH_SHORT).show()
    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    // -------------------------------- 触发键

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        val trigger = code in intArrayOf(
            KeyEvent.KEYCODE_F1, KeyEvent.KEYCODE_F2, 102, 103, 115, 139, 280, 281,
            KeyEvent.KEYCODE_BUTTON_L1, KeyEvent.KEYCODE_BUTTON_R1
        )
        if (trigger) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> if (!event.repeat && canScan() && !scanning) startScan()
                KeyEvent.ACTION_UP -> if (scanning && prefs.readMode == 0) pauseScan()
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // -------------------------------- UI

    private fun refreshList() {
        val list = engine.listForTab(abnormalTab)
        adapter.submit(list)
        tvEmpty.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        tvEmpty.setText(if (abnormalTab) R.string.empty_abnormal else R.string.empty_store)
    }

    private fun refreshUi() {
        // 网络
        tvNet.setText(if (lastNetworkOk) R.string.net_online else R.string.net_offline)
        dotNet.setBackgroundResource(
            if (lastNetworkOk) R.drawable.dot_green else R.drawable.dot_gray)

        // 任务
        tvTask.setText(
            when {
                !joined -> R.string.task_none
                active -> R.string.task_active
                submitted -> R.string.upload_finished
                else -> R.string.task_waiting
            })
        tvSnapshot.text =
            if (snapshotReady) getString(R.string.snapshot_ok, engine.snapshotCount)
            else getString(R.string.snapshot_none)

        // 统计
        statSelf.text = engine.countSelf().toString()
        statAbnormal.text = engine.countAbnormal().toString()
        statGlobal.text = engine.globalScanned.toString()
        statBook.text = engine.snapshotCount.toString()

        // 高价值提醒
        val hv = engine.countHighValueUnscanned()
        if (hv > 0 && prefs.highValueRemind) {
            tvHv.visibility = View.VISIBLE
            tvHv.text = getString(R.string.hv_alert, hv)
        } else tvHv.visibility = View.GONE

        // 按钮
        btnStart.visibility = if (scanning) View.GONE else View.VISIBLE
        btnPause.visibility = if (scanning) View.VISIBLE else View.GONE
        btnResume.visibility = View.GONE
        btnFinish.visibility = if (joined) View.VISIBLE else View.INVISIBLE
        btnStart.alpha = if (canScan()) 1f else 0.5f

        // Tab 颜色
        tabStore.setTextColor(getColor(if (!abnormalTab) R.color.green else R.color.text_secondary))
        tabAbnormal.setTextColor(getColor(if (abnormalTab) R.color.red else R.color.text_secondary))
        tabAbnormal.paint.isFakeBoldText = abnormalTab
        tabStore.paint.isFakeBoldText = !abnormalTab

        refreshList()
    }

    override fun onDestroy() {
        super.onDestroy()
        RfidManager.stop()
        try { tone?.release() } catch (_: Exception) {}
        net.shutdownNow()
        main.removeCallbacksAndMessages(null)
    }
}
