package com.yizhen.rfid

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
import android.widget.EditText
import androidx.core.content.ContextCompat

/**
 * C72（RSCJA 键盘助手固件）实体键定义：
 *  - 293 手柄扳机按下、280 手柄扳机抬起（部分固件抬起仍发 293 的 ACTION_UP）
 *  - 139 侧边 SCAN 键：低功率单件扫描（出单/单件识别），同时是键盘助手条码注入的终止键
 *  - 142 F12：切换 RFID / 摄像头扫码方式
 *
 * 事件可能从三条通道到达，全部汇入同一套回调：
 *  A. 物理 KeyEvent（dispatchKeyEvent）
 *  B. 系统广播 android.rfid.FUN_KEY（带 keyCode/keydown extras，扳机常被扫描服务吞而只剩广播）
 *  C. 2D 扫码头结果广播 / 键盘助手按键注入（条码字符串）
 */
object HardwareKeys {
    const val SCAN = 139
    const val MODE = 142
    const val GUN_DOWN = 293
    const val GUN_UP = 280

    /**
     * C72_6763 实机实测：扳机是 gpiokeys 上的 KEY_F16（Linux 键码 196），
     * 系统 Generic.kl 没有映射它 → dispatchKeyEvent 收到 keyCode=0(UNKNOWN)、scanCode=196。
     * 识别扳机以 scanCode 为准，keyCode 293/280 仅兼容其它固件。
     */
    const val GUN_SCANCODE = 196

    /** F1-F12 中除 139/142 外的键、手柄数字小键盘、对焦段（去掉 280 本身避免重复）。 */
    val GUN_FALLBACK_CODES =
        ((131..143).filter { it != SCAN && it != MODE } + (96..110) + (281..300)).toIntArray()

    /** 扫码头结果广播里条码字符串可能使用的 extra 名（各厂商不一致）。 */
    private val BARCODE_EXTRAS = arrayOf(
        "scannerdata", "SCANNER_DATA", "barcode", "BARCODE", "SCAN_BARCODE1",
        "SCAN_BARCODE", "decode_data", "data_string", "scan_result",
        "barcode_string", "data", "value", "code"
    )

    /** 从扫码头结果广播取条码文本；非结果广播返回 null。 */
    fun extractBarcode(intent: Intent): String? {
        val ex = intent.extras ?: return null
        for (k in BARCODE_EXTRAS) {
            val v = ex.get(k) as? String
            if (!v.isNullOrBlank()) return v.trim()
        }
        return null
    }

    /** 解析功能键广播：返回 (keyCode, down)。无 keyCode extra 时按惯例视为扳机按下。 */
    fun parseFunKey(intent: Intent): Pair<Int, Boolean>? {
        val ex = intent.extras
        val code = when (val v = ex?.get("keyCode")) {
            is Int -> v
            is String -> v.trim().toIntOrNull()
            else -> null
        } ?: GUN_DOWN
        val down = when (val v = ex?.get("keydown")) {
            is Boolean -> v
            is String -> v.equals("true", ignoreCase = true) || v == "1"
            is Int -> v != 0
            null -> true
            else -> intent.getBooleanExtra("keydown", true)
        }
        return code to down
    }
}

/**
 * 三个扫描页面共用的实体键路由器：去重双通道重复事件、区分扳机/扫描/模式键，
 * 并把 2D 头的条码（广播或键盘助手字符注入）交给页面。
 */
