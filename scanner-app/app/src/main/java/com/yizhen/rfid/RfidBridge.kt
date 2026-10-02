package com.yizhen.rfid

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.entity.UHFTAGInfo
import org.json.JSONObject

class RfidBridge(private val context: Context, private val webView: WebView) {

    private var uhf: RFIDWithUHFUART? = null
    private var isInitialized = false

    init {
        try {
            uhf = RFIDWithUHFUART.getInstance()
            uhf?.init(context)
            isInitialized = true
        } catch (e: Exception) {
            isInitialized = false
            e.printStackTrace()
        }
    }

    /**
     * Called from JS to check if RFID module is ready.
     */
    @JavascriptInterface
    fun isReady(): Boolean = isInitialized

    @Volatile
    private var scanning = false

    /**
     * Start continuous inventory scan.
     * Results are pushed to JS via window.onRfidScan(json)
     */
    @JavascriptInterface
    fun startScan(): Boolean {
        if (!isInitialized || scanning) return false
        return try {
            val ok = uhf?.startInventoryTag() ?: false
            if (ok) {
                scanning = true
                Thread {
                    while (scanning) {
                        val tag: UHFTAGInfo? = uhf?.readTagFromBuffer()
                        if (tag == null) {
                            Thread.sleep(20)
                            continue
                        }
                        pushToJs(tag.getEPC(), tag.getRssi().toString())
                    }
                }.start()
            }
            ok
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    /**
     * Stop continuous inventory scan.
     */
    @JavascriptInterface
    fun stopScan(): Boolean {
        scanning = false
        return try {
            uhf?.stopInventory() ?: false
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    /**
     * Single inventory (for testing).
     */
    @JavascriptInterface
    fun inventoryOnce(): String {
        if (!isInitialized) return ""
        return try {
            uhf?.inventorySingleTag() ?: ""
        } catch (e: Exception) {
            e.printStackTrace()
            ""
        }
    }

    /**
     * Get module version.
     */
    @JavascriptInterface
    fun getVersion(): String {
        return try {
            uhf?.version ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Get antenna power (dBm).
     */
    @JavascriptInterface
    fun getPower(): Int {
        return try {
            uhf?.power ?: -1
        } catch (e: Exception) {
            -1
        }
    }

    /**
     * Set antenna power (dBm).
     */
    @JavascriptInterface
    fun setPower(power: Int): Boolean {
        return try {
            uhf?.setPower(power) ?: false
        } catch (e: Exception) {
            false
        }
    }

    private fun pushToJs(epc: String, rssi: String) {
        val json = JSONObject()
        json.put("epc", epc)
        json.put("rssi", rssi)
        val js = "window.onRfidScan && window.onRfidScan($json);"
        webView.post {
            webView.evaluateJavascript(js, null)
        }
    }
}
