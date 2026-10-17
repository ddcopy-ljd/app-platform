using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    /// <summary>
    /// 自动升级服务: 定期向服务端查询发布版 exe 的 MD5, 与本地不一致时自动下载、校验、替换并重启。
    /// 服务端约定: GET {base}/api/agent/version 返回 {"md5":"...", "url":"...", "version":"..."}。
    /// base 优先取 config.UpdateServerUrl; 为空时由 config.ServerUrl(ws/wss/http/https) 推导 scheme://host。
    /// </summary>
    public class UpdateService
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };

        private readonly AppConfig _config;
        private readonly Action<string, ToolTipIcon> _notify;
        private System.Threading.Timer? _timer;
        private int _busy; // 防止并发重入

        /// <summary>替换完成、新进程已拉起后触发, 宿主应尽快退出当前进程。</summary>
        public event Action? UpdateApplied;

        public UpdateService(AppConfig config, Action<string, ToolTipIcon> notify)
        {
            _config = config;
            _notify = notify;
        }

        public void Start()
        {
            CleanupOldExe();
            // 启动 10s 后首次检查(等待云端配置就绪), 之后每 30 分钟一次
            _timer = new System.Threading.Timer(_ => _ = RunOnceAsync(false), null, TimeSpan.FromSeconds(10), TimeSpan.FromMinutes(30));
        }

        public void Stop()
        {
            _timer?.Dispose();
            _timer = null;
        }

        /// <summary>手动检查(托盘菜单), 无论是否有更新都会给出提示。</summary>
        public Task CheckNowAsync() => RunOnceAsync(true);

        private async Task RunOnceAsync(bool manual)
        {
            if (!_config.AutoUpdateEnabled && !manual) return;
            if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return;

            string tmp = string.Empty;
            try
            {
                string? baseUrl = ResolveBaseUrl();
                if (baseUrl == null)
                {
                    if (manual) _notify(I18nService.T("UpdateNoServer"), ToolTipIcon.Warning);
                    return;
                }

                var resp = await Http.GetAsync($"{baseUrl}/api/agent/version").ConfigureAwait(false);
                resp.EnsureSuccessStatusCode();
                var json = JObject.Parse(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));

                string remoteMd5 = (json.Value<string>("md5") ?? json.Value<string>("MD5") ?? "").Trim().ToLowerInvariant();
                string downloadUrl = json.Value<string>("url") ?? json.Value<string>("downloadUrl") ?? "";
                if (string.IsNullOrEmpty(remoteMd5) || string.IsNullOrEmpty(downloadUrl))
                {
                    if (manual) _notify(I18nService.T("UpdateFailed", "empty md5/url"), ToolTipIcon.Error);
                    return;
                }

                string exe = Environment.ProcessPath ?? Application.ExecutablePath;
                if (ComputeFileMd5(exe) == remoteMd5)
                {
                    if (manual) _notify(I18nService.T("UpdateLatest"), ToolTipIcon.Info);
                    return;
                }

                if (!downloadUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                    !downloadUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                {
                    downloadUrl = $"{baseUrl}/{downloadUrl.TrimStart('/')}";
                }

                _notify(I18nService.T("UpdateFound"), ToolTipIcon.Info);

                tmp = exe + ".new";
                using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write))
                using (var stream = await Http.GetStreamAsync(downloadUrl).ConfigureAwait(false))
                {
                    await stream.CopyToAsync(fs).ConfigureAwait(false);
                }

                if (ComputeFileMd5(tmp) != remoteMd5)
                {
                    TryDelete(tmp);
                    _notify(I18nService.T("UpdateFailed", "MD5 mismatch"), ToolTipIcon.Error);
                    return;
                }

                // 运行中的 exe 允许改名、不允许覆盖: 先改名留档, 再放入新文件, 失败则回滚
                string oldExe = exe + ".old";
                TryDelete(oldExe);
                File.Move(exe, oldExe);
                try
                {
                    File.Move(tmp, exe);
                }
                catch
                {
                    File.Move(oldExe, exe);
                    throw;
                }

                Process.Start(new ProcessStartInfo(exe, "--updated") { UseShellExecute = true });
                UpdateApplied?.Invoke();
            }
            catch (Exception ex)
            {
                TryDelete(tmp);
                _notify(I18nService.T("UpdateFailed", ex.Message), ToolTipIcon.Error);
            }
            finally
            {
                Interlocked.Exchange(ref _busy, 0);
            }
        }

        private string? ResolveBaseUrl()
        {
            string raw = !string.IsNullOrWhiteSpace(_config.UpdateServerUrl) ? _config.UpdateServerUrl : _config.ServerUrl;
            if (string.IsNullOrWhiteSpace(raw)) return null;
            if (!Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var uri)) return null;
            string scheme = uri.Scheme.ToLowerInvariant() switch
            {
                "ws" => "http",
                "wss" => "https",
                "http" or "https" => uri.Scheme.ToLowerInvariant(),
                _ => ""
            };
            return scheme.Length == 0 ? null : $"{scheme}://{uri.Authority}";
        }

        /// <summary>清理上一次升级留下的 .old 文件。</summary>
        private static void CleanupOldExe()
        {
            string exe = Environment.ProcessPath ?? Application.ExecutablePath;
            TryDelete(exe + ".old");
        }

        private static string ComputeFileMd5(string path)
        {
            using var hash = MD5.Create();
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            return BitConverter.ToString(hash.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }
    }
}
