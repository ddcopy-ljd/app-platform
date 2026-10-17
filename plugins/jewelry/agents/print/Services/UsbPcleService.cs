using System;
using System.Runtime.InteropServices;
using System.Text;

namespace PrintAgent.Services
{
    /// <summary>
    /// USB 通道 PCLE 直发与校准服务 (P/Invoke 官方 ZMPCLx64.dll, 逻辑移植自实测通过的 BtPrintTest.ZMUsbChannel)
    /// 单句柄模型: OpenPort(255) 打开唯一一台 ZMIN, 全部操作加锁串行。
    /// </summary>
    public class UsbPcleService
    {
        const CallingConvention CC = CallingConvention.Cdecl;
        private static readonly object _lock = new object();
        private static bool _opened;

        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int OpenPort(int xx);
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern void ClosePort();
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int WriteToPort(string data);
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int ZM_MediaDetect();
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int ZM_AutoRFTagDetc();
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int ZM_SetRFIDPosition(int r1, int readWritePosition, int positionError, int maxReErrorNum, int r2);
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int ZM_PrintConfigunation();
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int ZM_GetData_USB(byte[] buf, int timeout_ms);
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int ZM_ReadRFTagDataUSB(uint usbPort, uint dataBlock, uint rfPower, int feed, byte[] rfData, int timeout_ms);
        [DllImport("ZMPCLx64.dll", CallingConvention = CC)] static extern int ZM_SetRFIDReadWritePower(int readPower, int writePower);

        private static void EnsureOpen()
        {
            if (_opened) return;
            int rc = OpenPort(255);
            if (rc != 0) throw new InvalidOperationException($"OpenPort(255) 失败, 错误码 {rc} (确认打印机 USB 已连接且未被其他程序占用)");
            _opened = true;
        }

        public static (bool ok, string msg) SendRaw(string pcleCommands)
        {
            lock (_lock)
            {
                EnsureOpen();
                int rc = WriteToPort(pcleCommands);
                return rc == 0 ? (true, "PCLE 已发送") : (false, $"WriteToPort 错误码 {rc}");
            }
        }

        /// <summary>纸校准(标签高度/间隙): ZM_MediaDetect, 打印机会走纸约10秒</summary>
        public static (bool ok, string msg) PaperCalibrate()
        {
            lock (_lock)
            {
                EnsureOpen();
                int rc = ZM_MediaDetect();
                return rc == 0 ? (true, "纸校准成功") : (false, $"纸校准失败, 错误码 {rc}");
            }
        }

        /// <summary>RFID 天线位置校准: ZM_AutoRFTagDetc, 需先完成纸校准, 约30秒</summary>
        public static (bool ok, string msg) RfidCalibrate()
        {
            lock (_lock)
            {
                EnsureOpen();
                int rc = ZM_AutoRFTagDetc();
                return rc == 0
                    ? (true, "RFID 天线位置校准成功(写入距离已存入打印机)")
                    : (false, $"RFID 校准失败, 错误码 {rc} (91=程序控制校准错误, 92=手动校准错误, 多为标签未放好/无标签)");
            }
        }

        /// <summary>
        /// 手动设置 RFID 天线读写位置: posMm=标签起始到芯片距离 0~999(0=打印机自动定位),
        /// errOffsetMm=错误标识距标签底部偏移 0~标签高, retry=写错重试 0~9。写入后持久保存在打印机。
        /// </summary>
        public static (bool ok, string msg) SetRfidPosition(int posMm, int errOffsetMm, int retry)
        {
            if (posMm < 0 || posMm > 999) return (false, "天线位置须为 0~999 mm (0=自动定位)");
            if (errOffsetMm < 0 || errOffsetMm > 999) return (false, "错误标识偏移须为 0~999 mm");
            if (retry < 0 || retry > 9) return (false, "重试次数须为 0~9");
            lock (_lock)
            {
                EnsureOpen();
                int rc = ZM_SetRFIDPosition(0, posMm, errOffsetMm, retry, 0);
                return rc == 0
                    ? (true, $"RFID 位置已设置: 芯片距离={posMm}mm(0=自动) 错误标识偏移={errOffsetMm}mm 重试={retry}")
                    : (false, $"设置 RFID 位置失败, 错误码 {rc}");
            }
        }

        public static (bool ok, string msg) PrintConfigPage()
        {
            lock (_lock)
            {
                EnsureOpen();
                int rc = ZM_PrintConfigunation();
                return rc == 0 ? (true, "配置页打印中") : (false, $"打印配置页失败, 错误码 {rc}");
            }
        }

        /// <summary>读标签 EPC。-4003=USB读超时, 多因天线区停在间隙, 先打一张标签走纸再读</summary>
        public static (bool ok, string msg, string? epc) ReadEpc() => ReadTag(1, 0);

