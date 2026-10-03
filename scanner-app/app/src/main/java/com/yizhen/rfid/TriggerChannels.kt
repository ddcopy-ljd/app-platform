package com.yizhen.rfid

/**
 * 手持机机身扳机的触发通道适配。
 *
 * 不同厂商/固件的扳机事件上报方式不一致，App 设置页提供模式让用户逐个实测：
 * 诊断行会显示最近一次收到事件的通道，选对后固定该模式即可。
 *
 * 模式：
 *  0 自动（全部通道同时监听）
 *  1 android.rfid.FUN_KEY            —— Chainway / RSCJA 方案 C27 常见
 *  2 android.intent.action.FUN_KEY   —— 部分固件把功能键发到标准 action
 *  3 扫描服务广播                    —— 新大陆等系统扫描服务转发扳机
 *  4 扫码结果广播                    —— 扳机被映射为"发起扫码"时的结果广播
 *  5 物理按键 KeyEvent（F 键 / 手柄键 / 对焦键）
 *  6 仅屏幕按钮（关闭全部硬件通道）
 */
object TriggerChannels {

    const val MODE_AUTO = 0
    const val MODE_RFID_FUN_KEY = 1
    const val MODE_INTENT_FUN_KEY = 2
    const val MODE_SCANNER_SERVICE = 3
    const val MODE_SCAN_RESULT = 4
    const val MODE_KEY_EVENT = 5
    const val MODE_SCREEN_ONLY = 6

    /** 全部候选广播 action（自动模式全部注册）。 */
    val ALL_ACTIONS = arrayOf(
        "android.rfid.FUN_KEY",
        "android.intent.action.FUN_KEY",
        "com.android.server.scannerservice.broadcast",
        "com.android.server.scannerservice.broadcast.action.SCANNER_RESULT",
        "nlscan.action.SCANNER_RESULT",
        "com.nlscan.uhf.bc.UHFSCANDATA",
        "android.intent.action.SCANRESULT",
        "com.scan.data",
        "com.gocom.scanner.action.SCAN_RESULT"
    )

    /** 各单选模式对应的广播 action（KEY_EVENT / SCREEN_ONLY 无）。 */
    fun actionForMode(mode: Int): String? = when (mode) {
        MODE_RFID_FUN_KEY -> "android.rfid.FUN_KEY"
        MODE_INTENT_FUN_KEY -> "android.intent.action.FUN_KEY"
        MODE_SCANNER_SERVICE -> "com.android.server.scannerservice.broadcast"
        MODE_SCAN_RESULT -> "nlscan.action.SCANNER_RESULT"
        else -> null
    }

    /** 该模式下应注册的广播 action 列表（空列表=不注册广播）。 */
    fun actionsForMode(mode: Int): List<String> {
        if (mode == MODE_AUTO) return ALL_ACTIONS.toList()
        return listOfNotNull(actionForMode(mode))
    }

    /** 该模式是否处理物理 KeyEvent。 */
    fun handlesKeyEvent(mode: Int): Boolean =
        mode == MODE_AUTO || mode == MODE_KEY_EVENT

    /** 该模式是否处理广播。 */
    fun handlesBroadcast(mode: Int): Boolean =
        mode != MODE_KEY_EVENT && mode != MODE_SCREEN_ONLY
}
