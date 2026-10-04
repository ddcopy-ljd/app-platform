package com.yizhen.rfid

/** 本店商品快照（盘点开始前从服务端下发）。 */
data class SnapshotItem(
    val epc: String,
    val code: String,
    val name: String,
    val status: String,
    val highValue: Boolean
)

/** 明细类型；weight 为排序权重（越小越靠前）。 */
enum class RecordType(val weight: Int) {
    ABNORMAL(0),            // 非本店商品（盘盈/异常标签）
    HIGHVALUE_UNSCANNED(1), // 高价值未扫到
    HIGHVALUE_SCANNED(2),   // 高价值已扫到
    NORMAL(3),              // 本店普通商品
    OTHER_DEVICE(4)         // 其他设备扫到
}

data class ScanRecord(
    val epc: String,
    var type: RecordType,
    val selfScanned: Boolean,   // 是否本机扫到
    var deviceNo: Int,          // 扫描设备临时号（其他设备时有效）
    var rssi: Int = 0,
    var time: String = "",
    var name: String = "",
    var seq: Int = 0
)
