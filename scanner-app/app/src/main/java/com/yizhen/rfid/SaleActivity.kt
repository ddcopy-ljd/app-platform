package com.yizhen.rfid

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * 销售出单（原生页）：与手机/电脑网页端出单内容一致。
 *
 * 实体键分工（C72）：
 *  - 侧边 SCAN(139)：单件识别。RFID 模式=出单小功率 EPC 单扫；条码模式=2D 头扫条码/二维码
 *  - F12(142)：切换 RFID / 条码 模式
 *  - 手柄扳机(293/280)：高功率 EPC 单扫（按下扫、松开停），用于远处单件
 * 扫到商品自动填名称/金额，只需点一次【提交出单】。
 */
class SaleActivity : BaseActivity() {

    private data class Product(
        val id: Int, val code: String, val name: String, val price: Double, val epc: String
    )

    private lateinit var prefs: Prefs
    private lateinit var api: SaleApi
    private val main = Handler(Looper.getMainLooper())
    private val net = Executors.newSingleThreadExecutor()

    private lateinit var tvPower: TextView
    private lateinit var tvHint: TextView
    private lateinit var ivProd: ImageView
    private lateinit var tvEmpty: TextView
    private lateinit var tvCode: TextView
    private lateinit var tvName: TextView
    private lateinit var tvPrice: TextView
    private lateinit var tvNotFound: TextView
    private lateinit var tvNotFoundTip: TextView
    private lateinit var etCustomer: EditText
    private lateinit var etPhone: EditText
    private lateinit var etProduct: EditText
    private lateinit var etAmount: EditText
    private lateinit var etPaid: EditText
    private lateinit var etDate: EditText
    private lateinit var btnEpc: TextView
    private lateinit var btnSubmit: TextView

