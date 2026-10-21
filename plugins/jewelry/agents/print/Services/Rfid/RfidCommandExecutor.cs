using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    /// <summary>
    /// 统一指令执行入口(唯一入口原则): 解析指令流 → 能力校验 → 套用设备档案 → 按 brand 取后端 → 执行。
    /// LocalHttpServer(/api/rfid/exec)、PrintDispatcher(rfid_cmd 任务)、CloudSyncService(device_cmd) 三方复用。
    /// </summary>
    public static class RfidCommandExecutor
    {
        // 品牌后端注册表: tspl/zpl 规划中, 后续在此注册
        static readonly Dictionary<string, IRfidBackend> Backends = new(StringComparer.OrdinalIgnoreCase)
        {
            ["zmin"] = new ZMinBackend()
        };

        public static string ProfileKey(string brand, string iface, string ip, string target)
            => $"{brand}|{(iface.Equals("NET", StringComparison.OrdinalIgnoreCase) ? ip : target)}";

        /// <summary>执行统一指令流; dryRun=true 只返回翻译预览。返回 (code 0成功/1失败, msg, data 回传值或预览文本)</summary>
        public static async Task<(int code, string msg, string? data)> ExecuteAsync(
            string brand, string iface, string ip, string target, string commands, int timeoutMs, bool dryRun)
        {
            brand = string.IsNullOrWhiteSpace(brand) ? "zmin" : brand.Trim();
            if (!Backends.TryGetValue(brand, out var backend))
                return (1, $"品牌 '{brand}' 后端尚未实现 (当前支持: {string.Join("/", Backends.Keys)}; tspl/zpl 规划中)", null);

            // 打印机/接口已固定: ZMIN X19D USB, 传入的 iface/ip 一律忽略
            iface = "USB";

            var (cmds, perr) = RfidCommandParser.Parse(commands);
            if (perr != null) return (1, perr, null);

            // 能力校验: 不在清单内的指令明确报错, 不静默忽略
            foreach (var c in cmds!)
            {
                string key = CapabilityKey(c);
                if (!backend.Supports(key))
                {
                    string reason = backend.UnsupportedReason(key) ?? $"{brand} 不支持 {key}";
                    return (1, $"第 {c.LineNo} 行: {reason}", null);
                }
            }

            var warnings = CollectReadOrderWarnings(cmds!);
            string warnPrefix = warnings.Count > 0 ? "警告: " + string.Join("; ", warnings) + " | " : "";

            var spec = new TransportSpec { Interface = iface, Ip = "", Target = target ?? "" };
            if (dryRun)
                return (0, warnPrefix + "dryRun 翻译预览(未发送打印机)", backend.TranslatePreview(cmds!, spec));

            var (ok, msg, data) = await backend.ExecuteAsync(cmds!, spec, timeoutMs);
            return (ok ? 0 : 1, warnPrefix + msg, data);
        }

        /// <summary>能力清单: 支持指令 + 不支持原因 + USB 配网说明, 供业务端按能力生成模板</summary>
        public static object Capabilities(string brand)
        {
            brand = string.IsNullOrWhiteSpace(brand) ? "zmin" : brand.Trim();
            if (!Backends.TryGetValue(brand, out var b))
                return new { code = 1, msg = $"品牌 '{brand}' 后端尚未实现 (当前支持: {string.Join("/", Backends.Keys)})" };

            return new
            {
                code = 0,
                data = new
                {
                    brand,
                    ops = b.SupportedOps,
                    unsupported = new Dictionary<string, string?>
                    {
                        ["BACKFEED"] = b.UnsupportedReason("BACKFEED"),
                        ["IP.static"] = b.UnsupportedReason("IP.static"),
                        ["IP.dhcp"] = b.UnsupportedReason("IP.dhcp")
                    },
                    configOverUsb = brand == "zmin"
                        ? "ZMIN 免驱 USB 可直接执行 IP query/RQ/CAL/PWR/RD/RW: 新机器开箱只插 USB 即可配网与校准"
                        : "该品牌无免驱 USB 配置通道, 设备配置仅 NET 可用",
                    channels = new[] { "USB", "NET" }
                }
            };
        }

        static string CapabilityKey(RfidCommand c) => c.Op switch
        {
            "IP" => "IP." + c.Arg(0, "query").ToLowerInvariant(),
            "CAL" => "CAL." + c.Arg(0, "paper").ToLowerInvariant(),
            _ => c.Op
        };

        /// <summary>回读顺序校验(警告不阻断): PRINT 走纸后标签离开天线区, RD/RTID 置于 PRINT 之后会读到下一张</summary>
        static List<string> CollectReadOrderWarnings(List<RfidCommand> cmds)
        {
            var w = new List<string>();
            int printLine = -1;
            foreach (var c in cmds)
                if (c.Op == "PRINT") printLine = Math.Max(printLine, c.LineNo);
            if (printLine < 0) return w;
            foreach (var c in cmds)
                if ((c.Op == "RD" || c.Op == "RTID") && c.LineNo > printLine)
                    w.Add($"第 {c.LineNo} 行 {c.Op} 位于 PRINT(第 {printLine} 行)之后, 走纸后将读到下一张标签; 回读应置于 RF 与 PRINT 之间");
            return w;
        }
    }
}
