package com.yizhen.rfid

import android.content.Context

/** 全局设置与任务态本地存储。 */
class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("rfid", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", "") ?: ""
        set(v) = sp.edit().putString("server_url", v.trim()).apply()

    var pullInterval: Int
        get() = sp.getInt("pull_interval", 15)
        set(v) = sp.edit().putInt("pull_interval", v).apply()

    var power: Int
        get() = sp.getInt("power", 20)
        set(v) = sp.edit().putInt("power", v).apply()

    var region: Int
        get() = sp.getInt("region", 0)
        set(v) = sp.edit().putInt("region", v).apply()

    var session: Int
        get() = sp.getInt("session", 0)
        set(v) = sp.edit().putInt("session", v).apply()

    var qValue: Int
        get() = sp.getInt("qvalue", 0)
        set(v) = sp.edit().putInt("qvalue", v).apply()

    /** 0=连续读取 1=单次读取 */
    var readMode: Int
        get() = sp.getInt("read_mode", 0)
        set(v) = sp.edit().putInt("read_mode", v).apply()

    var rssiEnabled: Boolean
        get() = sp.getBoolean("rssi_enabled", true)
        set(v) = sp.edit().putBoolean("rssi_enabled", v).apply()

    var rssiThreshold: Int
        get() = sp.getInt("rssi_threshold", -75)
        set(v) = sp.edit().putInt("rssi_threshold", v).apply()

    var dedup: Boolean
        get() = sp.getBoolean("dedup", true)
        set(v) = sp.edit().putBoolean("dedup", v).apply()

    var highValueRemind: Boolean
        get() = sp.getBoolean("hv_remind", true)
        set(v) = sp.edit().putBoolean("hv_remind", v).apply()

    var vibrateAbnormal: Boolean
        get() = sp.getBoolean("vibrate", true)
        set(v) = sp.edit().putBoolean("vibrate", v).apply()

    var lang: String
        get() = sp.getString("lang", "zh") ?: "zh"
        set(v) = sp.edit().putString("lang", v).apply()

    /** 本机设备唯一标识（安装后生成）。 */
    val deviceKey: String
        get() {
            var k = sp.getString("device_key", "")
            if (k.isNullOrEmpty()) {
                k = "C27-" + java.util.UUID.randomUUID().toString().replace("-", "").take(6).uppercase()
                sp.edit().putString("device_key", k).apply()
            }
            return k
        }

    var deviceName: String
        get() = sp.getString("device_name", "") ?: ""
        set(v) = sp.edit().putString("device_name", v).apply()

    /** 最近一次任务的本机临时编号。 */
    var deviceNo: Int
        get() = sp.getInt("device_no", 0)
        set(v) = sp.edit().putInt("device_no", v).apply()

    // —— 任务态 ——
    var taskKey: String
        get() = sp.getString("task_key", "") ?: ""
        set(v) = sp.edit().putString("task_key", v).apply()

    var taskNo: String
        get() = sp.getString("task_no", "") ?: ""
        set(v) = sp.edit().putString("task_no", v).apply()

    var snapshotJson: String
        get() = sp.getString("snapshot_json", "") ?: ""
        set(v) = sp.edit().putString("snapshot_json", v).apply()

    var pullSinceId: Int
        get() = sp.getInt("pull_since_id", 0)
        set(v) = sp.edit().putInt("pull_since_id", v).apply()

    /** 离线待传扫描批次 JSON 数组。 */
    var offlineQueue: String
        get() = sp.getString("offline_queue", "[]") ?: "[]"
        set(v) = sp.edit().putString("offline_queue", v).apply()

    fun resetAll() {
        val dk = deviceKey
        sp.edit().clear().apply()
        sp.edit().putString("device_key", dk).apply()
    }
}
