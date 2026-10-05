package com.yizhen.rfid

import android.content.Context

/** 全局设置与任务态本地存储。 */
class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("rfid", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", "") ?: ""
        set(v) = sp.edit().putString("server_url", v.trim()).apply()

    /** 临时工具：EPC 采集服务（电脑端）地址，如 http://192.168.1.10:8790 */
    var epcServerUrl: String
        get() = sp.getString("epc_server_url", "") ?: ""
        set(v) = sp.edit().putString("epc_server_url", v.trim()).apply()

    var pullInterval: Int
        get() = sp.getInt("pull_interval", 15)
        set(v) = sp.edit().putInt("pull_interval", v).apply()

    var power: Int
        get() = sp.getInt("power", 30)
        set(v) = sp.edit().putInt("power", v).apply()

    /** 销售出单识别 EPC 用小功率（默认 10dBm，约几十厘米），防止串扫邻柜商品。 */
    var salePower: Int
        get() = sp.getInt("sale_power", 10)
        set(v) = sp.edit().putInt("sale_power", v).apply()

    /** 一次性把老版本（默认20dBm，读取距离仅20cm）提升到最大功率30dBm；用户之后可自行调小。 */
    fun migratePowerIfNeeded() {
        if (sp.getBoolean("power_mig_v2", false)) return
        sp.edit().putInt("power", 30).putBoolean("power_mig_v2", true).apply()
    }

    /** 扳机适配模式：0=自动(全通道) 1=android.rfid.FUN_KEY 2=intent.FUN_KEY
     *  3=扫描服务广播 4=扫码结果广播 5=物理按键 6=仅屏幕按钮 */
    var triggerMode: Int
        get() = sp.getInt("trigger_mode", 0)
        set(v) = sp.edit().putInt("trigger_mode", v).apply()

    var region: Int
        get() = sp.getInt("region", 0)
        set(v) = sp.edit().putInt("region", v).apply()

    var session: Int
        get() = sp.getInt("session", 0)
        set(v) = sp.edit().putInt("session", v).apply()

    var qValue: Int
        get() = sp.getInt("qvalue", 0)
        set(v) = sp.edit().putInt("qvalue", v).apply()

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

    // —— 蓝牙标签打印机（手机直打）——
    var btPrinterAddr: String
        get() = sp.getString("bt_printer_addr", "") ?: ""
        set(v) = sp.edit().putString("bt_printer_addr", v.trim()).apply()

    var btPrinterName: String
        get() = sp.getString("bt_printer_name", "") ?: ""
        set(v) = sp.edit().putString("bt_printer_name", v.trim()).apply()

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

    // —— 登录态（扫码登录，当天有效；服务端校验 valid_day）——
    var authToken: String
        get() = sp.getString("auth_token", "") ?: ""
        set(v) = sp.edit().putString("auth_token", v).apply()

    var authOrigin: String
        get() = sp.getString("auth_origin", "") ?: ""
        set(v) = sp.edit().putString("auth_origin", v.trim()).apply()

    /** 登录用户 JSON：{"username":..,"display_name":..,"role":..} */
    var authUserJson: String
        get() = sp.getString("auth_user", "{}") ?: "{}"
        set(v) = sp.edit().putString("auth_user", v).apply()

    fun clearAuth() {
        sp.edit().remove("auth_token").remove("auth_origin").remove("auth_user").apply()
    }

    fun resetAll() {
        val dk = deviceKey
        sp.edit().clear().apply()
        sp.edit().putString("device_key", dk).apply()
    }
}
