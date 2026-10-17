using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
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

            iface = string.IsNullOrWhiteSpace(iface) ? "USB" : iface.Trim().ToUpperInvariant();
            if (iface != "USB" && iface != "NET" && iface != "BT")
                return (1, $"统一指令通道仅支持 USB/NET/BT (当前: {iface})", null);
            if (iface == "NET" && !IPAddress.TryParse(ip, out _))
                return (1, $"打印机 IP 格式无效: '{ip}'", null);
            if (iface == "BT" && !(target ?? "").Trim().StartsWith("COM", StringComparison.OrdinalIgnoreCase))
                return (1, "BT 通道需在 name/target 填蓝牙虚拟串口号(如 COM6, 设备管理器→蓝牙→标准串行SPP出向端口)", null);

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

            // 套用设备档案(缺 L/S/PWR 时补默认); L 优先级: 显式 L > 绑定标签纸 > 档案 W/H
            var cfg = AppConfig.Load();
            cfg.DeviceProfiles.TryGetValue(ProfileKey(brand, iface, ip, target), out var profile);

            var warnings = new List<string>();
            LabelPaper? paper = null;
            if (!string.IsNullOrWhiteSpace(profile?.LabelPaperId))
            {
                paper = LabelPaperStore.Find(profile.LabelPaperId);
                if (paper == null) warnings.Add($"档案绑定的标签纸 '{profile.LabelPaperId}' 不存在于形状库, 已忽略");
            }

            var merged = ApplyProfile(cmds!, profile, paper);
            if (paper != null) warnings.AddRange(CollectLayoutWarnings(merged, paper));
            warnings.AddRange(CollectReadOrderWarnings(merged));
            string warnPrefix = warnings.Count > 0 ? "警告: " + string.Join("; ", warnings) + " | " : "";

            var spec = new TransportSpec { Interface = iface, Ip = ip ?? "", Target = target ?? "" };
            if (dryRun)
                return (0, warnPrefix + "dryRun 翻译预览(未发送打印机)", backend.TranslatePreview(merged, spec, profile));

            var (ok, msg, data) = await backend.ExecuteAsync(merged, spec, profile, timeoutMs);
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

        /// <summary>指令流缺 L/S/PWR 时补齐: L 用绑定标签纸优先, 否则用档案; 插入到首条 N 之后</summary>
        static List<RfidCommand> ApplyProfile(List<RfidCommand> cmds, DeviceProfile? p, LabelPaper? paper)
        {
            if (p == null && paper == null) return cmds;
            var synth = new List<RfidCommand>();
            bool Has(string op) => cmds.Any(c => c.Op == op);

            if (!Has("L"))
            {
                if (paper != null && paper.Width > 0 && paper.Height > 0)
                    synth.Add(Mk("L", $"{paper.Width},{paper.Height},{paper.Gap}"));
                else if (p?.Width is > 0 && p?.Height is > 0)
                    synth.Add(Mk("L", $"{p.Width},{p.Height},{p.Gap ?? 2}"));
            }
            if (p != null)
            {
                if ((p.Speed is > 0 || p.Darkness is > 0) && !Has("S"))
                    synth.Add(Mk("S", $"{p.Speed ?? 4},{p.Darkness ?? 10},{p.Dpi ?? 203}"));
                if ((p.ReadPower is > 0 || p.WritePower is > 0) && !Has("PWR"))
                    synth.Add(Mk("PWR", $"{p.ReadPower ?? 15},{p.WritePower ?? 20}"));
            }
            if (synth.Count == 0) return cmds;

            int idx = cmds.FindIndex(c => c.Op == "N");
            idx = idx < 0 ? 0 : idx + 1;
            var res = new List<RfidCommand>(cmds);
            res.InsertRange(idx, synth);
            return res;
        }

        /// <summary>可打印区域/天线校验(警告不阻断): T/B 锚点越界或压住 inlay 时收集提示</summary>
        static List<string> CollectLayoutWarnings(List<RfidCommand> cmds, LabelPaper paper)
        {
            var w = new List<string>();
            double x1 = paper.MarginLeft, x2 = paper.Width - paper.MarginRight;
            double y1 = paper.MarginTop, y2 = paper.Height - paper.MarginBottom;
            foreach (var c in cmds)
            {
                if (c.Op != "T" && c.Op != "B") continue;
                double x = c.ArgD(0), y = c.ArgD(1);
                if (x < x1 || x > x2 || y < y1 || y > y2)
                    w.Add($"第 {c.LineNo} 行 {c.Op} 锚点({x}mm,{y}mm)超出可打印区域[{x1}~{x2}]×[{y1}~{y2}]");
                if (paper.AntennaW > 0 && paper.AntennaH > 0
                    && Math.Abs(x - paper.AntennaX) <= paper.AntennaW / 2 && Math.Abs(y - paper.AntennaY) <= paper.AntennaH / 2)
                    w.Add($"第 {c.LineNo} 行 {c.Op} 锚点疑似压住天线/inlay 区(中心 {paper.AntennaX},{paper.AntennaY},尺寸 {paper.AntennaW}×{paper.AntennaH})");
            }
            return w;
        }

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

        static RfidCommand Mk(string op, string args) => new RfidCommand
        {
            Op = op,
            Raw = op + " " + args + "  <设备档案>",
            Args = args.Split(',').Select(a => a.Trim()).ToList(),
            LineNo = 0
        };
    }
}
