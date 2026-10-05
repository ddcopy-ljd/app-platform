package com.yizhen.rfid

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.util.UUID
import kotlin.concurrent.thread

/**
 * 蓝牙标签机打印桥：经典蓝牙 SPP 直发 ZPL 字节流。
 * 适用便携热敏/标签机（TSC、GOOJPRT、佳博等），需先在系统蓝牙里配对。
 * Android 12+ 需要 BLUETOOTH_CONNECT 运行时权限。
 */
object PrintBridge {
    const val REQ_BT = 4101
    private const val SPP_UUID = "00001101-0000-1000-8000-00805F9B34FB"

    fun hasPermission(act: AppCompatActivity): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            ContextCompat.checkSelfPermission(act, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        else true

    fun requestPermission(act: AppCompatActivity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            act.requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), REQ_BT)
        }
    }

    private fun adapter(act: AppCompatActivity) =
        (act.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    /** 已配对蓝牙设备列表 [{name,address}]（可能含非打印设备，由页面选择）。 */
    @SuppressLint("MissingPermission")
    fun paired(act: AppCompatActivity): JSONArray {
        val arr = JSONArray()
        if (!hasPermission(act)) return arr
        try {
            val list = adapter(act)?.bondedDevices ?: return arr
            for (d in list) {
                val name = try { d.name ?: "" } catch (_: SecurityException) { "" }
                arr.put(JSONObject().put("name", name).put("address", d.address))
            }
        } catch (_: SecurityException) {}
        return arr
    }

    @SuppressLint("MissingPermission")
    fun nameOf(act: AppCompatActivity, address: String): String {
        if (!hasPermission(act)) return address
        return try {
            adapter(act)?.bondedDevices
                ?.firstOrNull { it.address == address }?.name ?: address
        } catch (_: SecurityException) { address }
    }

    /** 连接指定打印机并发送 ZPL；结果回调在后台线程。 */
    @SuppressLint("MissingPermission")
    fun send(act: AppCompatActivity, address: String, zpl: String, onResult: (Boolean, String) -> Unit) {
        if (!hasPermission(act)) { onResult(false, "bluetooth permission required"); return }
        val dev = try { adapter(act)?.getRemoteDevice(address) } catch (_: Exception) { null }
        if (dev == null) { onResult(false, "printer not found"); return }
        thread {
            var out: OutputStream? = null
            try {
                val sock = dev.createRfcommSocketToServiceRecord(UUID.fromString(SPP_UUID))
                try { adapter(act)?.cancelDiscovery() } catch (_: SecurityException) {}
                sock.connect()
                out = sock.outputStream
                out.write(zpl.toByteArray(Charsets.ISO_8859_1))
                out.flush()
                Thread.sleep(150) // 给打印机缓冲出纸时间
                out.close()
                sock.close()
                onResult(true, "ok")
            } catch (e: Exception) {
                try { out?.close() } catch (_: Exception) {}
                onResult(false, e.message ?: "print failed")
            }
        }
    }
}
