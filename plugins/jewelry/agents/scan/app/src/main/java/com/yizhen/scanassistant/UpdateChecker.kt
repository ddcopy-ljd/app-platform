package com.yizhen.scanassistant

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * 设备端「应用内自升级」：检查 / 下载 / 拉起系统安装器。
 *
 * 设计红线：
 * - 只拉起系统安装器，由用户在系统弹窗中确认，**不做无障碍自动点击、不做静默安装**；
 * - 全程不把 APK 读进内存（8KB buffer 流式计算 MD5）；
 * - 一律从插件 origin 直连两个免鉴权接口：
 *     GET {server}/api/scan-app/info     -> {"md5","size","force"}
 *     GET {server}/api/scan-app/download -> APK 文件
 *
 * 单例：待安装路径跨 Activity 生命周期保存在 [pendingInstallPath]，
 * 用户跳系统「未知来源」授权页返回后由各 Activity 的 onResume 调 [onResumeRetryIfPending] 续装。
 */
object UpdateChecker {

    private const val TAG = "UpdateChecker"
    private const val PATH_INFO = "/api/scan-app/info"
    private const val PATH_DOWNLOAD = "/api/scan-app/download"

    /** 已安装 base.apk 的 MD5（32 位小写 hex）；[warmUpMd5] 预热写入，供 WS hello 帧上报。 */
    @Volatile
    var installedMd5: String = ""

    /** 等待系统「未知来源」授权后继续安装的目标 APK 路径；为空表示无待办。 */
    @Volatile
    private var pendingInstallPath: String? = null

    /** 防重入：一次检查/下载未结束前不接受新的交互式检查。 */
    @Volatile
    private var inFlight = false

    private val main = Handler(Looper.getMainLooper())

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private data class Info(val server: String, val md5: String, val size: Long, val force: Boolean)

    // ============================================================ MD5

    /** 预热已安装包 MD5（后台线程，避免阻塞；仅当为空时计算）。 */
    fun warmUpMd5(context: Context) {
        if (installedMd5.isNotEmpty()) return
        val ctx = context.applicationContext
        Thread {
            val md5 = installedApkMd5(ctx)
            if (md5.isNotEmpty()) installedMd5 = md5
        }.start()
    }

    /** 同步计算当前已安装 base.apk 的 MD5（交互式检查时用）；失败返回空串。 */
    fun installedApkMd5(context: Context): String = try {
        val src = context.packageManager
            .getPackageInfo(context.packageName, 0)
            .applicationInfo.sourceDir
        apkMd5Of(File(src))
    } catch (e: Exception) {
        Log.w(TAG, "installed apk md5 failed", e)
        ""
    }

    /** 流式计算文件 MD5（32 位小写 hex）；失败返回空串。 */
    private fun apkMd5Of(file: File): String = try {
        val md = MessageDigest.getInstance("MD5")
        FileInputStream(file).use { inp ->
            val buf = ByteArray(8192)
            var n = inp.read(buf)
            while (n > 0) {
                md.update(buf, 0, n)
                n = inp.read(buf)
            }
        }
        md.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    } catch (e: Exception) {
        Log.w(TAG, "file md5 failed: ${file.absolutePath}", e)
        ""
    }

    // ============================================================ 检查

