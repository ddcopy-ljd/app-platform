package com.yizhen.rfid

import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** 采集到的一条 EPC。 */
private data class EpcItem(
    val epc: String,
    var rssi: Int,
    var hits: Int,
    val seq: Int,
    val firstAt: String
)

/**
 * 【临时工具】EPC 采集。
 *
 * 用途：用手持机实扫一批真实标签，把 EPC 导出来给测试/演示数据当商品 EPC 用。
 * 采集方式：按机身扳机或屏幕按钮连续扫描，自动去重，实时计数。
 * 导出方式：①上传到电脑端采集服务（tools/epc_collect_server.py）
 *          ②保存到本机 Download 目录（USB 拷出）③复制到剪贴板。
 */
class EpcCollectActivity : BaseActivity() {

    private lateinit var prefs: Prefs
    private val net = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val map = LinkedHashMap<String, EpcItem>()
    private val list = ArrayList<EpcItem>()
    private lateinit var adapter: EpcAdapter

    private var scanning = false
    private var hitCount = 0
    private var dupCount = 0
    private var lastTriggerAt = 0L
    private var tone: ToneGenerator? = null

    private lateinit var etServer: EditText
    private lateinit var etBatch: EditText
    private lateinit var tvCount: TextView
    private lateinit var tvState: TextView
    private lateinit var tvResult: TextView
    private lateinit var tvEmpty: TextView
    private lateinit var btnScan: TextView

