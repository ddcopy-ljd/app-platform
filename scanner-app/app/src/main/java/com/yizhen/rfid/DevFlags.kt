package com.yizhen.rfid

/**
 * 临时/调试功能总开关。
 *
 * 这里的功能都是开发测试期的临时入口，正式版把对应开关置 false 即可隐藏界面入口，
 * 代码保留，以后需要时再打开（不用重新写一遍）。
 */
object DevFlags {

    /**
     * 【EPC 采集】入口开关：首页显示「🧪 EPC 采集（临时）」按钮。
     * 用途：用手持机实扫一批真实标签 EPC，导出后给测试数据/演示数据当商品 EPC 用。
     */
    const val SHOW_EPC_COLLECTOR = true

    /** EPC 采集服务默认端口（与 tools/epc_collect_server.py 保持一致）。 */
    const val EPC_COLLECTOR_PORT = 8790
}