    /**
     * 检查更新。interactive=true（设置页手动点按）时用 Toast 反馈结果；
     * 静默模式（interactive=false，启动时）发现更新同样弹确认框，但不 toast 打扰。
     */
    fun check(activity: Activity, prefs: Prefs, interactive: Boolean) {
        val server = ApiClient.normalizeBase(prefs.serverUrl)
        if (server.isEmpty()) {
            if (interactive) toast(activity, activity.getString(R.string.update_no_server))
            return
        }
        if (inFlight) return
        inFlight = true

        val btn = if (interactive) activity.findViewById<TextView>(R.id.btnCheckUpdate) else null
        if (interactive) {
            btn?.isEnabled = false
            btn?.alpha = 0.5f
            btn?.text = activity.getString(R.string.update_checking)
        }
        val appCtx = activity.applicationContext

        Thread {
            val info = try {
                fetchInfo(server)
            } catch (e: Exception) {
                Log.w(TAG, "fetch info failed", e)
                null
            }
            // 有更新可能时才计算本机 MD5（交互式/静默都要，用于短路判定）
            val localMd5 = if (info != null && info.size > 0L) installedApkMd5(appCtx) else ""

            main.post {
                inFlight = false
                if (interactive) {
                    btn?.isEnabled = true
                    btn?.alpha = 1f
                    btn?.text = activity.getString(R.string.st_check_update)
                }
                when {
                    info == null ->
                        if (interactive) toast(activity, activity.getString(R.string.update_check_failed))

                    info.size <= 0L ->
                        if (interactive) toast(
                            activity,
                            activity.getString(R.string.update_none, AppConfig.APP_VERSION)
                        )

                    localMd5.isNotEmpty() && localMd5.equals(info.md5, ignoreCase = true) ->
                        if (interactive) toast(
                            activity,
                            activity.getString(R.string.update_none, AppConfig.APP_VERSION)
                        )

                    else -> promptUpdate(activity, info)
                }
            }
        }.start()
    }

