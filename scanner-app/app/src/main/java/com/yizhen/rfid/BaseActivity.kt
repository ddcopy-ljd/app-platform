package com.yizhen.rfid

import android.content.Context
import android.content.res.Configuration
import androidx.appcompat.app.AppCompatActivity
import java.util.Locale

/** 统一在此应用语言偏好（zh / en / it），所有界面继承本类即可整 App 切换语言。 */
open class BaseActivity : AppCompatActivity() {
    override fun attachBaseContext(base: Context) {
        val lang = base.getSharedPreferences("rfid", Context.MODE_PRIVATE).getString("lang", "zh") ?: "zh"
        val locale = when (lang) {
            "en" -> Locale.ENGLISH
            "it" -> Locale.ITALIAN
            else -> Locale.SIMPLIFIED_CHINESE
        }
        Locale.setDefault(locale)
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(locale)
        super.attachBaseContext(base.createConfigurationContext(cfg))
    }

    /** 在 zh → en → it → zh 之间循环，写入语言偏好。 */
    protected fun cycleLang() {
        val order = arrayOf("zh", "en", "it")
        val cur = getSharedPreferences("rfid", MODE_PRIVATE).getString("lang", "zh") ?: "zh"
        val i = order.indexOf(cur).let { if (it < 0) 0 else it }
        getSharedPreferences("rfid", MODE_PRIVATE).edit()
            .putString("lang", order[(i + 1) % order.size]).apply()
    }
}
