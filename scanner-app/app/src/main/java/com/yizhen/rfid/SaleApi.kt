package com.yizhen.rfid

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 销售出单接口客户端（Bearer token 鉴权）。
 * 与盘点 ApiClient（任务密钥鉴权）相互独立。
 */
class SaleApi(private val prefs: Prefs) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun authed(url: String): Request.Builder =
        Request.Builder().url(url).header("Authorization", "Bearer ${prefs.authToken}")

    /** 在库商品列表（用于扫码匹配编码/EPC）。 */
    fun options(): JSONArray {
        val url = "${prefs.authOrigin}/api/products/options?status=" +
                enc("在库")
        val req = authed(url).get().build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
            return JSONObject(text).optJSONArray("items") ?: JSONArray()
        }
    }

    /** 提交出单，返回 {id, bill_no}。 */
    fun create(body: JSONObject): JSONObject {
        val req = authed("${prefs.authOrigin}/api/sales")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                val detail = try {
                    JSONObject(text).optString("detail")
                } catch (_: Exception) { "" }
                throw RuntimeException(detail.ifBlank { "HTTP ${resp.code}" })
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    /** 商品图片（公开接口，无需鉴权）。 */
    fun image(pid: Int): Bitmap? = try {
        val req = Request.Builder().url("${prefs.authOrigin}/api/products/$pid/image").get().build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return null
            val bytes = resp.body?.bytes() ?: return null
            val opt = BitmapFactory.Options().apply { inSampleSize = 2 }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opt)
        }
    } catch (_: Exception) {
        null
    }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")
}
