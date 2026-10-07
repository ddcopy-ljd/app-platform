package com.yizhen.scanassistant

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.entity.UHFTAGInfo

/**
 * C27 UHF RFID 模块封装（RSCJA DeviceAPI UART）。
 * 单例；start() 后内部线程持续读取标签缓冲并回调主线程。
 *
 * 直接复用 scanner-app（com.yizhen.rfid）现场验证版本，仅改包名：
 * init() 串行锁防止多页面并发 init；start() 针对 C72_6763 固件的
 * 「首次 startInventoryTag 假失败」最多重试 3 次、间隔 200ms，
 * 重试期间不 free()/init()、不 stopInventory()。硬件时序保持不变。
 */
object RfidManager {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var uhf: RFIDWithUHFUART? = null

    var ready = false
        private set

    /** 最近一次启动失败的原因（供 UI 直接展示）。 */
    @Volatile
    var lastError: String = ""
        private set

    // 初始化后由独立线程探测的模块信息（如 "v2.3 · 20dBm"），失败为空串
    @Volatile
    var cachedInfo = ""

    @Volatile
    var scanning = false
        private set

    private var worker: Thread? = null

    // 多页面可能几乎同时触发 init，串行化避免两个线程
    // 同时调用 SDK init() 重复打开 /dev/ttyMT1。
    private val initLock = Any()

    fun init(context: Context) {
        synchronized(initLock) {
            if (ready) return
            try {
                uhf = RFIDWithUHFUART.getInstance()
                uhf?.init(context)
                ready = true
            } catch (_: Throwable) {
                ready = false
            }
        }
    }

    /** 探测模块版本与当前功率（阻塞串口调用，仅在工作线程调用；异常返回 null）。 */
    fun probeInfo(): String? = try {
        val v = version()
        val p = power()
        listOfNotNull(v.ifBlank { null }, if (p in 1..33) "${p}dBm" else null)
            .joinToString(" · ").ifBlank { null }
    } catch (_: Throwable) {
        null
    }

    fun version(): String = try {
        uhf?.getVersion() ?: ""
    } catch (e: Exception) {
        ""
    }

    fun power(): Int = try {
        uhf?.getPower() ?: -1
    } catch (e: Exception) {
        -1
    }

    fun setPower(dbm: Int) {
        try {
            uhf?.setPower(dbm)
        } catch (_: Exception) {
        }
    }

    /**
     * 开始盘存（连续读取，直到 stop()）。
     * @param onTag 主线程回调 (epc, rssi)
     */
    fun start(onTag: (String, Int) -> Unit): Boolean {
        if (!ready || scanning) return false
        // C72_6763 固件实测：init 之后首次 startInventoryTag() 会假失败——返回 false，
        // 但模块其实已经进入盘存态；同一台机器上第二次调用即返回 true。
        // 因此此处连续重试最多 3 次，重试间隔 200ms；期间绝不 free()+init()
        // （重复申请串口会把模块打坏），也不调用 stopInventory()（会打断已经开始的盘存）。
        repeat(3) { attempt ->
            val started = try {
                uhf?.startInventoryTag() ?: false
            } catch (e: Exception) {
                false
            }
            if (started) {
                scanning = true
                worker = Thread {
                    while (scanning) {
                        try {
                            val tag: UHFTAGInfo? = uhf?.readTagFromBuffer()
                            if (tag != null) {
                                val epc = tag.getEPC()
                                if (!epc.isNullOrEmpty()) {
                                    val rssi = parseIntSafe(tag.getRssi()?.toString())
                                    mainHandler.post {
                                        if (scanning) onTag(epc, rssi)
                                    }
                                }
                            } else {
                                Thread.sleep(20)
                            }
                        } catch (e: Exception) {
                            Thread.sleep(50)
                        }
                    }
                }.also { it.start() }
                lastError = ""
                return true
            }
            lastError = "startInventoryTag() 第 ${attempt + 1} 次返回 false（C72 固件首次假失败，重试中）"
            if (attempt < 2) {
                try { Thread.sleep(200) } catch (_: InterruptedException) {}
            }
        }
        lastError = "startInventoryTag() 重试 3 次仍失败（模块已 init 但盘存启动失败）"
        return false
    }

    private fun parseIntSafe(s: String?): Int {
        if (s.isNullOrBlank()) return 0
        val m = Regex("-?\\d+").find(s) ?: return 0
        return m.value.toIntOrNull() ?: 0
    }

    fun stop() {
        if (!scanning) return
        scanning = false
        try {
            uhf?.stopInventory()
        } catch (_: Exception) {
        }
        worker?.let {
            try {
                it.join(600)
            } catch (_: Exception) {
            }
        }
        worker = null
    }

    fun free() {
        stop()
        try {
            uhf?.free()
        } catch (_: Exception) {
        }
        uhf = null
        ready = false
    }
}

/**
 * 弹出 RFID 失败提示，并附带 RfidManager.lastError 中的真实原因，
 * 方便在现场（无需抓 logcat）直接看到初始化/盘存为何失败。
 */
fun rfidErrorToast(context: Context, resId: Int, duration: Int = android.widget.Toast.LENGTH_LONG) {
    val msg = buildString {
        append(context.getString(resId))
        if (RfidManager.lastError.isNotBlank()) append("\n[${RfidManager.lastError}]")
    }
    android.widget.Toast.makeText(context, msg, duration).show()
}
