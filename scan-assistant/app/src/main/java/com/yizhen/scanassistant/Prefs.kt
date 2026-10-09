package com.yizhen.scanassistant

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** 一条待上传/已采集标签。source: rfid | camera | manual。 */
data class QueueItem(
    val epc: String,
    val rssi: Int,
    val source: String,
    val ts: Long
) {
    fun toJson(): JSONObject = JSONObject()
        .put("epc", epc)
        .put("rssi", rssi)
        .put("source", source)
        .put("ts", ts)

    companion object {
        fun fromJson(o: JSONObject): QueueItem = QueueItem(
            epc = o.optString("epc"),
            rssi = o.optInt("rssi", 0),
            source = o.optString("source", "rfid").ifBlank { "rfid" },
            ts = o.optLong("ts", 0L)
        )
    }
}

/**
 * 当前任务小数据类（claim/current 响应中的 task 对象）。
 * status 为服务端原样状态串（"进行中"/"已完成" 等中文状态）。
 */
data class TaskInfo(
    val id: Int,
    val taskNo: String,
    val type: String,
    val typeSeq: Int,
    val title: String,
    val status: String,
    val deviceNo: Int,
    val submitted: Boolean
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("task_no", taskNo)
        .put("type", type)
        .put("type_seq", typeSeq)
        .put("title", title)
        .put("status", status)
        .put("device_no", deviceNo)
        .put("submitted", submitted)

    companion object {
        fun fromJson(o: JSONObject): TaskInfo = TaskInfo(
            id = o.optInt("id", 0),
            taskNo = o.optString("task_no", ""),
            type = o.optString("type", ""),
            typeSeq = o.optInt("type_seq", 0),
            title = o.optString("title", ""),
            status = o.optString("status", ""),
            deviceNo = o.optInt("device_no", 0),
            submitted = o.optBoolean("submitted", false)
        )
    }
}

/**
 * 全局设置与任务态本地存储（SharedPreferences 名 "scan_helper"）。
 * 严格盲采：本地只保存「任务信息 + 待传队列」，绝不保存库存明细/商品清单。
 */
class Prefs(context: Context) {
    private val sp = context.applicationContext
        .getSharedPreferences("scan_helper", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString(KEY_SERVER_URL, "") ?: ""
        set(v) = sp.edit().putString(KEY_SERVER_URL, v.trim().trimEnd('/')).apply()

    var deviceToken: String
        get() = sp.getString(KEY_TOKEN, "") ?: ""
        set(v) = sp.edit().putString(KEY_TOKEN, v).apply()

    /** 本机设备码：安装即生成，形如 SH-XXXXXX；解绑/重激活均保留。 */
    var deviceCode: String
        get() {
            var c = sp.getString(KEY_DEVICE_CODE, "")
            if (c.isNullOrEmpty()) {
                c = "SH-" + java.util.UUID.randomUUID().toString()
                    .replace("-", "").take(6).uppercase()
                sp.edit().putString(KEY_DEVICE_CODE, c).apply()
            }
            return c
        }
        set(v) = sp.edit().putString(KEY_DEVICE_CODE, v).apply()

    var deviceName: String
        get() = sp.getString(KEY_DEVICE_NAME, "") ?: ""
        set(v) = sp.edit().putString(KEY_DEVICE_NAME, v).apply()

    var storeId: Int
        get() = sp.getInt(KEY_STORE_ID, 0)
        set(v) = sp.edit().putInt(KEY_STORE_ID, v).apply()

    var storeName: String
        get() = sp.getString(KEY_STORE_NAME, "") ?: ""
        set(v) = sp.edit().putString(KEY_STORE_NAME, v).apply()

    /** 当前任务 JSON；空闲为 ""。 */
    var currentTaskJson: String
        get() = sp.getString(KEY_TASK_JSON, "") ?: ""
        set(v) = sp.edit().putString(KEY_TASK_JSON, v).apply()

    var currentTask: TaskInfo?
        get() = currentTaskJson.takeIf { it.isNotBlank() }?.let {
            try { TaskInfo.fromJson(JSONObject(it)) } catch (_: Exception) { null }
        }
        set(v) {
            currentTaskJson = v?.toJson()?.toString() ?: ""
        }

    /** 持久待传标签数组 JSON（默认 "[]"）。 */
    var queueJson: String
        get() = sp.getString(KEY_QUEUE, "[]") ?: "[]"
        set(v) = sp.edit().putString(KEY_QUEUE, v).apply()

    var queue: List<QueueItem>
        get() {
            val raw = queueJson
            if (raw.isBlank()) return emptyList()
            return try {
                val arr = JSONArray(raw)
                (0 until arr.length()).map { QueueItem.fromJson(arr.getJSONObject(it)) }
            } catch (_: Exception) {
                emptyList()
            }
        }
        set(v) {
            val arr = JSONArray()
            v.forEach { arr.put(it.toJson()) }
            queueJson = arr.toString()
        }

    /** UHF 功率（dBm），透传给 RfidManager.setPower。 */
    var power: Int
        get() = sp.getInt(KEY_POWER, 30)
        set(v) = sp.edit().putInt(KEY_POWER, v).apply()

    /** 机身扳机通道模式（取值见 TriggerChannels.MODE_*）。 */
    var triggerMode: Int
        get() = sp.getInt(KEY_TRIGGER_MODE, TriggerChannels.MODE_AUTO)
        set(v) = sp.edit().putInt(KEY_TRIGGER_MODE, v).apply()

    /** 服务端已确认接收的「我的」扫描数量（重启恢复时展示用）。 */
    var serverMine: Int
        get() = sp.getInt(KEY_SERVER_MINE, 0)
        set(v) = sp.edit().putInt(KEY_SERVER_MINE, v).apply()

    /** 服务端最近回执的统计 JSON（stats），重启恢复时展示用。 */
    var serverStatsJson: String
        get() = sp.getString(KEY_SERVER_STATS, "") ?: ""
        set(v) = sp.edit().putString(KEY_SERVER_STATS, v).apply()

    /** 清除当前任务相关运行态（任务 JSON、待传队列、服务端计数），不触碰激活凭证。 */
    fun clearTaskState() {
        sp.edit()
            .remove(KEY_TASK_JSON)
            .remove(KEY_QUEUE)
            .remove(KEY_SERVER_MINE)
            .remove(KEY_SERVER_STATS)
            .apply()
    }

    /**
     * 清除激活凭证（重新激活/解绑）：清 token、门店绑定、当前任务；
     * 保留本机设备码、服务器地址、设备名与功率/扳机等硬件设置。
     * 待传队列依赖具体任务，由调用方决定是否一并清空。
     */
    fun clearAuth() {
        sp.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_STORE_ID)
            .remove(KEY_STORE_NAME)
            .remove(KEY_TASK_JSON)
            .remove(KEY_SERVER_MINE)
            .remove(KEY_SERVER_STATS)
            .apply()
    }

    private companion object {
        const val KEY_SERVER_URL = "server_url"
        const val KEY_TOKEN = "device_token"
        const val KEY_DEVICE_CODE = "device_code"
        const val KEY_DEVICE_NAME = "device_name"
        const val KEY_STORE_ID = "store_id"
        const val KEY_STORE_NAME = "store_name"
        const val KEY_TASK_JSON = "current_task_json"
        const val KEY_QUEUE = "queue_json"
        const val KEY_POWER = "power"
        const val KEY_TRIGGER_MODE = "trigger_mode"
        const val KEY_SERVER_MINE = "server_mine"
        const val KEY_SERVER_STATS = "server_stats_json"
    }
}