    private fun fetchInfo(server: String): Info? {
        val req = Request.Builder().url(server + PATH_INFO).build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return null
            val text = resp.body?.string().orEmpty()
            val o = JSONObject(text)
            return Info(
                server = server,
                md5 = o.optString("md5", "").trim().lowercase(),
                size = o.optLong("size", 0L),
                force = o.optBoolean("force", false)
            )
        }
    }

    private fun promptUpdate(activity: Activity, info: Info) {
        val builder = AlertDialog.Builder(activity)
            .setTitle(R.string.update_found_title)
            .setMessage(if (info.force) R.string.update_force_msg else R.string.update_found_msg)
            .setPositiveButton(R.string.update_now) { _, _ -> startDownload(activity, info) }
        if (info.force) {
            builder.setCancelable(false)
        } else {
            builder.setNegativeButton(R.string.dialog_cancel, null)
        }
        builder.create().apply { setCanceledOnTouchOutside(!info.force) }.show()
    }

    // ============================================================ 下载 / 校验 / 安装

    private fun startDownload(activity: Activity, info: Info) {
        val dir = File(activity.getExternalFilesDir(null), "update")
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, "scan-assistant.apk")

        Thread {
            val ok = try {
                var success = false
                val req = Request.Builder().url(info.server + PATH_DOWNLOAD).build()
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) throw java.io.IOException("HTTP ${resp.code}")
                    val body = resp.body ?: throw java.io.IOException("empty body")
                    val total = body.contentLength().takeIf { it > 0 } ?: info.size
                    body.byteStream().use { inp ->
                        FileOutputStream(file).use { out ->
                            val buf = ByteArray(8192)
                            var n = inp.read(buf)
                            var done = 0L
                            var lastPct = -1
                            while (n > 0) {
                                out.write(buf, 0, n)
                                done += n
                                if (total > 0) {
                                    val pct = ((done * 100) / total).toInt()
                                    if (pct != lastPct) {
                                        lastPct = pct
                                        main.post {
                                            toast(
                                                activity,
                                                activity.getString(R.string.update_downloading, pct)
                                            )
                                        }
                                    }
                                }
                                n = inp.read(buf)
                            }
                            out.flush()
                        }
                    }
                    success = true
                }
                success && file.length() > 0
            } catch (e: Exception) {
                Log.w(TAG, "download failed", e)
                false
            }

            if (!ok) {
                main.post { toast(activity, activity.getString(R.string.update_download_failed)) }
                return@Thread
            }
            // 复核下载包 MD5
            val md5 = apkMd5Of(file)
            if (md5.isEmpty() || !md5.equals(info.md5, ignoreCase = true)) {
                file.delete()
                main.post { toast(activity, activity.getString(R.string.update_md5_failed)) }
                return@Thread
            }
            // 校验包信息（包名/版本号不回退/签名一致）
            if (!verifyPackage(activity, file)) {
                file.delete()
                main.post { toast(activity, activity.getString(R.string.update_md5_failed)) }
                return@Thread
            }
            main.post { install(activity, file) }
        }.start()
    }

    /** 包版本号（compat）：longVersionCode 为 API 28+，minSdk 26 需回退到 versionCode。 */
    @Suppress("DEPRECATION")
    private fun versionCodeOf(pi: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode
        else pi.versionCode.toLong()

    /** 校验下载包：包名一致、versionCode 不回退、签名与当前安装一致（签名取不到不阻断）。 */
    private fun verifyPackage(context: Context, file: File): Boolean {
        val pm = context.packageManager
        val archive = try {
            @Suppress("DEPRECATION")
            pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
        } catch (e: Exception) {
            Log.w(TAG, "getPackageArchiveInfo failed", e)
            null
        }
        if (archive == null) {
            Log.w(TAG, "archive info null, reject")
            return false
        }
        if (archive.packageName != context.packageName) {
            Log.w(TAG, "package name mismatch: ${archive.packageName}")
            return false
        }
        val newCode = versionCodeOf(archive)
        val curCode = try {
            versionCodeOf(pm.getPackageInfo(context.packageName, 0))
        } catch (e: Exception) {
            Log.w(TAG, "current version lookup failed", e)
            0L
        }
        if (newCode < curCode) {
            Log.w(TAG, "version downgrade blocked: $newCode < $curCode")
            return false
        }
        // 签名一致性：任一取不到则不阻断（仅告警）
        val newSigs = archive.signatures
        val curSigs = try {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures
        } catch (e: Exception) {
            Log.w(TAG, "current signatures lookup failed", e)
            null
        }
        if (newSigs != null && curSigs != null) {
            val a = newSigs.map { it.toCharsString() }.toSet()
            val b = curSigs.map { it.toCharsString() }.toSet()
            if (a != b) {
                Log.w(TAG, "signature mismatch, reject")
                return false
            }
        } else {
            Log.w(TAG, "signature unavailable, skip signature check")
        }
        return true
    }

    private fun install(activity: Activity, file: File) {
        // minSdk 26，canRequestPackageInstalls 恒可用；未授权则跳系统设置，授权返回后续装
        if (!activity.packageManager.canRequestPackageInstalls()) {
            pendingInstallPath = file.absolutePath
            toast(activity, activity.getString(R.string.update_perm_msg))
            try {
                val i = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
                activity.startActivity(i)
            } catch (e: Exception) {
                Log.w(TAG, "open unknown-sources settings failed", e)
                toast(activity, activity.getString(R.string.update_perm_msg))
            }
            return
        }
        launchInstaller(activity, file)
    }

    private fun launchInstaller(activity: Activity, file: File) {
        try {
            val uri = FileProvider.getUriForFile(
                activity, "${activity.packageName}.fileprovider", file
            )
            val i = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(i)
        } catch (e: Exception) {
            Log.w(TAG, "launch installer failed", e)
            toast(activity, activity.getString(R.string.update_install_failed))
        }
    }

    /**
     * 各 Activity onResume 调用：若存在因「未知来源」授权中断的待装包，
     * 且现已获得安装权限，则直接拉起安装器续装。
     */
    fun onResumeRetryIfPending(activity: Activity) {
        val path = pendingInstallPath ?: return
        if (!activity.packageManager.canRequestPackageInstalls()) return
        pendingInstallPath = null
        val file = File(path)
        if (!file.exists()) return
        toast(activity, activity.getString(R.string.update_install_ready))
        launchInstaller(activity, file)
    }

    private fun toast(activity: Activity, msg: String) {
        Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show()
    }
}
