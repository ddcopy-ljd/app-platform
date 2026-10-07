package com.yizhen.scanassistant

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.InputDevice
import android.view.KeyEvent
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 核心作业页（严格盲采 · WS 常驻架构）。
 *
 * - 启动即建立 [ScanWsClient] 常驻连接，无任务二维码、无轮询；
 * - 待领取态展示服务端推送的本店任务列表（task_list/task_offer），点按即 claim；
 * - 领取任务后允许完全脱机扫描：标签先入本地持久队列，WS 在线时按 source 分组批量补传，
 *   服务端任务级 UNIQUE 去重，重发安全；
 * - 断电重启：从 Prefs 恢复未完成任务与待传队列，WS 重连后自动恢复并补传；
 * - 本地仍有未同步数据（queue>0 或在途帧未确认）时禁止提交完结；
 * - 任务被发起端关闭（task_closed / scan ack task_closed）：立即停扫并回待领取态；
 * - 本地绝不保存/展示库存明细，分类统计只信服务端回执。
 */
class TaskActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())
    private val bg = Executors.newSingleThreadExecutor()

    private lateinit var cardIdle: View
    private lateinit var cardWork: View
    private lateinit var llTaskList: LinearLayout
    private lateinit var tvEmpty: TextView
    private lateinit var btnRefresh: TextView
    private lateinit var btnTrigger: TextView
    private lateinit var btnCamera: TextView
    private lateinit var btnSubmit: TextView
    private lateinit var tvSubmitHint: TextView
    private lateinit var tvTaskNo: TextView
    private lateinit var tvDeviceNo: TextView
    private lateinit var tvNet: TextView
    private lateinit var dotNet: ImageView
    private lateinit var tvMine: TextView
    private lateinit var tvQueue: TextView
    private lateinit var tvStatInStore: TextView
    private lateinit var tvStatOther: TextView
    private lateinit var tvStatUnknown: TextView
    private lateinit var tvStatTotal: TextView
    private lateinit var tvUhf: TextView

    // —— 作业状态（除 @Volatile 标注外，仅主线程访问）——
    private var ws: ScanWsClient? = null
    private var task: TaskInfo? = null
    private var offers = mutableListOf<TaskOffer>()
    private val queue = mutableListOf<QueueItem>()
    private val seen = HashSet<String>()
    private var scanning = false
    private var online = false
    private var offlineToastShown = false
    private var mine = 0
    private var statInStore = 0
    private var statOtherStore = 0
    private var statUnknown = 0
    private var statTotal = 0
    private var claimBusy = false
    @Volatile private var uploading = false
    /** 已发送待 ack 的批次（FIFO，每帧一组 source）；ack 按发送顺序返回。 */
    private val pendingBatches = ArrayDeque<HashSet<String>>()
    private var queueDirty = false
    private var closedDialogShown = false
    private var lastTriggerAt = 0L

    private var tone: ToneGenerator? = null
    private var vibrator: Vibrator? = null

    private val flushTick = object : Runnable {
        override fun run() {
            onFlushTick()
            main.postDelayed(this, FLUSH_INTERVAL_MS)
        }
    }

    /** 摄像头连续扫码页返回：解除静态回调。 */
    private val cameraLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) {
        BarcodeScanActivity.onBarcode = null
        refreshUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        setContentView(R.layout.activity_task)

        tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
        vibrator = getSystemService(VIBRATOR_SERVICE) as? Vibrator

        bindViews()
        // 断电恢复：先加载持久队列，未被服务端接受的标签继续补传；
        // seen 用队列内容预热，避免恢复后重复入队（已接受的标签服务端任务级排重，重发安全）
        queue.addAll(prefs.queue)
        seen.addAll(queue.map { it.epc })
        mine = prefs.serverMine
        prefs.serverStatsJson.takeIf { it.isNotBlank() }?.let {
            try {
                val s = JSONObject(it)
                statInStore = s.optInt("in_store", 0)
                statOtherStore = s.optInt("other_store", 0)
                statUnknown = s.optInt("unknown", 0)
                statTotal = s.optInt("total", 0)
            } catch (_: Exception) {
            }
        }

        findViewById<TextView>(R.id.btnSettings).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        btnRefresh.setOnClickListener {
            if (online) ws?.send(JSONObject().put("type", "list"))
            else toast(getString(R.string.offline_queued))
        }
        btnTrigger.setOnClickListener { toggleScan() }
        btnCamera.setOnClickListener { openCamera() }
        btnSubmit.setOnClickListener { askSubmit() }

        task = prefs.currentTask
        refreshUi()
        connectWs()
        initRfid()
    }

    private fun bindViews() {
        cardIdle = findViewById(R.id.cardIdle)
        cardWork = findViewById(R.id.cardWork)
        llTaskList = findViewById(R.id.llTaskList)
        tvEmpty = findViewById(R.id.tvEmpty)
        btnRefresh = findViewById(R.id.btnRefresh)
        btnTrigger = findViewById(R.id.btnTrigger)
        btnCamera = findViewById(R.id.btnCamera)
        btnSubmit = findViewById(R.id.btnSubmit)
        tvSubmitHint = findViewById(R.id.tvSubmitHint)
        tvTaskNo = findViewById(R.id.tvTaskNo)
        tvDeviceNo = findViewById(R.id.tvDeviceNo)
        tvNet = findViewById(R.id.tvNet)
        dotNet = findViewById(R.id.dotNet)
        tvMine = findViewById(R.id.tvMineNum)
        tvQueue = findViewById(R.id.tvQueueNum)
        tvStatInStore = findViewById(R.id.tvStatInStore)
        tvStatOther = findViewById(R.id.tvStatOther)
        tvStatUnknown = findViewById(R.id.tvStatUnknown)
        tvStatTotal = findViewById(R.id.tvStatTotal)
        tvUhf = findViewById(R.id.tvUhf)
    }

    override fun onResume() {
        super.onResume()
        registerTriggerReceiver()
        main.postDelayed(flushTick, 800)
    }

    override fun onPause() {
        super.onPause()
        unregisterTriggerReceiver()
        main.removeCallbacks(flushTick)
        if (scanning) {
            scanning = false
            RfidManager.stop()
        }
        persistQueue()
        refreshUi()
    }

    override fun onDestroy() {
        super.onDestroy()
        ws?.close()
        RfidManager.stop()
        try { tone?.release() } catch (_: Exception) {}
        bg.shutdownNow()
        main.removeCallbacksAndMessages(null)
    }

    // ============================================================ WebSocket

    private fun connectWs() {
        if (prefs.deviceToken.isBlank() || prefs.serverUrl.isBlank()) {
            backToActivate(); return
        }
        ws = ScanWsClient(prefs.serverUrl, prefs.deviceToken, AppConfig.APP_VERSION,
            object : ScanWsClient.Listener {
                override fun onWsOpen() {
                    online = true
                    offlineToastShown = false
                    ws?.send(JSONObject().put("type", "list"))
                    flushQueue()   // 重连后立即补传离线队列
                    refreshUi()
                }

                override fun onWsClosed(authInvalid: Boolean) {
                    online = false
                    uploading = false
                    pendingBatches.clear()
                    if (authInvalid) {
                        backToActivate()
                    } else {
                        if (!offlineToastShown && task != null) {
                            offlineToastShown = true
                            toast(getString(R.string.offline_queued))
                        }
                        refreshUi()
                    }
                }

                override fun onWsMessage(msg: JSONObject) {
                    dispatch(msg)
                }
            }).also { it.connect() }
    }

    private fun dispatch(msg: JSONObject) {
        when (msg.optString("type")) {
            "task_list" -> {
                val arr = msg.optJSONArray("tasks") ?: JSONArray()
                val list = mutableListOf<TaskOffer>()
                for (i in 0 until arr.length()) {
                    arr.optJSONObject(i)?.let { list.add(TaskOffer.fromBrief(it)) }
                }
                offers = list
                renderTaskList()
                reconcileCurrent(list)
            }
            "task_offer" -> {
                msg.optJSONObject("task")?.let { b ->
                    val o = TaskOffer.fromBrief(b)
                    if (offers.none { it.id == o.id }) {
                        offers.add(0, o)
                        if (task == null) toast(getString(R.string.task_offer_tip, o.taskNo))
                    }
                    renderTaskList()
                }
            }
            "task_closed" -> {
                val tid = msg.optInt("task_id", 0)
                offers.removeAll { it.id == tid }
                renderTaskList()
                if (task?.id == tid) {
                    handleTaskClosed(msg.optString("status", "").ifBlank { "任务已结束" })
                }
            }
            "ack" -> handleAck(msg)
        }
    }

    /** task_list 是服务端权威状态：当前任务不在列表中说明已在离线期间被关闭/完结。 */
    private fun reconcileCurrent(list: List<TaskOffer>) {
        val t = task ?: return
        val brief = list.firstOrNull { it.id == t.id }
        if (brief == null) {
            if (queue.isEmpty() && pendingBatches.isEmpty()) {
                goIdle(quiet = false)
            }
            return
        }
        statInStore = brief.inStore
        statOtherStore = brief.otherStore
        statUnknown = brief.unknown
        statTotal = brief.total
        persistStats()
        refreshUi()
    }

    private fun handleAck(msg: JSONObject) {
        val ok = msg.optBoolean("ok", false)
        when (msg.optString("ref")) {
            "claim" -> {
                claimBusy = false
                if (ok) {
                    val tj = msg.optJSONObject("task")
                    if (tj != null) {
                        enterWork(
                            TaskInfo(
                                id = tj.optInt("task_id", 0),
                                taskNo = tj.optString("task_no", ""),
                                type = tj.optString("type", ""),
                                title = tj.optString("title", ""),
                                status = tj.optString("status", STATUS_ACTIVE),
                                deviceNo = msg.optInt("device_no", 0),
                                submitted = msg.optBoolean("submitted", false)
                            )
                        )
                    }
                } else {
                    showError(getString(R.string.task_title), msg.optString("message", "领取失败"))
                    refreshUi()
                }
            }
            "scan" -> {
                // FIFO 匹配本帧对应的批次（服务端按帧顺序应答）
                val batch = pendingBatches.removeFirstOrNull()
                uploading = pendingBatches.isNotEmpty()
                if (ok) {
                    online = true
                    offlineToastShown = false
                    mine = msg.optInt("mine", mine)
                    msg.optJSONObject("stats")?.let { applyStats(it) }
                    if (batch != null) queue.removeAll { it.epc in batch }
                    persistQueue()
                    persistStats()
                    refreshUi()
                } else {
                    // 批次仍保留在 queue 中，下一拍重发；任务已关闭则立刻停扫
                    if (msg.optBoolean("task_closed", false)) {
                        handleTaskClosed(msg.optString("message", "任务已结束，停止扫描"))
                    } else {
                        // 业务拒绝（如尚未领取任务）：避免空转，提示一次
                        toast(msg.optString("message", "扫描数据发送失败"))
                        refreshUi()
                    }
                }
            }
            "submit" -> {
                if (ok) {
                    val count = msg.optInt("scanned_count", 0)
                    AlertDialog.Builder(this)
                        .setTitle(R.string.submit_result_title)
                        .setMessage(getString(R.string.submit_ok_fmt, count))
                        .setCancelable(false)
                        .setPositiveButton(R.string.dialog_ok) { _, _ -> goIdle(quiet = true) }
                        .show()
                } else {
                    val m = msg.optString("message", "提交失败")
                    if (msg.optBoolean("task_closed", false)) handleTaskClosed(m)
                    else showError(getString(R.string.btn_submit), m)
                }
            }
            else -> {
                // hello 等其他应答无需处理
            }
        }
    }

    private fun applyStats(s: JSONObject) {
        statInStore = s.optInt("in_store", 0)
        statOtherStore = s.optInt("other_store", 0)
        statUnknown = s.optInt("unknown", 0)
        statTotal = s.optInt("total", 0)
    }

    private fun persistStats() {
        prefs.serverMine = mine
        prefs.serverStatsJson = JSONObject()
            .put("in_store", statInStore)
            .put("other_store", statOtherStore)
            .put("unknown", statUnknown)
            .put("total", statTotal)
            .toString()
    }

    // ============================================================ 任务列表 / 领取

    private data class TaskOffer(
        val id: Int, val taskNo: String, val type: String, val title: String,
        val inStore: Int, val otherStore: Int, val unknown: Int, val total: Int
    ) {
        companion object {
            fun fromBrief(o: JSONObject): TaskOffer {
                val st = o.optJSONObject("stats")
                return TaskOffer(
                    id = o.optInt("task_id", o.optInt("id", 0)),
                    taskNo = o.optString("task_no", ""),
                    type = o.optString("type", ""),
                    title = o.optString("title", ""),
                    inStore = st?.optInt("in_store", 0) ?: 0,
                    otherStore = st?.optInt("other_store", 0) ?: 0,
                    unknown = st?.optInt("unknown", 0) ?: 0,
                    total = st?.optInt("total", 0) ?: 0
                )
            }
        }
    }

    private fun renderTaskList() {
        llTaskList.removeAllViews()
        for ((idx, o) in offers.withIndex()) {
            val row = TextView(this).apply {
                text = "${o.taskNo}  ·  ${typeLabel(o.type)}${if (o.title.isNotBlank()) "  ${o.title}" else ""}  ·  ${o.total}"
                textSize = 16f
                setTextColor(Color.parseColor("#222222"))
                setPadding(28, 26, 28, 26)
                setBackgroundResource(R.drawable.bg_card)
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                if (idx > 0) lp.topMargin = 10
                layoutParams = lp
                isClickable = true
                setOnClickListener { claimTask(o) }
            }
            llTaskList.addView(row)
        }
        tvEmpty.visibility = if (offers.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun typeLabel(tp: String): String = when (tp) {
        "stocktake" -> "盘点"
        "sale" -> "销售开单"
        "transfer_out" -> "调拨出库"
        "transfer_in" -> "调拨收货"
        "loan" -> "借货"
        else -> "扫码"
    }

    private fun claimTask(o: TaskOffer) {
        if (claimBusy) return
        if (!online) {
            toast(getString(R.string.claim_need_net)); return
        }
        val sent = ws?.send(JSONObject().put("type", "claim").put("task_id", o.id)) ?: false
        if (!sent) {
            toast(getString(R.string.claim_need_net))
            return
        }
        claimBusy = true
        refreshUi()
    }

    private fun enterWork(t: TaskInfo) {
        task = t
        prefs.currentTask = t
        queue.clear()
        seen.clear()
        mine = 0
        statInStore = 0; statOtherStore = 0; statUnknown = 0; statTotal = 0
        persistQueue()
        persistStats()
        refreshUi()
    }

    // ============================================================ UHF 初始化

    private fun initRfid() {
        bg.execute {
            // 部分固件首次 init 会失败（串口被占用/未就绪），最多重试 3 次；成功即停，避免重复打开串口
            var attempt = 0
            while (attempt < 3 && !RfidManager.ready) {
                RfidManager.init(applicationContext)
                attempt++
                if (!RfidManager.ready) Thread.sleep(800)
            }
            main.post {
                if (RfidManager.ready) RfidManager.setPower(prefs.power)
                refreshUi()
            }
            // 版本/功率探测是阻塞串口调用，放独立线程，卡死也不影响就绪判定
            if (RfidManager.ready) {
                Thread {
                    val info = RfidManager.probeInfo()
                    RfidManager.cachedInfo = info ?: ""
                }.start()
            }
        }
    }

    // ============================================================ 扫描

    /** 屏幕大按钮 / 机身扳机共用：按一下开始连续扫描，再按一下停止。 */
    private fun toggleScan() {
        if (task == null) return
        if (scanning) {
            pauseScan()
            return
        }
        if (!RfidManager.ready) {
            toast(getString(R.string.uhf_none) + "，请使用「摄像头扫码」")
            return
        }
        RfidManager.setPower(prefs.power)
        val ok = RfidManager.start { epc, rssi -> onTag(epc, rssi, SOURCE_RFID) }
        if (!ok) {
            rfidErrorToast(this, R.string.rfid_fail)
            return
        }
        scanning = true
        beep()
        refreshUi()
    }

    private fun pauseScan() {
        if (!scanning && !RfidManager.scanning) {
            refreshUi()
            return
        }
        scanning = false
        RfidManager.stop()
        refreshUi()
    }

    /**
     * 标签入库（主线程回调）：
     * rfid 通道只在连续盘点中接收；camera 只要在任务态即接收。
     * 本机内存 Set 会话级去重，新标签才入队并蜂鸣。
     * 离线照常入队（领取任务后允许完全脱机），重连后批量补传。
     */
    private fun onTag(epcRaw: String, rssi: Int, source: String) {
        val t = task ?: return
        if (source == SOURCE_RFID && !scanning) return
        val epc = epcRaw.uppercase()
        if (epc.isEmpty()) return
        if (!seen.add(epc)) return
        queue.add(QueueItem(epc, rssi, source, System.currentTimeMillis()))
        queueDirty = true
        beep()
        refreshCounters()
        // 摄像头通道没有盘点循环兜底，立即触发一次落盘+上报
        if (source != SOURCE_RFID) {
            persistQueue()
            flushQueue()
        }
    }

    private fun openCamera() {
        if (task == null) return
        // 摄像头工作期间先停下 UHF，避免双通道同时计数
        if (scanning) pauseScan()
        BarcodeScanActivity.onBarcode = { code ->
            if (task == null) false else {
                onTag(code, 0, SOURCE_CAMERA)
                true
            }
        }
        cameraLauncher.launch(Intent(this, BarcodeScanActivity::class.java))
    }

    // ============================================================ 落盘 / 补传

    private fun onFlushTick() {
        if (queueDirty) persistQueue()
        if (task != null && queue.isNotEmpty()) flushQueue()
    }

    private fun persistQueue() {
        prefs.queue = queue
        queueDirty = false
    }

    /** 将本地队列按 source 分组通过 WS 批量发出；帧与 ack FIFO 配对。 */
    private fun flushQueue() {
        val t = task ?: return
        if (uploading || queue.isEmpty() || !online) return
        uploading = true
        val snapshot = ArrayList(queue)
        snapshot.groupBy { it.source }.forEach { (src, items) ->
            val tags = JSONArray()
            items.forEach { q ->
                tags.put(JSONObject().put("epc", q.epc).put("rssi", q.rssi))
            }
            val frame = JSONObject()
                .put("type", "scan")
                .put("source", if (src in setOf(SOURCE_RFID, SOURCE_CAMERA)) src else SOURCE_RFID)
                .put("tags", tags)
            val queued = ws?.send(frame) ?: false
            if (queued) {
                pendingBatches.addLast(HashSet(items.map { it.epc }))
            } else {
                uploading = false
                online = false
                return
            }
        }
        // 极端情况下无分组（不会发生）：直接复位
        if (pendingBatches.isEmpty()) uploading = false
    }

    /** 任务被发起端关闭/已完结：立即停盘点，弹窗后回待领取态。 */
    private fun handleTaskClosed(detail: String) {
        online = true
        if (scanning) {
            scanning = false
            RfidManager.stop()
        }
        refreshUi()
        if (closedDialogShown) return
        closedDialogShown = true
        AlertDialog.Builder(this)
            .setTitle(R.string.task_ended_title)
            .setMessage(detail)
            .setCancelable(false)
            .setPositiveButton(R.string.dialog_ok) { _, _ ->
                closedDialogShown = false
                goIdle(quiet = false)
            }
            .show()
    }

    /** 回到待领取态：清任务与本地队列（已结束任务的数据无法再上报）。 */
    private fun goIdle(quiet: Boolean) {
        scanning = false
        RfidManager.stop()
        task = null
        prefs.currentTask = null
        queue.clear()
        seen.clear()
        pendingBatches.clear()
        uploading = false
        mine = 0
        statInStore = 0; statOtherStore = 0; statUnknown = 0; statTotal = 0
        persistQueue()
        persistStats()
        if (!quiet) toast(getString(R.string.task_ended_title))
        // 回待领取态后主动拉一次最新任务列表
        if (online) ws?.send(JSONObject().put("type", "list"))
        refreshUi()
    }

    // ============================================================ 提交完结

    private fun askSubmit() {
        if (task == null) return
        if (!online) {
            toast(getString(R.string.claim_need_net)); return
        }
        if (uploading || queue.isNotEmpty() || pendingBatches.isNotEmpty()) {
            toast(getString(R.string.submit_blocked, queue.size))
            return
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.submit_confirm_title)
            .setMessage(R.string.submit_confirm_msg)
            .setPositiveButton(R.string.dialog_ok) { _, _ -> doSubmit() }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    private fun doSubmit() {
        val sent = ws?.send(JSONObject().put("type", "submit")) ?: false
        if (!sent) toast(getString(R.string.claim_need_net))
    }

    // ============================================================ 机身扳机（广播为主 + KeyEvent 兜底）

    private val triggerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            if (!TriggerChannels.handlesBroadcast(prefs.triggerMode)) return
            if (prefs.triggerMode != TriggerChannels.MODE_AUTO &&
                action != TriggerChannels.actionForMode(prefs.triggerMode)
            ) return
            val down = when (val v = intent.extras?.get("keydown")) {
                is Boolean -> v
                is String -> v.equals("true", ignoreCase = true) || v == "1"
                is Int -> v != 0
                // 部分固件只发"按下"广播且不带 extras：注册的动作出现即视为按下
                null -> true
                else -> intent.getBooleanExtra("keydown", true)
            }
            // 只处理按下事件；松开语义在各固件上不可靠（双拍/连发会秒停）
            if (down) onTriggerDown()
        }
    }

    private fun registerTriggerReceiver() {
        val actions = TriggerChannels.actionsForMode(prefs.triggerMode)
        if (actions.isEmpty()) return
        val filter = IntentFilter().apply { actions.forEach { addAction(it) } }
        try {
            ContextCompat.registerReceiver(
                this, triggerReceiver, filter, ContextCompat.RECEIVER_EXPORTED
            )
        } catch (_: Exception) {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(triggerReceiver, filter)
        }
    }

    private fun unregisterTriggerReceiver() {
        try { unregisterReceiver(triggerReceiver) } catch (_: Exception) {}
    }

    /** 800ms 防抖（KeyEvent+广播双通道、固件连发）。任务态切换 UHF 扫描。 */
    private fun onTriggerDown() {
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lastTriggerAt < 800) return
        lastTriggerAt = now
        if (task != null) toggleScan()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!TriggerChannels.handlesKeyEvent(prefs.triggerMode))
            return super.dispatchKeyEvent(event)
        val code = event.keyCode
        val candidate = code == 66 || code == 82 ||
                code in 96..110 || code in 131..143 || code in 280..300
        val focusEditable = currentFocus is android.widget.EditText
        val knownTrigger = candidate && !(code == 66 && focusEditable)
        val src = event.source
        val physical = (src and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
                (src and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
        val dpadCenter = (src and InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD &&
                code == KeyEvent.KEYCODE_DPAD_CENTER
        val isTrigger = knownTrigger || physical || dpadCenter
        if (isTrigger) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                onTriggerDown()
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // ============================================================ 反馈

    private fun beep() {
        try {
            val ok = tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 150) ?: false
            if (!ok) {
                try { tone?.release() } catch (_: Exception) {}
                tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
                tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
            }
        } catch (_: Exception) {}
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(40, 120))
            } else {
                @Suppress("DEPRECATION") vibrator?.vibrate(40)
            }
        } catch (_: Exception) {}
    }

    // ============================================================ UI

    private fun refreshCounters() {
        tvMine.text = mine.toString()
        tvQueue.text = queue.size.toString()
        tvSubmitHint.text = if (queue.isNotEmpty())
            getString(R.string.submit_blocked, queue.size)
        else getString(R.string.submit_hint)
        btnSubmit.isEnabled = queue.isEmpty()
        btnSubmit.alpha = if (queue.isEmpty()) 1f else 0.45f
    }

    private fun refreshUi() {
        val t = task
        val inTask = t != null
        cardIdle.visibility = if (inTask) View.GONE else View.VISIBLE
        cardWork.visibility = if (inTask) View.VISIBLE else View.GONE

        renderTaskList()

        if (t != null) {
            tvTaskNo.text = t.taskNo
            tvDeviceNo.text = if (t.deviceNo > 0) "${t.deviceNo}号" else "—"
        }
        tvNet.text = getString(if (online) R.string.net_online else R.string.net_offline)
        tvNet.setTextColor(getColor(if (online) R.color.green else R.color.text_secondary))
        dotNet.setImageResource(if (online) R.drawable.dot_green else R.drawable.dot_gray)

        tvMine.text = mine.toString()
        tvQueue.text = queue.size.toString()
        tvStatInStore.text = statInStore.toString()
        tvStatOther.text = statOtherStore.toString()
        tvStatUnknown.text = statUnknown.toString()
        tvStatTotal.text = statTotal.toString()

        btnTrigger.text = getString(
            if (scanning) R.string.trigger_btn_active else R.string.trigger_btn
        )
        btnTrigger.setBackgroundResource(
            if (scanning) R.drawable.bg_btn_red else R.drawable.bg_btn_green
        )

        tvSubmitHint.text = if (queue.isNotEmpty() || pendingBatches.isNotEmpty())
            getString(R.string.submit_blocked, queue.size)
        else getString(R.string.submit_hint)
        val canSubmit = queue.isEmpty() && pendingBatches.isEmpty()
        btnSubmit.isEnabled = canSubmit
        btnSubmit.alpha = if (canSubmit) 1f else 0.45f

        if (RfidManager.ready) {
            tvUhf.setText(R.string.uhf_ok)
            tvUhf.setBackgroundResource(R.drawable.badge_green)
        } else {
            tvUhf.setText(R.string.uhf_none)
            tvUhf.setBackgroundResource(R.drawable.badge_orange)
        }
    }

    private fun showError(title: String, message: String) {
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton(R.string.dialog_ok, null)
            .show()
    }

    private fun backToActivate() {
        if (isFinishing) return
        prefs.clearAuth()
        prefs.currentTask = null
        // 清空本地待补传队列，避免换绑/重新激活后把旧任务 EPC 用新凭证串发到新任务
        queue.clear()
        prefs.queue = queue
        scanning = false
        RfidManager.stop()
        val intent = Intent(this, ActivateActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        startActivity(intent)
        finish()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private companion object {
        const val STATUS_ACTIVE = "进行中"
        const val SOURCE_RFID = "rfid"
        const val SOURCE_CAMERA = "camera"
        const val FLUSH_INTERVAL_MS = 1200L
    }
}