    private val tsFmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
    private val fileFmt = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_epc_collect)
        prefs = Prefs(this)
        tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)

        etServer = findViewById(R.id.etEpcServer)
        etBatch = findViewById(R.id.etEpcBatch)
        tvCount = findViewById(R.id.tvEpcCount)
        tvState = findViewById(R.id.tvEpcState)
        tvResult = findViewById(R.id.tvEpcResult)
        tvEmpty = findViewById(R.id.tvEpcEmpty)
        btnScan = findViewById(R.id.btnEpcScan)

        etServer.setText(prefs.epcServerUrl)
        if (prefs.epcServerUrl.isBlank()) etServer.setText(defaultServerUrl())
        etBatch.setText(SimpleDateFormat("yyyyMMdd", Locale.US).format(Date()))

        adapter = EpcAdapter()
        findViewById<RecyclerView>(R.id.rvEpc).apply {
            layoutManager = LinearLayoutManager(this@EpcCollectActivity)
            adapter = this@EpcCollectActivity.adapter
        }

        btnScan.setOnClickListener { toggleScan() }
        findViewById<TextView>(R.id.btnEpcClear).setOnClickListener { clearAll() }
        findViewById<TextView>(R.id.btnEpcCopy).setOnClickListener { copyAll() }
        findViewById<TextView>(R.id.btnEpcSave).setOnClickListener { saveLocal() }
        findViewById<TextView>(R.id.btnEpcUpload).setOnClickListener { upload() }
        findViewById<TextView>(R.id.btnEpcUseOrigin).setOnClickListener {
            etServer.setText(defaultServerUrl())
            toast(getString(R.string.epc_origin_filled, etServer.text.toString()))
        }

        initRfid()
        refreshUi()
    }

    /** 默认采集地址：优先用登录时的服务端 IP + 采集服务端口。 */
    private fun defaultServerUrl(): String {
        val origin = prefs.authOrigin.trim() // 如 http://192.168.1.20:8002
        val host = Regex("^(https?://[^/:]+)").find(origin)?.groupValues?.get(1)
        return if (host.isNullOrBlank()) "http://192.168.1.100:${DevFlags.EPC_COLLECTOR_PORT}"
        else "$host:${DevFlags.EPC_COLLECTOR_PORT}"
    }

    private fun initRfid() {
        net.execute {
            repeat(3) {
                RfidManager.init(applicationContext)
                if (RfidManager.ready) return@repeat
                try { Thread.sleep(800) } catch (_: InterruptedException) { }
            }
            if (RfidManager.ready) RfidManager.setPower(prefs.power)
        }
    }

    // -------------------------------- 扫描

    private fun toggleScan() {
        if (scanning) { stopScan(); return }
        if (!RfidManager.ready) { toast(R.string.epc_rfid_fail); return }
        RfidManager.setPower(prefs.power)
        val ok = RfidManager.start { epc, rssi -> onTag(epc, rssi) }
        if (!ok) { toast(R.string.epc_rfid_fail); return }
        scanning = true
        refreshUi()
    }

    private fun stopScan() {
        scanning = false
        RfidManager.stop()
        refreshUi()
    }

    private fun onTag(epcRaw: String, rssi: Int) {
        if (!scanning) return
        val epc = epcRaw.uppercase()
        val exist = map[epc]
        if (exist != null) {
            exist.hits += 1
            exist.rssi = rssi
            dupCount += 1
        } else {
            val item = EpcItem(epc, rssi, 1, list.size + 1, tsFmt.format(Date()))
            map[epc] = item
            list.add(item)
            hitCount += 1
            adapter.notifyItemInserted(list.size - 1)
            beep()
        }
        refreshCount()
    }

    private fun clearAll() {
        stopScan()
        val n = list.size
        map.clear()
        list.clear()
        hitCount = 0
        dupCount = 0
        adapter.notifyDataSetChanged()
        refreshUi()
        toast(getString(R.string.epc_cleared, n))
    }

    // -------------------------------- 导出

    /** 纯文本：# 开头的注释行 + 每行一个 EPC。 */
    private fun buildTxt(): String {
        val sb = StringBuilder()
        sb.append("# EPC 采集导出\n")
        sb.append("# device=${prefs.deviceKey} batch=${etBatch.text.toString().trim()} ")
        sb.append("ts=${tsFmt.format(Date())} count=${list.size}\n")
        list.forEach { sb.append(it.epc).append('\n') }
        return sb.toString()
    }

    private fun buildJson(): JSONObject {
        val arr = JSONArray()
        list.forEach {
            arr.put(
                JSONObject()
                    .put("epc", it.epc)
                    .put("rssi", it.rssi)
                    .put("hits", it.hits)
                    .put("seq", it.seq)
                    .put("ts", it.firstAt)
            )
        }
        return JSONObject()
            .put("device", prefs.deviceKey)
            .put("name", prefs.deviceName)
            .put("batch", etBatch.text.toString().trim())
            .put("exported", tsFmt.format(Date()))
            .put("count", list.size)
            .put("tags", arr)
    }

    private fun copyAll() {
        if (list.isEmpty()) { toast(R.string.epc_no_data); return }
        val text = list.joinToString("\n") { it.epc }
        val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("EPC", text))
        toast(getString(R.string.epc_copied, list.size))
    }

    private fun saveLocal() {
        if (list.isEmpty()) { toast(R.string.epc_no_data); return }
        try {
            val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
            if (!dir.exists()) dir.mkdirs()
            val batch = etBatch.text.toString().trim()
                .let { if (it.isBlank()) "batch" else it.replace(Regex("[^A-Za-z0-9_\\-\\u4e00-\\u9fa5]"), "_") }
            val base = "epc_${batch}_${fileFmt.format(Date())}"
            val txt = File(dir, "$base.txt")
            val json = File(dir, "$base.json")
            txt.writeText(buildTxt())
            json.writeText(buildJson().toString(2))
            tvResult.text = getString(R.string.epc_saved_path, txt.absolutePath, json.absolutePath)
            toast(getString(R.string.epc_saved, dir.name))
        } catch (e: Exception) {
            tvResult.text = getString(R.string.epc_save_fail, e.message ?: e.toString())
        }
    }

    private fun upload() {
        val url = etServer.text.toString().trim()
        if (url.isBlank()) { toast(R.string.epc_no_server); return }
        if (list.isEmpty()) { toast(R.string.epc_no_data); return }
        prefs.epcServerUrl = url
        val payload = buildJson()
        tvResult.text = getString(R.string.epc_uploading)
        net.execute {
            try {
                val req = Request.Builder()
                    .url(url.trimEnd('/') + "/upload")
                    .post(payload.toString().toRequestBody(jsonType))
                    .build()
                http.newCall(req).execute().use { resp ->
                    val text = resp.body?.string() ?: ""
                    if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}: $text")
                    val jo = if (text.isBlank()) JSONObject() else JSONObject(text)
                    val new = jo.optInt("new", 0)
                    val total = jo.optInt("total", 0)
                    main.post { tvResult.text = getString(R.string.epc_upload_ok, new, total) }
                }
            } catch (e: Exception) {
                val msg = e.message ?: e.toString()
                main.post { tvResult.text = getString(R.string.epc_upload_fail, msg) }
            }
        }
    }

    // -------------------------------- 扳机

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
            if (down) onTriggerDown()
        }
    }

    override fun onResume() {
        super.onResume()
        val actions = TriggerChannels.actionsForMode(prefs.triggerMode)
        if (actions.isEmpty()) return
        val filter = IntentFilter().apply { actions.forEach { addAction(it) } }
        try {
            ContextCompat.registerReceiver(this, triggerReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
        } catch (_: Exception) {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(triggerReceiver, filter)
        }
    }

    override fun onPause() {
        super.onPause()
        try { unregisterReceiver(triggerReceiver) } catch (_: Exception) {}
    }

    /** 扳机：按一下开始，再按一下停止；800ms 防抖。 */
    private fun onTriggerDown() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastTriggerAt < 800) return
        lastTriggerAt = now
        toggleScan()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!TriggerChannels.handlesKeyEvent(prefs.triggerMode)) return super.dispatchKeyEvent(event)
        val code = event.keyCode
        val candidate = code == 66 || code == 82 ||
                code in 96..110 || code in 131..143 || code in 280..300
        val focusEditable = currentFocus is EditText
        val knownTrigger = candidate && !(code == 66 && focusEditable)
        val src = event.source
        val physical = (src and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
                (src and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
        val dpadCenter = (src and InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD &&
                code == KeyEvent.KEYCODE_DPAD_CENTER
        if (knownTrigger || physical || dpadCenter) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) onTriggerDown()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // -------------------------------- UI

    private fun refreshCount() {
        tvCount.text = getString(R.string.epc_count, list.size, hitCount, dupCount)
        tvEmpty.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun refreshUi() {
        refreshCount()
        tvState.text = getString(if (scanning) R.string.epc_state_scanning else R.string.epc_state_idle)
        btnScan.text = getString(if (scanning) R.string.epc_btn_stop else R.string.epc_btn_scan)
        btnScan.setBackgroundResource(if (scanning) R.drawable.bg_btn_red else R.drawable.bg_btn_green)
    }

    private fun beep() {
        try { tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 120) } catch (_: Exception) {}
    }

    private fun toast(resId: Int) = Toast.makeText(this, resId, Toast.LENGTH_SHORT).show()
    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        stopScan()
        net.shutdownNow()
        try { tone?.release(); tone = null } catch (_: Exception) {}
        super.onDestroy()
    }

    private inner class EpcAdapter : RecyclerView.Adapter<EpcAdapter.VH>() {
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
            VH(LayoutInflater.from(parent.context).inflate(R.layout.item_scan, parent, false))

        override fun getItemCount() = list.size

        override fun onBindViewHolder(h: VH, position: Int) {
            val it = list[position]
            h.name.text = "#${it.seq} · ${it.firstAt.takeLast(8)}"
            h.epc.text = it.epc
            h.badge.text = "${it.rssi} ×${it.hits}"
            h.badge.setBackgroundResource(R.drawable.badge_green)
            h.badge.setTextColor(0xFFC8E6C9.toInt())
        }

        inner class VH(v: View) : RecyclerView.ViewHolder(v) {
            val name: TextView = v.findViewById(R.id.tvName)
            val epc: TextView = v.findViewById(R.id.tvEpc)
            val badge: TextView = v.findViewById(R.id.tvBadge)
        }
    }
}
