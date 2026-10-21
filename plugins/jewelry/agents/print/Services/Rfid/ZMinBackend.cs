using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    /// <summary>
    /// 致明兴 ZMIN 后端: 统一指令 → PCLE。
    /// USB 走 ZMPCLx64 免驱通道(排版 SendRaw / 回读 ZM_GetData_USB / 校准 DLL 函数),
    /// NET 排版走 SDK 透传(SendRawCommands), 需回读的 RD/RQ 走 TCP 9100 socket。
    /// 能力边界: PCLE 无退纸指令、无静态IP设置指令; 纸校准仅 USB。
    /// </summary>
    public class ZMinBackend : IRfidBackend
    {
        public string Brand => "zmin";

        public string[] SupportedOps => new[]
        {
            "N", "L", "S", "T", "B", "RF", "RD", "RTID", "FEED",
            "CAL.paper", "CAL.rfid", "PWR", "IP.query", "IP.feedback", "RQ", "PRINT", "CONFIG", "TEST", "LINE", "BOX"
        };

        public string? UnsupportedReason(string key) => key switch
        {
            "BACKFEED" => "zmin 不支持 BACKFEED: PCLE 无退纸指令(可用 FEED 循环走纸近似)",
            "IP.static" => "zmin: 静态IP请用统一指令 CONFIG ip,地址[,掩码[,网关]] 设置(#UM>IA/MK/GT, NV 持久); PCLE 原生无此指令",
            "IP.dhcp" => "zmin 不支持 IP dhcp: PCLE/#UM 私有指令集均无 DHCP 模式切换指令, 仅支持 CONFIG ip 设静态参数",
            _ => null
        };

        public string TranslatePreview(IReadOnlyList<RfidCommand> cmds, TransportSpec spec)
        {
            double dpm = ResolveDpi(cmds) / 25.4;
            var sb = new StringBuilder();
            foreach (var c in cmds) AppendTranslate(c, dpm, spec, sb);
            return sb.ToString();
        }

        public async Task<(bool ok, string msg, string? readData)> ExecuteAsync(
            IReadOnlyList<RfidCommand> cmds, TransportSpec spec, int timeoutMs)
        {
            double dpm = ResolveDpi(cmds) / 25.4;
            var reads = new List<string>();
            var layout = new StringBuilder();
            var pendingReads = new List<string>(); // 本任务缓冲内 RD 的标签名, W 执行后经反馈口回传
            string? err = null;

            // expectFeedback=true: 任务含 RD, 发送后读回反馈数据(USB: ZM_GetData_USB / NET: socket)
            async Task<(bool ok, string? resp)> FlushAsync(bool expectFeedback)
            {
                if (layout.Length == 0) return (true, null);
                string text = layout.ToString();
                layout.Clear();
                int wait = Math.Max(15000, timeoutMs);
                if (spec.IsUsb)
                {
                    if (expectFeedback)
                    {
                        var (ok, msg, data) = UsbPcleService.SendRawWithFeedback(text, wait);
                        if (!ok) { err = msg; return (false, null); }
                        return (true, data);
                    }
                    var (ok2, msg2) = UsbPcleService.SendRaw(text);
                    if (!ok2) { err = msg2; return (false, null); }
                    return (true, null);
                }
                else
                {
                    if (expectFeedback)
                    {
                        var (ok, msg, resp) = await RfidTransport.TcpSendReceiveAsync(spec.Ip, spec.Port, text, wait);
                        if (!ok) { err = msg; return (false, null); }
                        return (true, resp);
                    }
                    var (ok2, msg2) = new ZMinRfidService().SendRawCommands(text, "NET", spec.Ip, spec.Target);
                    if (!ok2) { err = msg2; return (false, null); }
                    return (true, null);
                }
            }

            void AddReadFeedback(string? resp)
            {
                foreach (var label in pendingReads)
                {
                    if (resp == null) { reads.Add($"{label}=(无反馈数据)"); continue; }
                    string? hex = ExtractHex(resp, label == "TID" ? 8 : 12);
                    reads.Add(hex != null ? $"{label}={hex}" : $"{label}=<原文>{resp}");
                }
                pendingReads.Clear();
            }

            foreach (var c in cmds)
            {
                switch (c.Op)
                {
                    case "RD":
                    case "RTID":
                    {
                        // 实测 X19D: 任务缓冲内的 RD 会卡死固件(RF 写入挂起、灯闪不出纸),
                        // USB 通道改为打印完成后在天线位独立读取(读到的是走纸后停在天线上的标签);
                        // BT/NET 保持手册原义随缓冲下发(未经真机验证, 风险自负)
                        int r = c.Op == "RTID" ? 0 : RegionOf(c.Arg(0, "epc"));
                        pendingReads.Add(r switch { 0 => "TID", 2 => "EPC+TID", _ => "EPC" });
                        if (!spec.IsUsb) AppendTranslate(c, dpm, spec, layout);
                        break;
                    }

                    case "RQ":
                    {
                        if (!(await FlushAsync(false)).ok) return (false, err ?? "排版指令发送失败", Summarize(reads));
                        int n = c.ArgInt(0, 1);
                        if (spec.IsUsb)
                        {
                            var (ok, msg) = UsbPcleService.QueryInfo(n);
                            if (!ok) return (false, msg, Summarize(reads));
                            reads.Add($"RQ{n}={msg}");
                        }
                        else
                        {
                            var (ok, msg, resp) = await RfidTransport.TcpSendReceiveAsync(
                                spec.Ip, spec.Port, $"RQ2,{n}\r\n", timeoutMs);
                            if (!ok) return (false, msg, Summarize(reads));
                            reads.Add($"RQ{n}={resp ?? "(无回传)"}");
                        }
                        break;
                    }

                    case "IP":
                    {
                        string sub = c.Arg(0, "query").ToLowerInvariant();
                        if (sub == "query")
                        {
                            if (!(await FlushAsync(false)).ok) return (false, err ?? "排版指令发送失败", Summarize(reads));
                            if (spec.IsUsb)
                            {
                                var (ok, msg) = UsbPcleService.QueryInfo(3); // 3=网络 IP/掩码/网关/MAC
                                if (!ok) return (false, msg, Summarize(reads));
                                reads.Add($"网络参数={msg}");
                            }
                            else
                            {
                                var (ok, msg, resp) = await RfidTransport.TcpSendReceiveAsync(
                                    spec.Ip, spec.Port, "RQ2,3\r\n", timeoutMs);
                                if (!ok) return (false, msg, Summarize(reads));
                                reads.Add($"网络参数={resp ?? "(无回传)"}");
                            }
                        }
                        else if (sub == "feedback")
                        {
                            // IP feedback 口,目标IP[,协议 0=UDP 1=TCP] → NB{口},{IP},{协议}
                            string tip = c.Arg(2, "");
                            if (string.IsNullOrWhiteSpace(tip))
                                return (false, $"第 {c.LineNo} 行 IP feedback 缺少目标IP", Summarize(reads));
                            layout.Append($"NB{c.ArgInt(1, 1)},{tip},{c.ArgInt(3, 1)}\r\n");
                        }
                        else return (false, UnsupportedReason("IP." + sub) ?? $"不支持 IP {sub}", Summarize(reads));
                        break;
                    }

                    case "CAL":
                    {
                        string sub = c.Arg(0, "paper").ToLowerInvariant();
                        if (sub == "paper")
                        {
                            if (!spec.IsUsb)
                                return (false, $"第 {c.LineNo} 行 CAL paper 仅支持 USB 通道(ZM_MediaDetect), NET/BT 不支持", Summarize(reads));
                            if (!(await FlushAsync(false)).ok) return (false, err ?? "排版指令发送失败", Summarize(reads));
                            var (ok, msg) = UsbPcleService.PaperCalibrate();
                            if (!ok) return (false, msg, Summarize(reads));
                            reads.Add("纸校准完成");
                        }
                        else if (c.Arg(1, "").Equals("manual", StringComparison.OrdinalIgnoreCase))
                        {
                            // CAL rfid,manual,[芯片距离mm],[错误标识偏移mm],[重试次数] → ZM_SetRFIDPosition (USB only)
                            if (!spec.IsUsb)
                                return (false, $"第 {c.LineNo} 行 CAL rfid manual 仅支持 USB 通道(ZM_SetRFIDPosition), NET/BT 不支持", Summarize(reads));
                            if (!(await FlushAsync(false)).ok) return (false, err ?? "排版指令发送失败", Summarize(reads));
                            var (ok, msg) = UsbPcleService.SetRfidPosition(c.ArgInt(2, 0), c.ArgInt(3, 0), c.ArgInt(4, 1));
                            if (!ok) return (false, msg, Summarize(reads));
                            reads.Add(msg);
                        }
                        else // rfid: USB 走 DLL 自动校准, NET 下发 RM
                        {
                            if (!(await FlushAsync(false)).ok) return (false, err ?? "排版指令发送失败", Summarize(reads));
                            if (spec.IsUsb)
                            {
                                var (ok, msg) = UsbPcleService.RfidCalibrate();
                                if (!ok) return (false, msg, Summarize(reads));
                                reads.Add("RFID天线校准完成");
                            }
                            else
                            {
                                var (ok, msg, _) = await RfidTransport.TcpSendReceiveAsync(
                                    spec.Ip, spec.Port, "RM\r\n", timeoutMs);
                                if (!ok) return (false, msg, Summarize(reads));
                                reads.Add("RM 天线校准已下发(约30秒)");
                            }
                        }
                        break;
                    }

                    case "PWR":
                    {
                        int rp = c.ArgInt(0, 15), wp = c.ArgInt(1, 20);
                        if (spec.IsUsb)
                        {
                            if (!(await FlushAsync(false)).ok) return (false, err ?? "排版指令发送失败", Summarize(reads));
                            var (ok, msg) = UsbPcleService.SetRfPower(rp, wp);
                            if (!ok) return (false, msg, Summarize(reads));
                            reads.Add(msg);
                        }
                        else layout.Append($"RW{rp},{wp}\r\n"); // NET: PCLE RW 指令随排版流下发
                        break;
                    }

                    case "BACKFEED":
                        return (false, UnsupportedReason("BACKFEED")!, Summarize(reads));

                    case "PRINT":
                    {
                        AppendTranslate(c, dpm, spec, layout); // W{n}: RF 随本任务执行
                        // USB: RD 不进任务缓冲(会卡死固件), 打印后在天线位独立读
                        var (ok, resp) = await FlushAsync(pendingReads.Count > 0 && !spec.IsUsb);
                        if (!ok) return (false, err ?? "打印任务发送失败", Summarize(reads));
                        if (pendingReads.Count > 0)
                        {
                            if (spec.IsUsb)
                            {
                                foreach (var label in pendingReads)
                                {
                                    var regions = label == "EPC+TID" ? new[] { "EPC", "TID" } : new[] { label };
                                    foreach (var rname in regions)
                                    {
                                        int region = rname == "TID" ? 0 : 1;
                                        var (rok, rmsg, rdata) = UsbPcleService.ReadTag(region, 0);
                                        reads.Add(rok ? $"{rname}={rdata}" : $"{rname}=读取失败({rmsg})");
                                    }
                                }
                                pendingReads.Clear();
                            }
                            else AddReadFeedback(resp);
                        }
                        break;
                    }

                    case "CONFIG": // CONFIG tear,<mm> = 撕纸位置(私有指令 #UM>FD{点}, NV 持久); 留空 = 打印配置页
                    {
                        if (c.Arg(0, "").Equals("tear", StringComparison.OrdinalIgnoreCase))
                        {
                            if (!(await FlushAsync(false)).ok) return (false, err ?? "排版指令发送失败", Summarize(reads));
                            int dots = (int)Math.Round(c.ArgD(1) * dpm);
                            string priv = $"#UM>FD{dots}\r\n";
                            if (spec.IsUsb)
                            {
                                var (ok, msg) = UsbPcleService.SendRaw(priv);
                                if (!ok) return (false, msg, Summarize(reads));
                            }
                            else
                            {
                                var (ok, msg) = new ZMinRfidService().SendRawCommands(priv, "NET", spec.Ip, spec.Target);
                                if (!ok) return (false, msg, Summarize(reads));
                            }
                            reads.Add($"撕纸位置已设置: {c.ArgD(1)}mm = FD{dots} 点(#UM>FD, 打印机持久保存)");
                        }
                        else if (c.Arg(0, "").Equals("ip", StringComparison.OrdinalIgnoreCase))
                        {
                            // CONFIG ip,地址[,掩码[,网关]] → #UM>IA/MK/GT (LabelSoft 逆向, NV 持久)
                            string ip = c.Arg(1, "");
                            if (ip.Length < 7 || !ip.All(ch => char.IsDigit(ch) || ch == '.'))
                                return (false, $"第 {c.LineNo} 行 CONFIG ip 参数须为 ip地址[,掩码[,网关]], 如 CONFIG ip,192.168.1.180,255.255.255.0,192.168.1.1", Summarize(reads));
                            string mask = c.Arg(2, "255.255.255.0");
                            string gw = c.Arg(3, "");
                            if (gw.Length == 0)
                            {
                                var o = ip.Split('.');
                                gw = o.Length == 4 ? $"{o[0]}.{o[1]}.{o[2]}.1" : ip;
                            }
                            string priv = $"#UM>IA{ip}\r\n#UM>MK{mask}\r\n#UM>GT{gw}\r\n";
                            bool sameChannel = !spec.IsUsb && spec.Ip == ip; // NET 改本通道 IP: 重启后本通道地址才变
                            if (spec.IsUsb)
                            {
                                var (ok, msg) = UsbPcleService.SendRaw(priv);
                                if (!ok) return (false, msg, Summarize(reads));
                            }
                            else
                            {
                                var (ok, msg) = new ZMinRfidService().SendRawCommands(priv, "NET", spec.Ip, spec.Target);
                                if (!ok) return (false, msg, Summarize(reads));
                            }
                            reads.Add($"IP 已写入打印机存储: {ip} 掩码 {mask} 网关 {gw} (#UM>IA/MK/GT, NV 持久)。重启打印机后生效, 生效前活动 IP 保持原值"
                                + (sameChannel ? $", 重启后本通道地址才变为 {ip}, 之后 NET 调用改用新地址" : ""));
                        }
                        else AppendTranslate(c, dpm, spec, layout); // 配置页 U
                        break;
                    }

                    default:
                        AppendTranslate(c, dpm, spec, layout);
                        break;
                }
            }

            {
                var (ok, resp) = await FlushAsync(pendingReads.Count > 0);
                if (!ok) return (false, err ?? "指令发送失败", Summarize(reads));
                if (pendingReads.Count > 0)
                {
                    AddReadFeedback(resp);
                    if (resp == null) reads.Add("提示: RD 未随 PRINT 执行则不会回传(RF/RD 在 W 命令时才处理)");
                }
            }
            return (true, reads.Count > 0 ? "执行成功" : $"执行成功 ({cmds.Count} 条指令)", Summarize(reads));
        }

        // ---------- PCLE 翻译 ----------

        /// <summary>PCLE 反馈口参数: 1=USB 2=LAN</summary>
        static int FeedbackPort(TransportSpec spec) => spec.IsUsb ? 1 : 2;

        void AppendTranslate(RfidCommand c, double dpm, TransportSpec spec, StringBuilder sb)
        {
            int D(double mm) => (int)Math.Round(mm * dpm);
            switch (c.Op)
            {
                case "N":
                    sb.Append("N\r\n");
                    break;
                case "TEST": // TEST bounds,<宽mm>,<高mm> → 边界测试页: 四边极限线+底部每10mm刻度, 实物看可打印区域
                {
                    double w = c.ArgD(1, 0), h = c.ArgD(2, 0);
                    int W = D(w) - 1, H = D(h) - 1;
                    // 四边框: 左/右极限竖线 + 顶/底横线 (打不完整的边=物理打印头打不到)
                    sb.Append($"LO0,0,0,{H}\r\nLO{W},0,{W},{H}\r\nLO0,0,{W},0\r\nLO0,{H},{W},{H}\r\n");
                    // 底部刻度: 每10mm 短竖线, 每20mm 标数字
                    for (int mm = 10; mm < (int)w - 2; mm += 10)
                    {
                        int x = D(mm);
                        sb.Append($"LO{x},{H - 8},{x},{H}\r\n");
                        if (mm % 20 == 0) sb.Append($"T{x + 2},{H - 24},0,1,1,1,N,\"{mm}\"\r\n");
                    }
                    break;
                }
                case "L": // 标签尺寸 mm→点: q宽 / Q高,间隙
                    sb.Append($"q{D(c.ArgD(0))}\r\nQ{D(c.ArgD(1))},{D(c.ArgD(2, 2))}\r\n");
                    break;
                case "LINE": // LINE x1,y1,x2,y2(mm) → LO 画线
                    sb.Append($"LO{D(c.ArgD(0))},{D(c.ArgD(1))},{D(c.ArgD(2))},{D(c.ArgD(3))}\r\n");
                    break;
                case "BOX": // BOX x1,y1,x2,y2(mm) → LE 实心填充块(粗条/色块)
                    sb.Append($"LE{D(c.ArgD(0))},{D(c.ArgD(1))},{D(c.ArgD(2))},{D(c.ArgD(3))}\r\n");
                    break;
                case "S": // 速度 + 黑度 (PCLE S 单位=0.1英寸/秒, 手册示例 S40; 统一层传 1-14 档时 ×10)
                {
                    int sp = c.ArgInt(0, 4);
                    sb.Append($"S{(sp <= 14 ? sp * 10 : sp)}\r\nH{c.Arg(1, "10")}\r\n");
                    break;
                }
                case "CONFIG": // 留空 = 配置页; tear/ip 由 ExecuteAsync 独立发送, 预览仅展示
                {
                    if (c.Arg(0, "").Equals("tear", StringComparison.OrdinalIgnoreCase))
                        sb.Append($"#UM>FD{(int)Math.Round(c.ArgD(1) * dpm)}\r\n");
                    else if (c.Arg(0, "").Equals("ip", StringComparison.OrdinalIgnoreCase))
                        sb.Append($"#UM>IA{c.Arg(1, "?")}\r\n#UM>MK{c.Arg(2, "255.255.255.0")}\r\n#UM>GT{c.Arg(3, "?")}\r\n");
                    else
                        sb.Append("U\r\n");
                    break;
                }
                case "T": // T x,y,rot,fontId,xmult,ymult,"文本" (无空格; 含中文自动用24*24点阵字体 a)
                {
                    string text = c.Quoted ?? "";
                    string font = text.Any(ch => ch > 127) ? "a" : c.Arg(3, "2");
                    sb.Append($"T{D(c.ArgD(0))},{D(c.ArgD(1))},{c.Arg(2, "0")},{font},{c.ArgInt(4, 1)},{c.ArgInt(5, 1)},N,\"{text}\"\r\n");
                    break;
                }
                case "B": // 统一 B x,y,高mm,窄bar mm,文字位,码制,"内容" → PCLE B x,y,rot,type,narrow,wide,height,human,"data" (无空格)
                    if (c.Arg(5, "6").Equals("QR", StringComparison.OrdinalIgnoreCase))
                    {
                        // PCLE 二维码: bx,y,QR,w,v,o{旋转},r{放大1-9},m{编码模式},g{纠错},s{掩模},"data"; w/v=0 自动尺寸
                        int mag = Math.Clamp(c.ArgInt(3, 5), 1, 9);
                        sb.Append($"b{D(c.ArgD(0))},{D(c.ArgD(1))},QR,0,0,o0,r{mag},m2,g0,s8,\"{c.Quoted ?? ""}\"\r\n");
                    }
                    else
                    {
                        int narrow = Math.Max(1, D(c.ArgD(3, 0.4)));
                        string type = BarTypeOf(c.Arg(5, "6"));
                        string human = c.ArgInt(4, 1) == 1 ? "B" : "N"; // B=带可读字符(手册示例), N=不带
                        sb.Append($"B{D(c.ArgD(0))},{D(c.ArgD(1))},0,{type},{narrow},{narrow * 2},{D(c.ArgD(2, 10))},{human},\"{c.Quoted ?? ""}\"\r\n");
                    }
                    break;
                case "RF": // RF block,mode,len,"DATA" → PCLE RF1,{mode},{起始},{字节},{区},"..."; mode=1 时 DATA 为 hex 文本(如 BCD 时间)
                {
                    int block = c.ArgInt(0, 0), mode = c.ArgInt(1, 0);
                    string data = c.Quoted ?? "";
                    if (block == 0)
                    {
                        // EPC 区: 与真机验证序列一致 — 起始字节1, 前补 PC=0x3000(无锁定), DATA(hex文本)直接拼
                        // 真机验证: RF1,0,1,8,1,"3000202610171520" → 写入 BCD 字节 30 00 20 26 10 17 15 20
                        sb.Append($"RF1,0,1,{data.Length / 2 + 2},1,\"3000{data}\"\r\n");
                    }
                    else
                    {
                        // USER 区: 原样下发
                        sb.Append($"RF1,{mode},0,{c.ArgInt(2, 0)},3,\"{data}\"\r\n");
                    }
                    break;
                }
                case "RD":
                {
                    int r = RegionOf(c.Arg(0, "epc"));
                    sb.Append($"RD{r},{FeedbackPort(spec)},0,0\r\n");
                    break;
                }
                case "RTID":
                    sb.Append($"RD0,{FeedbackPort(spec)},0,0\r\n");
                    break;
                case "FEED": // PCLE 无走纸指令: n × (N + W1) 空走一张近似
                    for (int i = 0; i < Math.Max(1, c.ArgInt(0, 1)); i++) sb.Append("N\r\nW1\r\n");
                    break;
                case "BACKFEED":
                    sb.Append("# BACKFEED: PCLE 无退纸指令, 不支持\r\n");
                    break;
                case "CAL":
                    if (c.Arg(0, "paper").ToLowerInvariant() == "paper")
                        sb.Append("# CAL paper: 仅 USB 通道 ZM_MediaDetect(NET 不支持)\r\n");
                    else sb.Append("RM\r\n");
                    break;
                case "PWR":
                    sb.Append($"RW{c.ArgInt(0, 15)},{c.ArgInt(1, 20)}\r\n");
                    break;
                case "IP":
                {
                    string sub = c.Arg(0, "query").ToLowerInvariant();
                    switch (sub)
                    {
                        case "query": sb.Append($"RQ{FeedbackPort(spec)},3\r\n"); break;
                        case "feedback": sb.Append($"NB{c.ArgInt(1, 1)},{c.Arg(2, "<目标IP>")},{c.ArgInt(3, 1)}\r\n"); break;
                        default: sb.Append($"# IP {sub}: PCLE 无网络设置指令, 不支持\r\n"); break;
                    }
                    break;
                }
                case "RQ":
                    sb.Append($"RQ{FeedbackPort(spec)},{c.ArgInt(0, 1)}\r\n");
                    break;
                case "PRINT":
                    sb.Append($"W{Math.Max(1, c.ArgInt(0, 1))}\r\n");
                    break;
            }
        }

        static int RegionOf(string a) => a.ToLowerInvariant() switch { "tid" => 0, "both" => 2, _ => 1 };

        /// <summary>统一码制 → PCLE 条码类型码(手册 P4): 6/128→Code128 AUTO, 39→Code39, 2/ITF→交叉二五, 93→Code93, EAN13/UPCA</summary>
        static string BarTypeOf(string t) => t.ToLowerInvariant() switch
        {
            "6" or "128" or "1" => "1",
            "3" or "39" => "3",
            "2" or "itf" or "25" => "2",
            "9" or "93" => "9",
            "e30" or "ean13" => "E30",
            "ua0" or "upca" => "UA0",
            _ => "1"
        };

        static double ResolveDpi(IReadOnlyList<RfidCommand> cmds)
        {
            var s = cmds.FirstOrDefault(c => c.Op == "S" && c.Args.Count >= 3);
            if (s != null && double.TryParse(s.Args[2], out double dpi) && dpi > 0) return dpi;
            return 300; // 固定 ZMIN X19D 300dpi
        }

        static string? Summarize(List<string> reads)
            => reads.Count == 0 ? null : string.Join("; ", reads);

        static string? ExtractHex(string raw, int minLen)
        {
            var m = Regex.Match(raw, "[0-9A-Fa-f]{" + minLen + ",}");
            return m.Success ? m.Value.ToUpperInvariant() : null;
        }
    }
}