        /// <summary>
        /// 通用读标签: region 0=TID 1=EPC 2=两者; feed 读后走纸 0/1/2。
        /// 路径1 PCLE RD+USB反馈(手册要求读反馈前先 ClosePort), 路径2 专用读函数兜底。
        /// </summary>
        public static (bool ok, string msg, string? data) ReadTag(int region = 1, int feed = 0)
        {
            lock (_lock)
            {
                EnsureOpen();
                WriteToPort($"RD{region},1,0,{feed}\r\n");
                ClosePort();
                _opened = false;
                var buf = new byte[2048];
                int rc = ZM_GetData_USB(buf, 12000);
                string raw = rc >= 0 ? Encoding.ASCII.GetString(TrimNul(buf)) : "";
                string? hex = ExtractHex(raw, region == 1 ? 12 : 8);
                if (hex != null) { EnsureOpen(); return (true, "读取成功", hex); }

                // 路径2: 专用读函数(仅单区 TID/EPC)
                if (region <= 1)
                {
                    rc = ZM_ReadRFTagDataUSB(255, (uint)region, 15, feed, buf, 10000); // 15dBm
                    EnsureOpen();
                    if (rc == 0)
                    {
                        hex = ExtractHex(Encoding.ASCII.GetString(TrimNul(buf)), region == 1 ? 12 : 8);
                        if (hex != null) return (true, "读取成功", hex);
                    }
                    else return (false, $"读标签失败, 错误码 {rc}(-4003=USB读取超时, 标签可能不在天线区, 先打一张走纸)", null);
                }
                else EnsureOpen();
                return (false, "读取失败: USB 反馈中未找到有效标签数据", null);
            }
        }

        /// <summary>写 EPC: 排版由调用方给, 本方法只发 RF 直写指令 + W1</summary>
        public static (bool ok, string msg) WriteEpc(string epcHex, string layoutCommands = "N\r")
        {
            if (epcHex.Length % 2 != 0 || !epcHex.All(Uri.IsHexDigit))
                return (false, "EPC 必须是偶数位十六进制");
            string cmd = layoutCommands + $"RF1,0,1,{epcHex.Length / 2 + 2},1,\"3000{epcHex}\"\r\n" + "W1\r";
            lock (_lock)
            {
                EnsureOpen();
                int rc = WriteToPort(cmd);
                return rc == 0 ? (true, "写EPC+打印任务已下发(约12秒完成)") : (false, $"WriteToPort 错误码 {rc}");
            }
        }

        /// <summary>
        /// 发送含 RD 的完整任务流并读回反馈。手册: RF/RD 在 W 执行时才处理,
        /// 因此 RD 必须与 RF/W 在同一任务缓冲内, 打印完成后经反馈口回传。
        /// </summary>
        public static (bool ok, string msg, string? data) SendRawWithFeedback(string commands, int timeoutMs)
        {
            lock (_lock)
            {
                EnsureOpen();
                int rc = WriteToPort(commands);
                if (rc != 0) return (false, $"WriteToPort 错误码 {rc}", null);
                ClosePort();
                _opened = false;
                var buf = new byte[2048];
                rc = ZM_GetData_USB(buf, timeoutMs);
                EnsureOpen();
                string raw = rc >= 0 ? Encoding.ASCII.GetString(TrimNul(buf)).Trim() : "";
                return raw.Length > 0
                    ? (true, "任务完成且有反馈数据", raw)
                    : (false, $"任务已执行, 无反馈数据(错误码 {rc})", null);
            }
        }

        public static (bool ok, string msg) SetRfPower(int readDbm, int writeDbm)
        {
            lock (_lock)
            {
                EnsureOpen();
                int rc = ZM_SetRFIDReadWritePower(readDbm, writeDbm);
                return rc == 0 ? (true, $"读功率={readDbm}dBm 写功率={writeDbm}dBm 已设置") : (false, $"设置读写功率失败, 错误码 {rc}");
            }
        }

        /// <summary>查询打印机信息 RQ1: 1型号 2工作方式 3网络 4距离 5RFID</summary>
        public static (bool ok, string msg) QueryInfo(int type)
        {
            lock (_lock)
            {
                EnsureOpen();
                WriteToPort($"RQ1,{type}\r\n");
                ClosePort();
                _opened = false;
                var buf = new byte[2048];
                int rc = ZM_GetData_USB(buf, 4000);
                EnsureOpen();
                if (rc < 0) return (false, $"读取反馈失败, 错误码 {rc}");
                return (true, Encoding.ASCII.GetString(TrimNul(buf)));
            }
        }

        static byte[] TrimNul(byte[] b)
        {
            int i = Array.IndexOf(b, (byte)0);
            return i < 0 ? b : b[..i];
        }

        static string? ExtractHex(string raw, int minLen = 12)
        {
            var m = System.Text.RegularExpressions.Regex.Match(raw, "[0-9A-Fa-f]{" + minLen + ",}");
            return m.Success ? m.Value.ToUpperInvariant() : null;
        }
    }
}
