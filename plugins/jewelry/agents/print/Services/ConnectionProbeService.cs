using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    /// <summary>单台打印机连接巡检结果（ok=链路可达，非打印可用性承诺）。</summary>
    public class PrnStatus
    {
        public bool Ok { get; set; }
        public string Ts { get; set; } = "";
        public int Ms { get; set; }
        public string Detail { get; set; } = "";
    }

    /// <summary>
    /// 打印机连接巡检：定时（默认 60s）对本机可见打印机做链路级探测，不打任何打印/写芯指令。
    /// - USB = 免驱 SDK 主板 SN 枚举（不开端口，避免与打印任务争用 USB 链路）
    /// - BT  = SPP 虚拟串口在位（SERIALCOMM）
    /// - NET = TCP 9100 连接测试
    /// - DRIVER = Windows 打印队列在列
    /// 结果存内存 + status.json（exe 目录），GET/POST /api/printer-status 读取/立即巡检。
    /// </summary>
    public static class ConnectionProbeService
    {
        private static readonly object _lock = new object();
        private static Dictionary<string, PrnStatus> _status = new Dictionary<string, PrnStatus>();
        private static System.Threading.Timer? _timer;
        private static int _running;
        /// <summary>云端指派的额外探测目标（brand|iface|ip|name），config 推送/前端注册时补充。</summary>
        private static readonly List<(string brand, string iface, string ip, string name)> _extra = new();

        public static string StatusFile => Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "status.json");

        public static void Start(int intervalSeconds = 60)
        {
            Load();
            ProbeOnce(); // 启动即巡检一轮
            _timer = new System.Threading.Timer(_ => ProbeOnce(), null, intervalSeconds * 1000, intervalSeconds * 1000);
        }

        /// <summary>登记云端指派目标（如 NET 打印机 IP），下轮巡检覆盖。</summary>
        public static void RegisterTarget(string brand, string iface, string ip, string name)
        {
            if (string.IsNullOrWhiteSpace(iface)) return;
            lock (_lock)
            {
                var item = (brand ?? "zmin", iface.ToUpperInvariant(), ip ?? "", name ?? "");
                if (!_extra.Contains(item)) _extra.Add(item);
            }
        }

        public static Dictionary<string, PrnStatus> Snapshot()
        {
            lock (_lock) return new Dictionary<string, PrnStatus>(_status);
        }

        public static void ProbeOnce()
        {
            if (Interlocked.Exchange(ref _running, 1) == 1) return; // 上一轮未结束跳过
            try
            {
                var sw = Stopwatch.StartNew();
                var next = new Dictionary<string, PrnStatus>();
                var devices = PrinterDiscoveryService.GetAllLocalPrinters();
                foreach (var d in devices)
                {
                    var key = RfidCommandExecutor.ProfileKey(
                        string.IsNullOrEmpty(d.Brand) ? "" : d.Brand,
                        d.Interface, d.Interface == "NET" ? d.Address.Split(':').FirstOrDefault() ?? "" : "", d.Name);
                    next[key] = new PrnStatus { Ok = d.Online, Ts = Now(), Ms = (int)sw.ElapsedMilliseconds, Detail = d.Detail };
                }
                // 云端指派的额外目标（本机枚举之外的 NET IP 等）
                List<(string brand, string iface, string ip, string name)> extras;
                lock (_lock) extras = _extra.ToList();
                foreach (var (brand, iface, ip, name) in extras)
                {
                    var key = RfidCommandExecutor.ProfileKey(brand, iface, ip, name);
                    if (next.ContainsKey(key)) continue;
                    if (iface == "NET" && !string.IsNullOrWhiteSpace(ip))
                    {
                        var p = Stopwatch.StartNew();
                        bool ok = TcpProbe(ip, 9100, 1500);
                        p.Stop();
                        next[key] = new PrnStatus { Ok = ok, Ts = Now(), Ms = (int)p.ElapsedMilliseconds,
                            Detail = ok ? "TCP 9100 可达" : "TCP 9100 不可达" };
                    }
                    else
                    {
                        // USB/BT 按名称模糊匹配本机枚举结果（如 ZMIN_USB_SN / BT_SPP_COM6）
                        var hit = devices.FirstOrDefault(d =>
                            (iface == "USB" && d.Interface == "USB" && (name == "" || d.Name.Contains(name, StringComparison.OrdinalIgnoreCase)))
                            || (iface == "BT" && d.Interface == "BT" && (name == "" || d.Name.Contains(name, StringComparison.OrdinalIgnoreCase))));
                        next[key] = new PrnStatus { Ok = hit != null, Ts = Now(), Ms = 0,
                            Detail = hit != null ? hit.Detail : "本机枚举未发现该设备" };
                    }
                }
                lock (_lock) _status = next;
                Save();
            }
            catch { /* 巡检失败静默，下轮重试 */ }
            finally { Interlocked.Exchange(ref _running, 0); }
        }

        private static bool TcpProbe(string ip, int port, int timeoutMs)
        {
            try
            {
                using var c = new System.Net.Sockets.TcpClient();
                var t = c.ConnectAsync(ip, port);
                return t.Wait(timeoutMs) && c.Connected;
            }
            catch { return false; }
        }

        private static string Now() => DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");

        private static void Save()
        {
            try
            {
                lock (_lock)
                    File.WriteAllText(StatusFile, JsonSerializer.Serialize(_status,
                        new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
            }
            catch { }
        }

        private static void Load()
        {
            try
            {
                if (File.Exists(StatusFile))
                {
                    var j = JsonSerializer.Deserialize<Dictionary<string, PrnStatus>>(File.ReadAllText(StatusFile));
                    if (j != null) lock (_lock) _status = j;
                }
            }
            catch { }
        }
    }
}