    private var tone: ToneGenerator? = null
    private var options = listOf<Product>()
    private var picked: Product? = null
    private var epcScanning = false
    private var method = "现金"
    private var pendingType = "barcode"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        api = SaleApi(prefs)
        if (prefs.authToken.isBlank() || prefs.authOrigin.isBlank()) { backToLogin(); return }
        setContentView(R.layout.activity_sale)
        tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)

        bindViews()
        setupListeners()
        etDate.setText(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()))
        updateSourceUi()
        loadOptions()
    }

    private fun bindViews() {
        tvPower = findViewById(R.id.tvSalePower)
        tvHint = findViewById(R.id.tvScanHint)
        ivProd = findViewById(R.id.ivProduct)
        tvEmpty = findViewById(R.id.tvProdEmpty)
        tvCode = findViewById(R.id.tvProdCode)
        tvName = findViewById(R.id.tvProdName)
        tvPrice = findViewById(R.id.tvProdPrice)
        tvNotFound = findViewById(R.id.tvNotFound)
        tvNotFoundTip = findViewById(R.id.tvNotFoundTip)
        etCustomer = findViewById(R.id.etCustomer)
        etPhone = findViewById(R.id.etPhone)
        etProduct = findViewById(R.id.etProduct)
        etAmount = findViewById(R.id.etAmount)
        etPaid = findViewById(R.id.etPaid)
        etDate = findViewById(R.id.etDate)
        btnEpc = findViewById(R.id.btnScanEpc)
        btnSubmit = findViewById(R.id.btnSubmit)
    }

    private fun setupListeners() {
        findViewById<TextView>(R.id.btnSaleBack).setOnClickListener { finish() }
        tvPower.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        findViewById<TextView>(R.id.btnScanBarcode).setOnClickListener {
            setSource(1); scanCamera(ScanOptions.ONE_D_CODE_TYPES, "barcode")
        }
        findViewById<TextView>(R.id.btnScanQr).setOnClickListener {
            setSource(1); scanCamera(listOf(ScanOptions.QR_CODE), "qrcode")
        }
        btnEpc.setOnClickListener { setSource(0); startEpcSingle(prefs.salePower) }

        val chips = listOf(
            findViewById<TextView>(R.id.chipCash) to "现金",
            findViewById<TextView>(R.id.chipWechat) to "微信",
            findViewById<TextView>(R.id.chipCard) to "刷卡",
            findViewById<TextView>(R.id.chipTransfer) to "转账"
        )
        chips.forEach { (view, m) ->
            view.setOnClickListener {
                method = m
                chips.forEach { (v, mm) ->
                    val on = mm == m
                    v.setBackgroundResource(if (on) R.drawable.bg_btn_green else R.drawable.bg_btn_dark)
                    v.setTextColor(getColor(if (on) R.color.text_primary else R.color.text_secondary))
                }
            }
        }

        btnSubmit.setOnClickListener { submit() }
    }

    // -------------------------------- 数据

    private fun loadOptions() {
        net.execute {
            try {
                val arr = api.options()
                val list = ArrayList<Product>()
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    list.add(
                        Product(
                            id = o.optInt("id"),
                            code = o.optString("code"),
                            name = o.optString("name"),
                            price = o.optDouble("price", 0.0),
                            epc = o.optString("rfid_epc")
                        )
                    )
                }
                main.post { options = list }
            } catch (_: Exception) { }
        }
    }

    // -------------------------------- 扫码识别

    private val cameraLauncher = registerForActivityResult(ScanContract()) { res ->
        val code = res.contents?.trim().orEmpty()
        if (code.isNotEmpty()) { beep(); onCode(code, pendingType) }
    }

    private fun scanCamera(formats: Collection<String>, type: String) {
        pendingType = type
        val opts = ScanOptions()
        opts.setDesiredBarcodeFormats(formats)
        opts.setPrompt("")
        opts.setBeepEnabled(false)
        opts.setOrientationLocked(true)                       // 保持竖屏，不横过来
        opts.setCaptureActivity(PortraitCaptureActivity::class.java) // 变焦 + 连续自动对焦
        cameraLauncher.launch(opts)
    }

    /** 142 键：在 RFID(EPC) / 条码摄像头 两种单件识别方式间切换。 */
    private fun setSource(mode: Int) {
        if (prefs.saleSource != mode) prefs.saleSource = mode
        updateSourceUi()
    }

    private fun updateSourceUi() {
        tvPower.text = if (prefs.saleSource == 1)
            getString(R.string.sc_mode_camera)
        else
            getString(R.string.sc_mode_rfid, prefs.salePower)
    }

    /** EPC 单件识别：扫到第一枚即停。dbm 区分 SCAN 小功率 / 扳机高功率。 */
    private fun startEpcSingle(dbm: Int) {
        if (epcScanning) return
        if (!RfidManager.ready) {
            // 无 UHF 模块：直接退化为摄像头扫条码
            setSource(1)
            scanCamera(ScanOptions.ONE_D_CODE_TYPES, "barcode")
            return
        }
        RfidManager.setPower(dbm)
        epcScanning = true
        setEpcUi(true)
        val ok = RfidManager.start { epc, _ ->
            if (!epcScanning) return@start
            stopEpc()
            beep()
            onCode(epc, "epc")
        }
        if (!ok) {
            epcScanning = false
            setEpcUi(false)
            rfidErrorToast(this, R.string.rfid_fail, Toast.LENGTH_SHORT)
        }
    }

    private fun stopEpc() {
        if (!epcScanning) return
        epcScanning = false
        RfidManager.stop()
        setEpcUi(false)
    }

    private fun setEpcUi(on: Boolean) {
        tvHint.visibility = if (on) android.view.View.VISIBLE else android.view.View.GONE
        btnEpc.setBackgroundResource(if (on) R.drawable.bg_btn_red else R.drawable.bg_btn_green)
    }

    /** 识别结果：EPC 按 rfid_epc 匹配，条码/二维码按商品编码匹配。 */
    private fun onCode(raw: String, type: String) {
        val c = raw.trim().uppercase()
        if (c.isEmpty()) return
        var p: Product? = null
        if (type == "epc") {
            p = options.firstOrNull { it.epc.uppercase() == c }
        } else {
            p = options.firstOrNull { it.code.uppercase() == c }
                ?: options.firstOrNull { it.code.uppercase() == c.trimStart('0') }
        }
        if (p != null) {
            picked = p
            etProduct.setText(p.name)
            etAmount.setText(if (p.price > 0) String.format(Locale.US, "%.2f", p.price) else "")
            showProduct(p)
            setNotFound(null)
            Toast.makeText(this, "${p.code} ${p.name}", Toast.LENGTH_SHORT).show()
        } else {
            // 库中找不到：界面常驻提示（不只弹一下 Toast），等人工核对后手工填写
            picked = null
            setNotFound(c, type)
            clearProduct()
            if (type != "epc") etProduct.setText(raw)
            Toast.makeText(this, R.string.sc_not_found, Toast.LENGTH_SHORT).show()
        }
    }

    /** 未匹配常驻提示：明确说明扫到的是异常 EPC 号 / 条码 / 二维码。 */
    private fun setNotFound(code: String?, type: String = "") {
        if (code.isNullOrBlank()) {
            tvNotFound.visibility = android.view.View.GONE
            tvNotFoundTip.visibility = android.view.View.GONE
            return
        }
        val res = when (type) {
            "epc" -> R.string.sc_bad_epc
            "qrcode" -> R.string.sc_bad_qr
            else -> R.string.sc_bad_barcode
        }
        tvNotFound.text = getString(res, code)
        tvNotFound.visibility = android.view.View.VISIBLE
        tvNotFoundTip.visibility = android.view.View.VISIBLE
    }

    private fun showProduct(p: Product) {
        tvEmpty.visibility = android.view.View.GONE
        tvCode.visibility = android.view.View.VISIBLE
        tvName.visibility = android.view.View.VISIBLE
        tvPrice.visibility = android.view.View.VISIBLE
        tvCode.text = p.code
        tvName.text = p.name
        tvPrice.text = String.format(Locale.US, "￥%.2f", p.price)
        ivProd.setImageDrawable(null)
        ivProd.visibility = android.view.View.GONE
        net.execute {
            val bmp: Bitmap? = api.image(p.id)
            main.post {
                if (bmp != null && picked?.id == p.id) {
                    ivProd.setImageBitmap(bmp)
                    ivProd.visibility = android.view.View.VISIBLE
                }
            }
        }
    }

    private fun clearProduct() {
        tvEmpty.visibility = android.view.View.VISIBLE
        tvCode.visibility = android.view.View.GONE
        tvName.visibility = android.view.View.GONE
        tvPrice.visibility = android.view.View.GONE
        ivProd.visibility = android.view.View.GONE
        ivProd.setImageDrawable(null)
    }

    // -------------------------------- 提交

    private fun submit() {
        val amount = etAmount.text.toString().trim().toDoubleOrNull() ?: 0.0
        if (amount <= 0) {
            Toast.makeText(this, R.string.sc_need_amount, Toast.LENGTH_SHORT).show()
            return
        }
        val paid = etPaid.text.toString().trim().toDoubleOrNull() ?: 0.0
        val body = JSONObject()
            .put("customer", etCustomer.text.toString().trim())
            .put("phone", etPhone.text.toString().trim())
            .put("product", etProduct.text.toString().trim())
            .put("amount", amount)
            .put("paid", paid)
            .put("method", method)
            .put("biz_date", etDate.text.toString().trim())
        picked?.let { body.put("product_id", it.id) }

        btnSubmit.isEnabled = false
        net.execute {
            try {
                val r = api.create(body)
                main.post {
                    btnSubmit.isEnabled = true
                    val bill = r.optString("bill_no")
                    Toast.makeText(this, getString(R.string.sc_saved, bill), Toast.LENGTH_LONG).show()
                    picked = null
                    etProduct.setText("")
                    etAmount.setText("")
                    etPaid.setText("")
                    clearProduct()
                    setNotFound(null)
                    loadOptions()
                }
            } catch (e: Exception) {
                main.post {
                    btnSubmit.isEnabled = true
                    Toast.makeText(this, e.message ?: "error", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    // -------------------------------- 实体键（139 单件 / 142 切换 / 扳机高功率）

    private val cameraFallback = Runnable {
        scanCamera(ScanOptions.ONE_D_CODE_TYPES + ScanOptions.QR_CODE, "barcode")
    }

    private val keyRouter by lazy {
        KeyRouter(this, prefs.triggerMode == TriggerChannels.MODE_SCREEN_ONLY,
            object : KeyRouter.Callbacks {
                override fun onGun(down: Boolean) {
                    // 手柄扳机：高功率 EPC 单件，按下扫、松开停
                    if (down) { setSource(0); startEpcSingle(prefs.power) } else stopEpc()
                }

                override fun onScanKey() {
                    // 键盘助手可能已把条码注入商品名输入框（139 收尾），优先取字段文本
                    if (consumeWedgeField()) return
                    if (prefs.saleSource == 0) {
                        startEpcSingle(prefs.salePower)
                    } else {
                        // 条码模式：等 2D 头结果广播；350ms 无数据则开摄像头兜底
                        main.removeCallbacks(cameraFallback)
                        main.postDelayed(cameraFallback, 350)
                    }
                }

                override fun onModeKey() {
                    stopEpc()
                    val toRfid = prefs.saleSource != 0
                    setSource(if (toRfid) 0 else 1)
                    Toast.makeText(
                        this@SaleActivity,
                        if (toRfid) R.string.sc_mode_to_rfid else R.string.sc_mode_to_camera,
                        Toast.LENGTH_SHORT
                    ).show()
                }

                override fun onBarcode(text: String) = onBarcodeDelivered(text)

                // 出单页不把其它 F 键/手柄设备当扳机，避免误触
                override fun fallbackAsGun() = false
            })
    }

    /** 键盘助手 wedge 模式：条码字符被注入「商品名称」输入框，139 到达时整段取走。 */
    private fun consumeWedgeField(): Boolean {
        if (currentFocus !== etProduct) return false
        val t = etProduct.text?.toString()?.trim().orEmpty()
        if (t.isEmpty()) return false
        etProduct.setText("")
        onBarcodeDelivered(t)
        return true
    }

    private fun onBarcodeDelivered(code: String) {
        main.removeCallbacks(cameraFallback)
        stopEpc()
        beep()
        onCode(code, "barcode")
    }

    override fun onResume() {
        super.onResume()
        keyRouter.register()
    }

    override fun onPause() {
        super.onPause()
        keyRouter.unregister()
    }

    override fun onStart() {
        super.onStart()
        // 进出单页切出单小功率，离开恢复盘点功率
        if (RfidManager.ready) RfidManager.setPower(prefs.salePower)
    }

    override fun onStop() {
        super.onStop()
        main.removeCallbacks(cameraFallback)
        stopEpc()
        if (RfidManager.ready) RfidManager.setPower(prefs.power)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (keyRouter.dispatch(event)) return true
        // 回车快捷提交：商品/金额已就绪时一次回车即出单
        if (event.keyCode == KeyEvent.KEYCODE_ENTER &&
            event.action == KeyEvent.ACTION_DOWN &&
            (etAmount.text?.toString()?.trim()?.toDoubleOrNull() ?: 0.0) > 0
        ) {
            submit()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // -------------------------------- 其它

    private fun beep() {
        try {
            val ok = tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 150) ?: false
            if (!ok) {
                try { tone?.release() } catch (_: Exception) {}
                tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
                tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
            }
        } catch (_: Exception) {}
    }

    private fun backToLogin() {
        prefs.clearAuth()
        val i = Intent(this, LoginActivity::class.java)
        i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(i)
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        try { tone?.release() } catch (_: Exception) {}
        net.shutdownNow()
        main.removeCallbacksAndMessages(null)
    }
}
