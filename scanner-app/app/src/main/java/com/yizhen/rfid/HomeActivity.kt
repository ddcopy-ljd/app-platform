package com.yizhen.rfid

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 主界面：销售出单 / 库存盘点 两个入口 + 参数设置。
 */
class HomeActivity : BaseActivity() {

    private lateinit var prefs: Prefs
    private val net = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)
        prefs = Prefs(this)

        // 会话缺失（如被清理）则回到登录页
        if (prefs.authToken.isBlank() || prefs.authOrigin.isBlank()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        val user = JSONObject(prefs.authUserJson)
        findViewById<TextView>(R.id.tvHomeUser).text =
            user.optString("display_name").ifBlank { user.optString("username", "—") }
        findViewById<TextView>(R.id.tvHomeServer).text = prefs.authOrigin

        findViewById<TextView>(R.id.btnHomeSale).setOnClickListener {
            startActivity(Intent(this, SaleActivity::class.java))
        }
        findViewById<TextView>(R.id.btnHomeStock).setOnClickListener {
            startActivity(Intent(this, StockActivity::class.java))
        }
        // 管理后台（完整 Web 应用，含蓝牙打印标签）
        findViewById<TextView>(R.id.btnHomeAdmin).setOnClickListener {
            val i = Intent(this, WebActivity::class.java)
            i.putExtra("url", "index.html")
            startActivity(i)
        }
        findViewById<TextView>(R.id.btnHomeSettings).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        // 临时工具入口：DevFlags.SHOW_EPC_COLLECTOR 置 false 即隐藏
        findViewById<TextView>(R.id.btnHomeEpcCollect).apply {
            visibility = if (DevFlags.SHOW_EPC_COLLECTOR) View.VISIBLE else View.GONE
            setOnClickListener {
                startActivity(Intent(this@HomeActivity, EpcCollectActivity::class.java))
            }
        }
        findViewById<TextView>(R.id.btnHomeLogout).setOnClickListener {
            androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle(R.string.logout_confirm_title)
                .setMessage(R.string.logout_confirm_msg)
                .setNegativeButton(R.string.btn_cancel, null)
                .setPositiveButton(R.string.btn_confirm) { _, _ ->
                    net.execute {
                        AuthApi.logout(prefs.authOrigin, prefs.authToken)
                    }
                    prefs.clearAuth()
                    startActivity(Intent(this, LoginActivity::class.java))
                    finish()
                }
                .show()
        }

        // 提前初始化 UHF 模块，进入扫描页即刻可用
        net.execute {
            repeat(3) {
                if (RfidManager.ready) return@repeat
                RfidManager.init(applicationContext)
                if (RfidManager.ready) return@repeat
                try { Thread.sleep(800) } catch (_: InterruptedException) { }
            }
            if (RfidManager.ready) RfidManager.setPower(prefs.power)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        net.shutdownNow()
    }
}