class KeyRouter(
    private val act: Activity,
    private val screenOnly: Boolean,
    private val cb: Callbacks
) {
    interface Callbacks {
        /** 手柄扳机：true=按下 false=松开。 */
        fun onGun(down: Boolean)
        /** 侧边 SCAN(139) 单击。 */
        fun onScanKey()
        /** F12(142) 切换扫码方式。 */
        fun onModeKey()
        /** 2D 扫码头读到条码（结果广播或键盘助手注入）。 */
        fun onBarcode(text: String)
        /** 其它 F 键/手柄设备兜底键是否也当扳机（盘点页 true，出单页 false）。 */
        fun fallbackAsGun(): Boolean = true
    }

    private var gunHeld = false
    private var lastModeAt = 0L
    private var lastScanAt = 0L
    private var lastBarcode = ""
    private var lastBarcodeAt = 0L

    // 键盘助手把条码作为按键字符注入、139 收尾：无输入框聚焦时在此缓存
    private val wedge = StringBuilder()

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent ?: return
            HardwareKeys.extractBarcode(intent)?.let { deliverBarcode(it); return }
            // 带 keyCode extra 的功能键广播（RSCJA 扫描服务/FUN_KEY）按键码路由；
            // 无 keyCode：FUN_KEY 类按惯例视为扳机按下；扫码结果类广播一律忽略，避免误扣扳机。
            val hasKeyCode = intent.extras?.get("keyCode") != null
            if (!hasKeyCode) {
                val a = intent.action
                if (a != "android.rfid.FUN_KEY" && a != "android.intent.action.FUN_KEY") return
            }
            val (code, down) = HardwareKeys.parseFunKey(intent) ?: return
            route(code, down)
        }
    }

    fun register() {
        if (screenOnly) return
        val filter = IntentFilter()
        TriggerChannels.ALL_ACTIONS.forEach { filter.addAction(it) }
        try {
            ContextCompat.registerReceiver(act, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        } catch (_: Exception) {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            act.registerReceiver(receiver, filter)
        }
    }

    fun unregister() {
        try { act.unregisterReceiver(receiver) } catch (_: Exception) {}
    }

    /** 页面在 dispatchKeyEvent 中调用；返回 true 表示已消费。 */
    fun dispatch(event: KeyEvent): Boolean {
        if (screenOnly) return false

        // C72 扳机：keyCode 未映射(0)，靠 scanCode=196 识别，DOWN/UP 成对到达
        if (event.scanCode == HardwareKeys.GUN_SCANCODE) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) route(HardwareKeys.GUN_DOWN, true)
                KeyEvent.ACTION_UP -> route(HardwareKeys.GUN_DOWN, false)
            }
            return true
        }

        val code = event.keyCode
        val down = event.action == KeyEvent.ACTION_DOWN
        val up = event.action == KeyEvent.ACTION_UP

        // 键盘助手条码字符注入（焦点不在输入框时缓存，139 到达时整段交付）
        collectWedge(event)

        when (code) {
            HardwareKeys.GUN_DOWN -> {
                if (down && event.repeatCount == 0) route(code, true)
                else if (up) route(code, false)
                return true
            }
            HardwareKeys.GUN_UP -> {
                if (up) route(HardwareKeys.GUN_DOWN, false)
                return true
            }
            HardwareKeys.SCAN -> {
                if (down && event.repeatCount == 0) {
                    // 先看 wedge 是否已经带了条码（字符注入先于终止键）
                    if (wedge.isNotEmpty()) deliverBarcode(wedge.toString())
                    else scanKey()
                }
                return true
            }
            HardwareKeys.MODE -> {
                if (down && event.repeatCount == 0) modeKey()
                return true
            }
        }

        val isFallbackGun = cb.fallbackAsGun() && (
            code in HardwareKeys.GUN_FALLBACK_CODES ||
            (event.source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
            (event.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
            ((event.source and InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD &&
                code == KeyEvent.KEYCODE_DPAD_CENTER)
        )
        // 兜底 F 键在输入框聚焦时放行（66=回车在 EditText 内不拦截）
        if (isFallbackGun && !(code == KeyEvent.KEYCODE_ENTER && act.currentFocus is EditText)) {
            if (down && event.repeatCount == 0) route(HardwareKeys.GUN_DOWN, true)
            else if (up) route(HardwareKeys.GUN_DOWN, false)
            return true
        }
        return false
    }

    private fun collectWedge(event: KeyEvent) {
        if (act.currentFocus is EditText) { wedge.setLength(0); return }
        when {
            event.action == KeyEvent.ACTION_MULTIPLE && !event.characters.isNullOrEmpty() ->
                wedge.append(event.characters)
            event.action == KeyEvent.ACTION_DOWN -> {
                val ch = event.unicodeChar
                if (ch != 0) wedge.append(ch.toChar())
            }
        }
    }

    private fun route(code: Int, down: Boolean) {
        when (code) {
            HardwareKeys.GUN_DOWN -> gun(down)
            HardwareKeys.SCAN -> if (down) scanKey()
            HardwareKeys.MODE -> if (down) modeKey()
            else -> if (cb.fallbackAsGun()) gun(down)
        }
    }

    private fun gun(down: Boolean) {
        if (down) {
            if (gunHeld) return
            gunHeld = true
            cb.onGun(true)
        } else {
            if (!gunHeld) return
            gunHeld = false
            cb.onGun(false)
        }
    }

    private fun scanKey() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastScanAt < 400) return
        lastScanAt = now
        cb.onScanKey()
    }

    private fun modeKey() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastModeAt < 400) return
        lastModeAt = now
        cb.onModeKey()
    }

    private fun deliverBarcode(text: String) {
        wedge.setLength(0)
        val code = text.trim()
        if (code.isEmpty()) return
        val now = SystemClock.elapsedRealtime()
        // 广播与字符注入可能同时送达同一码：800ms 内去重
        if (code == lastBarcode && now - lastBarcodeAt < 800) return
        lastBarcode = code
        lastBarcodeAt = now
        cb.onBarcode(code)
    }
}
