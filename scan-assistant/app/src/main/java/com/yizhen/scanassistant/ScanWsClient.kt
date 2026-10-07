package com.yizhen.scanassistant

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 扫描助手设备端 WebSocket 常驻连接（/ws/scan-device）。
 *
 * 架构定稿：启动即连、无轮询；连接建立后：
 * - 自动发送 hello（携带 app_version），并每 [HEARTBEAT_MS] 发送 heartbeat（服务端免应答）；
 * - 断线指数退避自动重连（1s 起，封顶 30s）；
 * - 服务端以 4401 关闭表示凭证失效（被解绑/停用/token 无效），不重连，交 UI 回激活页；
 * - OkHttp 回调在其调度线程，本类统一切回主线程后再回调 [Listener]，UI 无需自行切线程。
 *
 * 协议（轻量 JSON，单帧一条消息）：
 * 上行：hello / heartbeat / list / claim / scan / submit
 * 下行：ack / task_list / task_offer / task_closed
 */
class ScanWsClient(
    private val baseUrl: String,
    private val token: String,
    private val appVersion: String,
    private val listener: Listener
) {

    interface Listener {
        /** 连接已建立（主线程）：hello 已自动发送，调用方可随后拉取任务列表/补传离线队列。 */
        fun onWsOpen()

        /** 连接断开（主线程）。authInvalid=true 表示凭证失效，不再重连。 */
        fun onWsClosed(authInvalid: Boolean)

        /** 收到一帧业务消息（主线程）。 */
        fun onWsMessage(msg: JSONObject)
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // WS 常驻，读不超时
        .pingInterval(20, TimeUnit.SECONDS)   // 协议层保活，NAT/复杂网络保链路
        .retryOnConnectionFailure(true)
        .build()

    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var ws: WebSocket? = null

    /** 用户主动关闭/凭证失效：不再重连。 */
    @Volatile
    private var shutdown = false

    @Volatile
    var connected = false
        private set

    private var retries = 0

    private val heartbeatTick = object : Runnable {
        override fun run() {
            if (connected) {
                send(JSONObject().put("type", "heartbeat"))
                main.postDelayed(this, HEARTBEAT_MS)
            }
        }
    }

    fun connect() {
        shutdown = false
        if (connected || ws != null) return
        runConnect()
    }

    private fun runConnect() {
        val url = buildUrl() ?: run {
            // 地址非法：无法重连，直接按失败处理（UI 提示去设置页修改地址）
            main.post { listener.onWsClosed(false) }
            scheduleReconnect()
            return
        }
        val req = Request.Builder().url(url).build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.post {
                    connected = true
                    retries = 0
                    send(JSONObject().put("type", "hello").put("app_version", appVersion))
                    main.removeCallbacks(heartbeatTick)
                    main.postDelayed(heartbeatTick, HEARTBEAT_MS)
                    listener.onWsOpen()
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = try {
                    JSONObject(text)
                } catch (_: Exception) {
                    return
                }
                main.post {
                    if (!shutdown) listener.onWsMessage(msg)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                // 服务端发起关闭：先回 close 帧，再走 onClosed
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                handleDrop(code)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                handleDrop(response?.code ?: 0)
            }
        })
    }

    private fun handleDrop(code: Int) {
        main.post {
            val wasOpen = connected
            connected = false
            ws = null
            main.removeCallbacks(heartbeatTick)
            val authInvalid = code == CLOSE_AUTH_INVALID
            if (!shutdown) listener.onWsClosed(authInvalid)
            if (!shutdown && !authInvalid) {
                if (wasOpen) retries = 0
                scheduleReconnect()
            }
        }
    }

    private fun scheduleReconnect() {
        if (shutdown) return
        retries += 1
        val delay = minOf(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (1L shl minOf(retries - 1, 5)))
        main.postDelayed({ if (!shutdown && !connected) runConnect() }, delay)
    }

    /** 发送一帧；未连接返回 false（调用方保留数据待重连补传）。 */
    fun send(msg: JSONObject): Boolean {
        val s = ws ?: return false
        return try {
            s.send(msg.toString())
        } catch (_: Exception) {
            false
        }
    }

    /** 主动关闭（解绑/退出）：不重连。 */
    fun close() {
        shutdown = true
        connected = false
        main.removeCallbacksAndMessages(null)
        try {
            ws?.close(1000, "client_close")
        } catch (_: Exception) {
        }
        ws = null
    }

    private fun buildUrl(): String? {
        val raw = baseUrl.trim().trimEnd('/')
        if (raw.isEmpty()) return null
        val withScheme = if (raw.startsWith("http://", true) || raw.startsWith("https://", true))
            raw else "http://$raw"
        return try {
            val http = withScheme.toHttpUrlOrNull() ?: return null
            val sb = StringBuilder()
                .append(if (http.scheme == "https") "wss://" else "ws://")
                .append(http.host)
            val defaultPort = if (http.scheme == "https") 443 else 80
            if (http.port != defaultPort) sb.append(':').append(http.port)
            sb.append("/ws/scan-device?token=")
                .append(java.net.URLEncoder.encode(token, "UTF-8"))
            sb.toString()
        } catch (_: Exception) {
            null
        }
    }

    private companion object {
        const val HEARTBEAT_MS = 5_000L
        const val BASE_BACKOFF_MS = 1_000L
        const val MAX_BACKOFF_MS = 30_000L
        const val CLOSE_AUTH_INVALID = 4401
    }
}
