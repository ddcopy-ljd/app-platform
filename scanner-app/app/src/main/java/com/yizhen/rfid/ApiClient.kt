package com.yizhen.rfid

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 协同盘点接口客户端。
 * 保存的服务端地址为 join 完整地址：
 * http://host/api/stocktake/co/join?key=xxxx
 */
class ApiClient(private val prefs: Prefs) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private data class Endpoint(val origin: String, val key: String)

    private fun parse(): Endpoint? {
        val url = prefs.serverUrl
        val keyMatch = Regex("[?&]key=([^&]+)").find(url) ?: return null
        val key = keyMatch.groupValues[1]
        val origin = Regex("^(https?://[^/]+)").find(url)?.groupValues?.get(1) ?: return null
        return Endpoint(origin, key)
    }

    val isConfigured: Boolean get() = parse() != null

    private fun u(path: String, ep: Endpoint) =
        "${ep.origin}$path?key=${ep.key}&device=${enc(prefs.deviceKey)}"

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

    private fun post(url: String, body: JSONObject): JSONObject {
        val req = Request.Builder().url(url)
            .post(body.toString().toRequestBody(jsonType)).build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}: $text")
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun get(url: String): JSONObject {
        val req = Request.Builder().url(url).get().build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}: $text")
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    /** 加入任务 / 心跳。返回 {active,status,task_no,device_no,finished} */
    fun join(): JSONObject {
        val ep = parse() ?: throw IllegalStateException("URL 未配置")
        val body = JSONObject().put("device", prefs.deviceKey).put("name", prefs.deviceName)
        return post(ep.origin + "/api/stocktake/co/join?key=" + ep.key, body)
    }

    /** 下载全店快照。 */
    fun snapshot(): JSONObject {
        val ep = parse() ?: throw IllegalStateException("URL 未配置")
        return get(u("/api/stocktake/co/snapshot", ep))
    }

    /**
     * 实时上报一批标签。
     * @return {accepted:[...], device_no, global_count}
     */
    fun scan(tags: List<Pair<String, Int>>): JSONObject {
        val ep = parse() ?: throw IllegalStateException("URL 未配置")
        val arr = JSONArray()
        tags.forEach { (epc, rssi) ->
            arr.put(JSONObject().put("epc", epc).put("rssi", rssi))
        }
        val body = JSONObject()
            .put("device", prefs.deviceKey)
            .put("name", prefs.deviceName)
            .put("tags", arr)
        return post(u("/api/stocktake/co/scan", ep), body)
    }

    /** 增量拉取其他设备扫描。 */
    fun pull(sinceId: Int): JSONObject {
        val ep = parse() ?: throw IllegalStateException("URL 未配置")
        return get(u("/api/stocktake/co/pull", ep) + "&since_id=$sinceId")
    }

    /** 本机结束提交。 */
    fun finish(): JSONObject {
        val ep = parse() ?: throw IllegalStateException("URL 未配置")
        val body = JSONObject().put("device", prefs.deviceKey).put("name", prefs.deviceName)
        return post(u("/api/stocktake/co/finish", ep), body)
    }

    /** 轮询任务状态。 */
    fun task(): JSONObject {
        val ep = parse() ?: throw IllegalStateException("URL 未配置")
        return get(u("/api/stocktake/co/task", ep))
    }
}
