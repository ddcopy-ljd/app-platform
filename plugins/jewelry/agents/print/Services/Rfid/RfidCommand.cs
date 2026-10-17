using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace PrintAgent.Services
{
    /// <summary>
    /// 统一 RFID 指令: 一行一条命令(类 PCLE), # 注释, 大小写不敏感, 逗号分隔参数, 行末引号串承载文本/条码内容/HEX 数据。
    /// 语法: N | L w,h,gap | S speed,darkness[,dpi] | T x,y,size,font,style,"文本" | B x,y,h,scale,textPos,type,"内容"
    ///       RF block,mode,len,"HEX" | RD [epc|tid|both] | RTID | FEED n | BACKFEED n | CAL paper|rfid
    ///       PWR read,write | IP query|static a,m,g|dhcp|feedback 口,ip[,协议] | RQ n | PRINT [份数]
    /// 坐标单位 mm, 由各品牌后端按 dpi 换算为点。
    /// </summary>
    public class RfidCommand
    {
        public string Op { get; set; } = string.Empty;   // 规范化大写操作名
        public List<string> Args { get; set; } = new();  // 逗号参数(引号串已剥离)
        public string? Quoted { get; set; }              // 行末引号字符串
        public int LineNo { get; set; }
        public string Raw { get; set; } = string.Empty;

        public string Arg(int i, string def = "") => i < Args.Count ? Args[i] : def;

        public int ArgInt(int i, int def)
            => i < Args.Count && int.TryParse(Args[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : def;

        public double ArgD(int i, double def = 0)
            => i < Args.Count && double.TryParse(Args[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : def;
    }

    public static class RfidCommandParser
    {
        static readonly HashSet<string> KnownOps = new(StringComparer.OrdinalIgnoreCase)
        { "N", "L", "S", "T", "B", "RF", "RD", "RTID", "FEED", "BACKFEED", "CAL", "PWR", "IP", "RQ", "PRINT", "CONFIG", "TEST", "LINE", "BOX" };

        /// <summary>解析统一指令流; 返回 (命令列表, 错误信息), 错误时列表为 null</summary>
        public static (List<RfidCommand>? cmds, string? error) Parse(string text)
        {
            var list = new List<RfidCommand>();
            if (string.IsNullOrWhiteSpace(text)) return (null, "指令流为空");

            var lines = text.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                line = StripTrailingComment(line);
                if (line.Length == 0) continue;

                var cmd = new RfidCommand { LineNo = i + 1, Raw = lines[i].Trim() };

                // 提取行末引号串(统一语法约定引号串总在末尾)
                string body = line;
                var m = Regex.Match(line, "\"([^\"]*)\"\\s*$");
                if (m.Success)
                {
                    cmd.Quoted = m.Groups[1].Value;
                    body = line[..m.Index].TrimEnd();
                    if (body.EndsWith(",")) body = body[..^1];
                }

                var parts = body.Split(',');
                string op = parts[0].Trim().ToUpperInvariant();
                // 兼容 "L 60,40,2" / "IP query" 等 操作名后空格分隔 的写法
                List<string> args = new();
                if (op.Contains(' '))
                {
                    var sp = op.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                    op = sp[0];
                    string rest = body.Trim();
                    rest = rest[sp[0].Length..].Trim().TrimStart(',').Trim();
                    if (rest.Length > 0) args.AddRange(rest.Split(new[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries));
                }
                else
                {
                    for (int p = 1; p < parts.Length; p++) args.Add(parts[p].Trim());
                }
                if (!KnownOps.Contains(op))
                    return (null, $"第 {i + 1} 行未知指令 '{op}' (支持: N L S T B RF RD RTID FEED BACKFEED CAL PWR IP RQ PRINT)");
                cmd.Op = op;
                cmd.Args = args;

                string? verr = Validate(cmd);
                if (verr != null) return (null, verr);
                list.Add(cmd);
            }
            if (list.Count == 0) return (null, "指令流为空(只有注释)");
            return (list, null);
        }

        static string? Validate(RfidCommand c)
        {
            switch (c.Op)
            {
                case "T":
                case "B":
                case "RF":
                    if (c.Quoted == null) return $"第 {c.LineNo} 行 {c.Op} 缺少行末引号串";
                    break;
                case "CAL":
                {
                    string sub = c.Arg(0, "paper").ToLowerInvariant();
                    if (sub != "paper" && sub != "rfid") return $"第 {c.LineNo} 行 CAL 参数须为 paper|rfid";
                    if (sub == "rfid" && c.Args.Count >= 2 && !c.Arg(1, "").Equals("manual", StringComparison.OrdinalIgnoreCase))
                        return $"第 {c.LineNo} 行 CAL rfid 第二参数须为 manual (格式: CAL rfid,manual,芯片距离mm,错误标识偏移mm,重试次数)";
                    break;
                }
                case "CONFIG":
                {
                    string sub = c.Arg(0, "").ToLowerInvariant();
                    if (c.Args.Count > 0 && sub != "tear" && sub != "ip")
                        return $"第 {c.LineNo} 行 CONFIG 参数须为 tear,<mm> (撕纸位置) / ip,地址[,掩码[,网关]] / 留空(打印配置页)";
                    if (sub == "tear")
                    {
                        var mm = c.ArgD(1, -1);
                        if (mm < 0 || mm > 999) return $"第 {c.LineNo} 行 CONFIG tear 撕纸位置须为 0~999 mm";
                    }
                    if (sub == "ip")
                    {
                        var ip = c.Arg(1, "");
                        if (ip.Split('.').Length != 4 || ip.Any(ch => !char.IsDigit(ch) && ch != '.'))
                            return $"第 {c.LineNo} 行 CONFIG ip 需要合法 IPv4 地址, 如 CONFIG ip,192.168.1.180,255.255.255.0,192.168.1.1";
                    }
                    break;
                }
                case "IP":
                {
                    string sub = c.Arg(0, "query").ToLowerInvariant();
                    if (sub != "query" && sub != "static" && sub != "dhcp" && sub != "feedback")
                        return $"第 {c.LineNo} 行 IP 子命令须为 query|static|dhcp|feedback";
                    break;
                }
                case "RD":
                {
                    string a = c.Arg(0, "epc").ToLowerInvariant();
                    if (a != "epc" && a != "tid" && a != "both") return $"第 {c.LineNo} 行 RD 参数须为 epc|tid|both";
                    break;
                }
                case "TEST":
                {
                    if (!c.Arg(0, "").Equals("bounds", StringComparison.OrdinalIgnoreCase))
                        return $"第 {c.LineNo} 行 TEST 参数须为 bounds,<宽mm>,<高mm> (边界测试页)";
                    if (c.ArgD(1, 0) <= 0 || c.ArgD(2, 0) <= 0)
                        return $"第 {c.LineNo} 行 TEST bounds 需要正数宽高(mm), 如 TEST bounds,66,26";
                    break;
                }
                case "LINE":
                {
                    if (c.Args.Count < 4 || c.ArgD(0, -1) < 0 || c.ArgD(1, -1) < 0 || c.ArgD(2, -1) < 0 || c.ArgD(3, -1) < 0)
                        return $"第 {c.LineNo} 行 LINE 参数须为 x1,y1,x2,y2 (mm)";
                    break;
                }
                case "BOX":
                {
                    if (c.Args.Count < 4 || c.ArgD(0, -1) < 0 || c.ArgD(1, -1) < 0 || c.ArgD(2, -1) < 0 || c.ArgD(3, -1) < 0)
                        return $"第 {c.LineNo} 行 BOX 参数须为 x1,y1,x2,y2 (mm, 实心填充块)";
                    break;
                }
            }
            return null;
        }

        static string StripTrailingComment(string line)
        {
            bool inQ = false;
            for (int i = 0; i < line.Length; i++)
            {
                if (line[i] == '"') inQ = !inQ;
                else if (line[i] == '#' && !inQ) return line[..i].TrimEnd();
            }
            return line;
        }
    }
}
