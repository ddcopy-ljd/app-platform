package com.yizhen.rfid

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.entity.UHFTAGInfo

/**
 * C27 UHF RFID 模块封装（RSCJA DeviceAPI UART）。
 * 单例；start() 后内部线程持续读取标签缓冲并回调主线程。
 */
object RfidManager {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var uhf: RFIDWithUHFUART? = null

    var ready = false
        private set

    // 初始化后由独立线程探测的模块信息（如 "v2.3 · 20dBm"），失败为空串
    @Volatile
    var cachedInfo = ""

    @Volatile
    var scanning = false
        private set

    private var worker: Thread? = null

    fun init(context: Context) {
        if (ready) return
        try {
            uhf = RFIDWithUHFUART.getInstance()
            uhf?.init(context)
            ready = true
        } catch (_: Throwable) {
            ready = false
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
        return try {
            val ok = uhf?.startInventoryTag() ?: false
            if (!ok) return false
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
