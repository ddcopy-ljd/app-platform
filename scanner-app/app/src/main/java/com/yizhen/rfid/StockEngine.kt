package com.yizhen.rfid

import org.json.JSONArray

/** 快照解析与本地实时比对引擎（单 Activity 内使用，主线程访问）。 */
class StockEngine(private val prefs: Prefs) {

    val snapshot = LinkedHashMap<String, SnapshotItem>()
    val records = LinkedHashMap<String, ScanRecord>()

    var online = true
    var globalScanned = 0
    var multiDevice = false
    private var seqCounter = 0

    val snapshotCount: Int get() = snapshot.size

    fun loadSnapshot(json: String): Int {
        snapshot.clear()
        if (json.isBlank()) return 0
        val arr = JSONArray(json)
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val epc = o.optString("epc").uppercase()
            if (epc.isEmpty()) continue
            snapshot[epc] = SnapshotItem(
                epc = epc,
                code = o.optString("code"),
                name = o.optString("name"),
                status = o.optString("status"),
                highValue = o.optInt("high_value", 0) != 0
            )
        }
        return snapshot.size
    }

    /** 初始化高价值未扫到列表。 */
    fun initHighValueUnscanned() {
        if (!prefs.highValueRemind) return
        snapshot.values.filter { it.highValue }.forEach { item ->
            if (!records.containsKey(item.epc)) {
                records[item.epc] = ScanRecord(
                    epc = item.epc,
                    type = RecordType.HIGHVALUE_UNSCANNED,
                    selfScanned = false,
                    deviceNo = 0,
                    name = item.name,
                    seq = --seqCounter
                )
            }
        }
    }

    /**
     * 本机扫到一个标签。
     * @return 1=本店新标签, 2=非本店(异常)新标签, 0=重复(已见过)
     */
    fun onSelfScan(epcRaw: String, rssi: Int, time: String): Int {
        val epc = epcRaw.uppercase()
        val existing = records[epc]
        if (existing != null && existing.selfScanned) return 0

        val info = snapshot[epc]
        return if (info != null) {
            // 本店商品
            records[epc] = ScanRecord(
                epc = epc,
                type = if (info.highValue) RecordType.HIGHVALUE_SCANNED else RecordType.NORMAL,
                selfScanned = true,
                deviceNo = prefs.deviceNo,
                rssi = rssi,
                time = time,
                name = info.name,
                seq = ++seqCounter
            )
            1
        } else {
            // 非本店 / 未登记标签
            records[epc] = ScanRecord(
                epc = epc,
                type = RecordType.ABNORMAL,
                selfScanned = true,
                deviceNo = prefs.deviceNo,
                rssi = rssi,
                time = time,
                name = "",
                seq = ++seqCounter
            )
            2
        }
    }

    /** 合并其他设备拉取到的标签。 */
    fun mergeOther(epcRaw: String, deviceNo: Int) {
        val epc = epcRaw.uppercase()
        val cur = records[epc]
        if (cur != null && cur.selfScanned) return
        val info = snapshot[epc] ?: return // 仅合并本店商品
        multiDevice = true
        records[epc] = ScanRecord(
            epc = epc,
            type = RecordType.OTHER_DEVICE,
            selfScanned = false,
            deviceNo = deviceNo,
            name = info.name,
            seq = 100000 + (records.size)
        )
    }

    fun listForTab(abnormalTab: Boolean): List<ScanRecord> {
        // 同类型内按 seq 降序：最新扫到的记录始终排在最上面，无需翻找
        return records.values
            .filter { if (abnormalTab) it.type == RecordType.ABNORMAL else it.type != RecordType.ABNORMAL }
            .sortedWith(compareBy({ it.type.weight }, { -it.seq }))
    }

    fun countSelf(): Int = records.values.count { it.selfScanned }
    fun countAbnormal(): Int = records.values.count { it.type == RecordType.ABNORMAL }
    fun countHighValueUnscanned(): Int =
        records.values.count { it.type == RecordType.HIGHVALUE_UNSCANNED }

    fun reset() {
        records.clear()
        snapshot.clear()
        globalScanned = 0
        multiDevice = false
        seqCounter = 0
    }
}
