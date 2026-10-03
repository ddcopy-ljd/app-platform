package com.yizhen.rfid

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import androidx.core.content.ContextCompat
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.widget.TextView
import android.widget.Toast
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
    private lateinit var tvTriggerHint: TextView
    private lateinit var btnTrigger: TextView
    private lateinit var tabStore: TextView
    private lateinit var tabAbnormal: TextView
    private lateinit var tvEmpty: TextView

    // 状态
    private var joined = false
    private var active = false       // 任务处于进行中
    private var snapshotReady = false
    private var scanning = false
    private var abnormalTab = false
    private var rulesOpen = false

    private var pending = LinkedHashMap<String, Int>() // 待上报 EPC->RSSI
    private var lastNetworkOk = false
    private var triggerDown = false   // 扳机当前是否按住（防止 KeyEvent 与广播双通道重复触发）

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
        val code = res.contents?.trim().orEmpty()
        if (code.isNotEmpty()) {
            when (ApiClient.qrKind(code)) {
                ApiClient.QR_CO -> {
                    prefs.serverUrl = ApiClient.normalize(code)
                    doJoin(autoSnapshot = true)
                }
                ApiClient.QR_LEGACY -> toast(R.string.qr_legacy_hint)
                else -> toast(R.string.qr_unknown_hint)
            }
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
        tvTriggerHint = findViewById(R.id.tvTriggerHint)
        btnTrigger = findViewById(R.id.btnTrigger)
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
        findViewById<TextView>(R.id.btnJoin).setOnClickListener { scanJoinQr() }
        findViewById<TextView>(R.id.btnDownload).setOnClickListener { downloadSnapshot() }
        // 屏幕模拟扳机：按下=扣下扳机，松开/滑出=弹起
        btnTrigger.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { onTriggerDown(); true }
                MotionEvent.ACTION_UP -> { onTriggerUp(); true }
                MotionEvent.ACTION_CANCEL -> { onTriggerUp(); true }
                else -> true
            }
        }
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
        else tvDeviceNo.setText(R.string.device_none)
    }

    // -------------------------------- 任务连接

    /** 【扫码加入盘点任务】：不做任何状态判断，按下即打开扫码摄像头。
     *  扫到服务器上的任务二维码后：配置接口地址 → 加入任务 → 自动下载库存快照。 */
    private fun scanJoinQr() {
        val opts = ScanOptions()
        opts.setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        opts.setPrompt("")
        opts.setBeepEnabled(false)
        opts.setOrientationLocked(false)
        qrLauncher.launch(opts)
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
                val status = j.optString("status")
                val taskNo = j.optString("task_no")
                // 加入的是已结束的旧任务：旧 key 作废，必须扫码加入新任务
                if (isDone(status)) {
                    main.post {
                        prefs.serverUrl = ""
                        leaveTask(true)
                    }
                    return@execute
                }
                val isNewTask = taskNo.isNotEmpty() && taskNo != prefs.taskNo
                if (isNewTask) {
                    prefs.pullSinceId = 0
                    prefs.snapshotJson = ""
                    prefs.offlineQueue = "[]"
                    engine.reset()
                    snapshotReady = false
                }
                prefs.deviceNo = no
                prefs.taskNo = taskNo
                main.post {
                    if (isNewTask) pending.clear()
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
                    val msg = e.message ?: "join error"
                    // 密钥无效/任务不存在：旧任务已失效，完整复位并清空地址，下次点按钮直接重新扫码
                    if (e.invalidTaskKey()) {
                        prefs.serverUrl = ""
                        leaveTask(false)
                        toast(R.string.qr_invalid_key)
                    } else {
                        toast(msg)
                        refreshUi()
                    }
                }
            }
        }
    }

    private fun downloadSnapshot() {
        if (!api.isConfigured) { toast(R.string.need_join); return }
        net.execute {
            try {
                val s = api.snapshot()
                val status = s.optString("status")
                if (isDone(status)) {
                    main.post { prefs.serverUrl = ""; leaveTask(true) }
                    return@execute
                }
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
                main.post {
                    if (e.invalidTaskKey()) { prefs.serverUrl = ""; leaveTask(false) }
                    else { lastNetworkOk = false; toast(e.message ?: "snapshot error"); refreshUi() }
                }
            }
        }
    }

    // -------------------------------- 扫描

    private fun canScan() = joined && active && snapshotReady

    /** 旧任务已完成（主管核对确认/强制终止）或旧 key 已失效：彻底退出任务态。
     *  清空保存的任务地址，下一次盘点必须重新扫码加入新任务，避免拿着旧任务直接开扫。 */
    private fun leaveTask(showHint: Boolean) {
        val wasInTask = joined || snapshotReady || prefs.snapshotJson.isNotBlank()
        if (scanning) {
            scanning = false
            RfidManager.stop()
        }
        joined = false
        active = false
        snapshotReady = false
        pending.clear()
        engine.reset()
        prefs.serverUrl = ""
        prefs.taskNo = ""
        prefs.snapshotJson = ""
        prefs.pullSinceId = 0
        prefs.offlineQueue = "[]"
        prefs.deviceNo = 0
        tvDeviceNo.setText(R.string.device_none)
        lastNetworkOk = true
        refreshUi()
        if (showHint && wasInTask) toast(R.string.task_rescan)
    }

    private fun isDone(status: String?) = status == "已完成"
    private fun Exception.invalidTaskKey() =
        (message ?: "").let { it.contains("403") || it.contains("404") }
    private fun Exception.taskClosed() = (message ?: "").contains("409")

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

    private fun onTag(epcRaw: String, rssi: Int, fromCamera: Boolean = false) {
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
        // 单次读取模式只对 UHF 扳机生效；摄像头连续扫描由扫码页自行控制
        if (prefs.readMode == 1 && !fromCamera) { scanning = false }
        refreshUi()
    }

    // -------------------------------- 摄像头兜底扫描（无 UHF 模块的手机）

    private val cameraLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) {
        scanning = false
        BarcodeScanActivity.onBarcode = null
        refreshUi()
    }

    /** 检测不到 UHF 设备时：点提示条打开摄像头，连续识别条码当作 EPC，
     *  走与 RFID 完全相同的比对/去重/上传流程。 */
    private fun openCameraScan() {
        if (!canScan()) { toast(R.string.need_join); return }
        scanning = true
        BarcodeScanActivity.onBarcode = { code ->
            if (!scanning) {
                false // 任务已被主管结束/进入待核对：扫码页自动关闭
            } else {
                onTag(code, 0, fromCamera = true)
                true
            }
        }
        cameraLauncher.launch(android.content.Intent(this, BarcodeScanActivity::class.java))
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
                    if (e.invalidTaskKey()) {
                        prefs.serverUrl = ""
                        leaveTask(false)
                    } else if (e.taskClosed()) {
                        // 主管已结束任务：服务端拒绝上传（409），立即停止扫描并丢弃待传批次
                        active = false
                        pending.clear()
                        prefs.offlineQueue = "[]"
                        if (scanning) pauseScan() else refreshUi()
                        toast(R.string.task_stopped_remote)
                    } else {
                        lastNetworkOk = false
                        engine.online = false
                        persistOffline()
                        refreshUi()
                    }
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
                val status = resp.optString("status")
                if (isDone(status)) {
                    main.post { prefs.serverUrl = ""; leaveTask(true) }
                    return@execute
                }
                val items = resp.optJSONArray("items") ?: JSONArray()
                var maxId = resp.optInt("max_id", prefs.pullSinceId)
                var changed = false
                for (i in 0 until items.length()) {
                    val o = items.getJSONObject(i)
                    engine.mergeOther(o.optString("epc"), o.optInt("device_no"))
                    changed = true
                }
                if (maxId > prefs.pullSinceId) prefs.pullSinceId = maxId
                val isActive = status == "进行中"
                main.post {
                    lastNetworkOk = true
                    engine.online = true
                    active = isActive
                    if (!isActive && scanning) pauseScan()
                    if (changed) refreshList()
                    refreshUi()
                }
            } catch (e: Exception) {
                main.post {
                    if (e.invalidTaskKey()) { prefs.serverUrl = ""; leaveTask(false) }
                    else { lastNetworkOk = false; engine.online = false; refreshUi() }
                }
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
                    // 任务已完成（主管核对确认或强制终止）：退出旧任务，必须扫码加入下一次任务
                    if (isDone(status)) {
                        prefs.serverUrl = ""
                        leaveTask(true)
                        return@post
                    }
                    if (joined && !isActive && active) {
                        pauseScan()
                        toast(if (status == "待核对") R.string.task_waiting else R.string.task_ended)
                    }
                    active = isActive
                    refreshUi()
                }
            } catch (e: Exception) {
                main.post {
                    if (e.invalidTaskKey()) { prefs.serverUrl = ""; leaveTask(false) }
                }
            }
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

    /**
     * C27（RSCJA/Chainway 方案）机身扳机不产生 KeyEvent——系统扫描服务会吞掉按键，
     * 改为通过系统广播下发：action=android.rfid.FUN_KEY（部分固件为 android.intent.action.FUN_KEY），
     * extras: keyCode(int，缺省 139)、keydown(boolean，部分固件为字符串 "true"/"false")。
     * 以广播为主通道、KeyEvent 为兜底，两者都汇入 onTriggerDown/Up。
     */
    private val triggerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            if (action != "android.rfid.FUN_KEY" && action != "android.intent.action.FUN_KEY") return
            val down = when (val v = intent.extras?.get("keydown")) {
                is Boolean -> v
                is String -> v.equals("true", ignoreCase = true) || v == "1"
                else -> intent.getBooleanExtra("keydown", false)
            }
            if (down) onTriggerDown() else onTriggerUp()
        }
    }

    override fun onResume() {
        super.onResume()
        // 扫码摄像头页面期间收不到松开事件，回来时复位扳机状态，避免下次按下被吞
        triggerDown = false
        val filter = IntentFilter().apply {
            addAction("android.rfid.FUN_KEY")
            addAction("android.intent.action.FUN_KEY")
        }
        try {
            // FUN_KEY 由系统扫描服务发出，属于跨应用广播，Android 13+ 必须声明 EXPORTED
            ContextCompat.registerReceiver(this, triggerReceiver, filter,
                ContextCompat.RECEIVER_EXPORTED)
        } catch (_: Exception) {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(triggerReceiver, filter)
        }
    }

    override fun onPause() {
        super.onPause()
        try { unregisterReceiver(triggerReceiver) } catch (_: Exception) {}
    }

    /** 扳机按下：任务内启动 UHF 盘存（无 UHF 的手机开摄像头扫条码）；
     *  任务外不做状态判断，直接打开摄像头扫任务二维码加入盘点。 */
    private fun onTriggerDown() {
        if (triggerDown) return
        triggerDown = true
        if (canScan()) {
            if (RfidManager.ready) startScan() else openCameraScan()
        } else {
            scanJoinQr()
        }
    }

    /** 扳机松开：连续模式下停止盘存；单次模式由读到标签后自行停止。 */
    private fun onTriggerUp() {
        triggerDown = false
        if (scanning && RfidManager.ready && prefs.readMode == 0) pauseScan()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        val trigger = code in intArrayOf(
            KeyEvent.KEYCODE_F1, KeyEvent.KEYCODE_F2, 102, 103, 115, 139, 140, 280, 281,
            KeyEvent.KEYCODE_BUTTON_L1, KeyEvent.KEYCODE_BUTTON_R1
        )
        if (trigger) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) onTriggerDown()
                KeyEvent.ACTION_UP -> onTriggerUp()
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

        // 扫描提示条：任务内 C27 按扳机、手机点按开摄像头扫条码；
        // 任务外（未加入/已结束）点按直接打开摄像头扫任务二维码加入，不做任何状态拦截
        if (canScan()) {
            tvTriggerHint.alpha = 1f
            tvTriggerHint.setText(if (scanning) R.string.trigger_scanning
                else if (RfidManager.ready) R.string.trigger_hint
                else R.string.trigger_camera)
            tvTriggerHint.setOnClickListener(
                if (RfidManager.ready) null else View.OnClickListener { openCameraScan() })
        } else {
            tvTriggerHint.alpha = 1f
            tvTriggerHint.setText(R.string.trigger_idle)
            tvTriggerHint.setOnClickListener { scanJoinQr() }
        }

        // 模拟扳机按钮：扫描中红色，待扫绿色，未加入任务蓝色（按住直接扫码加入）
        if (canScan()) {
            if (scanning) {
                btnTrigger.setBackgroundResource(R.drawable.bg_btn_red)
                btnTrigger.setText(R.string.trigger_btn_active)
            } else {
                btnTrigger.setBackgroundResource(R.drawable.bg_btn_green)
                btnTrigger.setText(R.string.trigger_btn)
            }
        } else {
            btnTrigger.setBackgroundResource(R.drawable.bg_btn_blue)
            btnTrigger.setText(R.string.trigger_btn_join)
        }

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
