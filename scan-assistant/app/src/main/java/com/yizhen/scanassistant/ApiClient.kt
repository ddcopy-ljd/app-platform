package com.yizhen.scanassistant

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.HttpURLConnection
import java.util.concurrent.TimeUnit

/**
 * 设备端激活 API（一次性 HTTP 调用）。
 *
 * 激活成功后 device_token 即唯一凭证，后续所有业务（任务推送、扫描上报、提交完结）
 * 均通过 [ScanWsClient] 的 WebSocket 常驻连接完成，不再使用 HTTP 轮询。
 *
 * - baseUrl 为服务器 origin（如 http://192.168.1.10:8002），自动去末尾斜杠/补协议头；
 * - 请求/响应均为 JSON；activate 无 token；
 * - 非 2xx 响应体为 {"detail":"中文消息"}，原样解析为 [ApiException.detail] 供弹窗；
 * - 网络层异常统一包装为 code=0 的 [ApiException]。
 */
object ApiClient {

    /** 设备端业务异常：[code] 为 HTTP 状态码（0 表示本地网络异常），[detail] 为可直接展示的中文消息。 */
    class ApiException(val code: Int, val detail: String) : Exception(detail) {
        /** 401/403：凭证失效（被解绑/停用/token 无效），应清凭证回激活页。 */
        val authInvalid: Boolean get() = code == HttpURLConnection.HTTP_UNAUTHORIZED ||
                code == HttpURLConnection.HTTP_FORBIDDEN
    }

    enum class QrKind { ACTIVATE, CLAIM, UNKNOWN }

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    // ------------------------------------------------------ 端点

    /** POST /api/device/activate（无 token）。响应 {device_token, code, name, store, server_time}。 */
    fun activate(baseUrl: String, akey: String, code: String, name: String, appVersion: String): JSONObject {
        val body = JSONObject()
            .put("akey", akey)
            .put("code", code)
            .put("name", name)
            .put("app_version", appVersion)
        return call(normalizeBase(baseUrl) + PATH_ACTIVATE, body = body)
    }

    // ------------------------------------------------------ URL 工具

    /** 规范化服务器地址：补 http(s) 协议头、去末尾斜杠。 */
    fun normalizeBase(raw: String?): String {
        var s = (raw ?: "").trim()
        if (s.isEmpty()) return ""
        if (!s.startsWith("http://", ignoreCase = true) &&
            !s.startsWith("https://", ignoreCase = true)
        ) {
            s = "http://$s"
        }
        return s.trimEnd('/')
    }

    /**
     * 从输入中提取服务器 origin（协议+主机+端口）。
     * 输入既可能是手填的 `192.168.1.10:8002`，也可能是扫码后整串贴入的
     * `http://192.168.1.10:8002/api/device/activate?key=xxx`——后者必须剥掉路径，
     * 否则拼激活端点会变成 .../activate/api/device/activate 导致 404。
     */
    fun serverOrigin(raw: String?): String {
        val s = (raw ?: "").trim()
        if (s.isEmpty()) return ""
        Regex("^(https?://[^/]+)", RegexOption.IGNORE_CASE).find(s)
            ?.let { return it.groupValues[1].trimEnd('/') }
        return normalizeBase(s)
    }

    /** 识别二维码种类（激活码 / 任务码 / 未知）。 */
    fun qrKind(raw: String?): QrKind {
        val s = (raw ?: "").trim()
        return when {
            s.contains(PATH_ACTIVATE, ignoreCase = true) -> QrKind.ACTIVATE
            s.contains(PATH_CLAIM, ignoreCase = true) -> QrKind.CLAIM
            else -> QrKind.UNKNOWN
        }
    }

    /**
     * 从二维码 URL 解析 (origin, key)：
     * origin = 协议+主机(+端口)，key 为 query 参数；解析失败返回 null。
     */
    fun parseQr(raw: String?): Pair<String, String>? {
        val s = (raw ?: "").trim()
        val origin = Regex("^(https?://[^/]+)", RegexOption.IGNORE_CASE).find(s)?.groupValues?.get(1)
            ?: return null
        val key = queryParam(s, "key")?.takeIf { it.isNotEmpty() } ?: return null
        // 去掉 origin 末尾可能带的端口后多余斜杠（正则已排除路径），原样保留主机大小写
        return Pair(origin.trimEnd('/'), key)
    }

    /** 读取 URL query 参数并 URL 解码（支持 ?key= 与片段前任意位置）。 */
    fun queryParam(url: String, name: String): String? {
        val q = url.substringAfter('?', "").substringBefore('#')
        if (q.isEmpty()) return null
        q.split('&').forEach { pair ->
            val eq = pair.indexOf('=')
            val k = if (eq >= 0) pair.substring(0, eq) else pair
            if (k == name) {
                val v = if (eq >= 0) pair.substring(eq + 1) else ""
                return try {
                    java.net.URLDecoder.decode(v, "UTF-8")
                } catch (_: Exception) {
                    v
                }
            }
        }
        return null
    }

    // ------------------------------------------------------ 内部

    private const val PATH_ACTIVATE = "/api/device/activate"
    private const val PATH_CLAIM = "/api/device/claim"

    private fun call(url: String, body: JSONObject? = null): JSONObject {
        try {
            val builder = Request.Builder().url(url)
            val content = (body ?: JSONObject()).toString()
            builder.post(content.toRequestBody(jsonType))
            client.newCall(builder.build()).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    val detail = parseDetail(text).ifBlank { "HTTP ${resp.code}" }
                    throw ApiException(resp.code, detail)
                }
                return if (text.isBlank()) JSONObject() else JSONObject(text)
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException(0, e.message ?: "网络请求失败")
        }
    }

    /** 解析 FastJSON 式错误体 {"detail":"中文消息"}。 */
    private fun parseDetail(text: String): String = try {
        if (text.isBlank()) "" else JSONObject(text).optString("detail", "")
    } catch (_: Exception) {
        text.take(200)
    }
}
