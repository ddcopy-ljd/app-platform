package com.yizhen.rfid

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.entity.UHFTAGInfo

/**
 * C27 UHF RFID 模块封装（RSCJA DeviceAPI UART）。
 * 单例；start() 后内部线程持续读取标签缓冲并回调主线程。
 */
object RfidManager {
    private const val TAG = "RfidManager"

    private val mainHandler = Handler(Looper.getMainLooper())
    private var uhf: RFIDWithUHFUART? = null

    var ready = false
        private set

    /** 最近一次初始化/启动失败的原因（供 UI 直接展示，便于现场排查）。 */
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

    /** 保存 ApplicationContext，供自愈重试时重新初始化使用。 */
    private var appContext: Context? = null

    /** 最近一次设置的功率（dBm），用于自愈重试时恢复。 */
    private var lastPower = 20

    fun init(context: Context) {
        if (ready) return
        appContext = context.applicationContext ?: context
        initInternal()
    }

    /** 真正的初始化逻辑（init / 自愈重试共用）。 */
    private fun initInternal() {
        lastError = ""
        try {
            uhf = RFIDWithUHFUART.getInstance()
            if (uhf == null) {
                lastError = "getInstance() 返回 null（SDK 类未加载）"
                Log.e(TAG, lastError)
                ready = false
                return
            }
            val ret = uhf!!.init(appContext!!)
            // 注意：部分 C27 固件 init() 会返回 false，但模块实际可用，
            // 因此不把“返回 false”当作失败，维持旧版可用行为；仅记录告警。
            if (!ret) {
                lastError = "init() 返回 false（C27 固件常见，按可用处理）"
                Log.w(TAG, lastError)
            }
            ready = true
            // C27 休眠/重启后 UHF 射频可能未上电，导致 startInventoryTag() 返回 false；先确保上电
            ensurePowerOn()
        } catch (e: Throwable) {
            lastError = e.javaClass.simpleName + ": " + (e.message ?: "未知异常")
            Log.e(TAG, "RFID init failed", e)
            ready = false
        }
    }

    /** 确保 UHF 模块已上电（C27 射频电源被系统关闭时，startInventoryTag 会返回 false）。 */
    private fun ensurePowerOn() {
        if (uhf == null) return
        try {
            if (!uhf!!.isPowerOn) {
                Log.w(TAG, "UHF 模块未上电，调用 setPowerOnBySystem 上电")
                appContext?.let { uhf!!.setPowerOnBySystem(it) }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "setPowerOnBySystem 异常", e)
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
        // 钳到合法区间，避免非法功率导致 startInventoryTag() 返回 false
        val p = dbm.coerceIn(5, 30)
        lastPower = p
        try {
            uhf?.setPower(p)
        } catch (_: Exception) {
        }
    }

    /**
     * 开始盘存（连续读取，直到 stop()）。
     * @param onTag 主线程回调 (epc, rssi)
     */
    fun start(onTag: (String, Int) -> Unit): Boolean {
        if (scanning) return false
        if (!ready) return false
        if (tryStart(onTag)) return true
        // 模块可能卡在异常态（C27 常见）：释放后重新初始化再试一次（自愈）
        Log.w(TAG, "startInventoryTag() 首次失败，执行 free+init 自愈重试")
        recoverAndRetry()
        return tryStart(onTag)
    }

    /** 释放并重新初始化（自愈），使卡住的 UHF 模块恢复正常。 */
    private fun recoverAndRetry() {
        try { uhf?.stopInventory() } catch (_: Exception) {}
        try { uhf?.free() } catch (_: Exception) {}
        ready = false
        uhf = null
        appContext?.let { initInternal() }
    }

    private fun tryStart(onTag: (String, Int) -> Unit): Boolean {
        if (!ready || scanning) return false
        return try {
            // 确保功率合法，部分固件功率非法会令 startInventoryTag 返回 false
            try { uhf?.setPower(lastPower) } catch (_: Exception) {}
            val ok = uhf?.startInventoryTag() ?: false
            if (!ok) {
                val code = runCatching { uhf?.getErrCode() ?: -1 }.getOrDefault(-1)
                lastError = "startInventoryTag() 返回 false（errCode=$code，模块已 init 但盘存启动失败）"
                Log.e(TAG, lastError)
                return false
            }
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
            true
        } catch (e: Exception) {
            lastError = e.javaClass.simpleName + ": " + (e.message ?: "未知异常")
            Log.e(TAG, "start failed", e)
            false
        }
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
