package com.yizhen.rfid

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class ScanAdapter(private val activity: StockActivity) :
    RecyclerView.Adapter<ScanAdapter.VH>() {

    private var items: List<ScanRecord> = emptyList()

    fun submit(list: List<ScanRecord>) {
        items = list
        notifyDataSetChanged()
    }

    inner class VH(v: View) : RecyclerView.ViewHolder(v) {
        val name: TextView = v.findViewById(R.id.tvName)
        val epc: TextView = v.findViewById(R.id.tvEpc)
        val badge: TextView = v.findViewById(R.id.tvBadge)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_scan, parent, false)
        return VH(v)
    }

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, position: Int) {
        val r = items[position]
        h.name.text = r.name.ifBlank { r.epc }
        h.epc.text = r.epc
        when (r.type) {
            RecordType.ABNORMAL -> {
                h.badge.setBackgroundResource(R.drawable.badge_red)
                h.badge.setTextColor(0xFFEF9A9A.toInt())
                h.badge.text = activity.getString(R.string.tab_abnormal)
            }
            RecordType.HIGHVALUE_UNSCANNED -> {
                h.badge.setBackgroundResource(R.drawable.badge_orange)
                h.badge.setTextColor(0xFFFFE0B2.toInt())
                h.badge.text = activity.getString(R.string.tag_hv_uns)
            }
            RecordType.HIGHVALUE_SCANNED -> {
                h.badge.setBackgroundResource(R.drawable.badge_orange)
                h.badge.setTextColor(0xFFFFE0B2.toInt())
                h.badge.text = badgeDevice(r) + "·" + activity.getString(R.string.tag_hv)
            }
            RecordType.OTHER_DEVICE -> {
                h.badge.setBackgroundResource(R.drawable.badge_green)
                h.badge.setTextColor(0xFFB3E5FC.toInt())
                h.badge.text = activity.getString(R.string.tag_device, r.deviceNo)
            }
            RecordType.NORMAL -> {
                h.badge.setBackgroundResource(R.drawable.badge_green)
                h.badge.setTextColor(0xFFC8E6C9.toInt())
                h.badge.text = badgeDevice(r)
            }
        }
    }

    private fun badgeDevice(r: ScanRecord): String =
        if (r.selfScanned) activity.getString(R.string.tag_self)
        else activity.getString(R.string.tag_device, r.deviceNo)
}
