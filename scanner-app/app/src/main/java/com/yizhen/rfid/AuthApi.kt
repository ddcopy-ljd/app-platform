package com.yizhen.rfid

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 手持机扫码登录接口客户端。
 *
 * 流程：
 * 1. 网页端（已登录）生成【手持机登录】二维码，内容形如
 *    http://host:port/api/handheld/auth?hkey=xxxx
 * 2. App 扫码解析出 origin + hkey → POST /api/handheld/auth 上报设备信息
 * 3. 网页端显示设备名并由店员确认 → POST /api/handheld/confirm
 * 4. App 轮询 GET /api/handheld/poll?hkey= 拿到 token（当天有效）
 * 5. 后续所有请求带 Authorization: Bearer token；隔日服务端返回 401，App 引导重新扫码。
 */
object AuthApi {

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    /** 从登录二维码解析出 {origin, hkey}；仅接受 /api/handheld/auth 地址。 */
    fun parseLoginQr(raw: String): Pair<String, String>? {
        val s = raw.trim()
        if (!s.contains("/api/handheld/auth", ignoreCase = true)) return null
        val key = Regex("[?&]hkey=([^&]+)").find(s)?.groupValues?.get(1) ?: return null
        val origin = Regex("^(https?://[^/]+)").find(s)?.groupValues?.get(1) ?: return null
        return origin to key
    }

    private fun request(url: String, method: String, body: JSONObject?): JSONObject {
        val b = Request.Builder().url(url)
        when (method) {
            "POST" -> b.post((body ?: JSONObject()).toString().toRequestBody(jsonType))
            else -> b.get()
        }
        client.newCall(b.build()).execute().use { resp ->
            val text = resp.body?.string() ?: ""
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}: $text")
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    /** 已保存的会话是否仍有效（当天有效校验在服务端 /api/auth/me）。 */
    fun checkSession(origin: String, token: String): JSONObject? {
        if (origin.isBlank() || token.isBlank()) return null
        return try {
            val req = Request.Builder().url("$origin/api/auth/me")
                .header("Authorization", "Bearer $token").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) null
                else JSONObject(resp.body?.string() ?: "{}")
            }
        } catch (_: Exception) {
            null
        }
    }

    /** 扫码后上报设备信息，等待网页端确认。 */
    fun reportDevice(origin: String, hkey: String, deviceKey: String, name: String) {
        val body = JSONObject().put("hkey", hkey).put("device", deviceKey).put("name", name)
        request("$origin/api/handheld/auth", "POST", body)
    }

    /** 轮询登录结果；confirmed 时返回含 token/user 的 JSON，否则返回状态。 */
    fun poll(origin: String, hkey: String): JSONObject {
        return request("$origin/api/handheld/poll?hkey=$hkey", "GET", null)
    }

    /** 退出登录（服务端撤销会话；失败不阻塞本地清理）。 */
    fun logout(origin: String, token: String) {
        try {
            val req = Request.Builder().url("$origin/api/auth/logout")
                .header("Authorization", "Bearer $token")
                .post("{}".toRequestBody(jsonType)).build()
            client.newCall(req).execute().close()
        } catch (_: Exception) {
        }
    }
}
