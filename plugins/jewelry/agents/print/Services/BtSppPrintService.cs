using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace PrintAgent.Services
{
    /// <summary>
    /// 经典蓝牙 SPP 通道: 通过蓝牙虚拟串口(出向 COM 口)直写 PCLE 指令给已配对的 ZMIN 打印机。
    /// 适用于 Windows 配对后生成虚拟串口的经典蓝牙机型(如 X19D CLASSIC, 非 BLE)。
    /// 用法: interface=BT, printerName=COM 口号(如 COM6)。
    /// 注意: .NET SerialPort 以重叠模式(FILE_FLAG_OVERLAPPED)打开蓝牙出向串口会失败(Access Denied),
    /// 必须使用非重叠 CreateFile, 因此这里直接用 Win32 API。
    /// </summary>
    public static class BtSppPrintService
    {
        const uint GENERIC_RW = 0xC0000000, OPEN_EXISTING = 3;

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr template);
        [DllImport("kernel32", SetLastError = true)]
        static extern bool WriteFile(IntPtr h, byte[] data, uint len, out uint written, IntPtr overlapped);
        [DllImport("kernel32", SetLastError = true)]
        static extern bool ReadFile(IntPtr h, byte[] buf, uint len, out uint read, IntPtr overlapped);
        [DllImport("kernel32", SetLastError = true)]
        static extern bool SetCommTimeouts(IntPtr h, ref COMMTIMEOUTS t);
        [DllImport("kernel32", SetLastError = true)]
        static extern bool PurgeComm(IntPtr h, uint flags);
        [DllImport("kernel32", SetLastError = true)]
        static extern bool ClearCommError(IntPtr h, out uint errors, out COMSTAT stat);
        [DllImport("kernel32")]
        static extern bool CloseHandle(IntPtr h);

        [StructLayout(LayoutKind.Sequential)]
        struct COMSTAT { public uint flags; public uint cbInQue, cbOutQue; }

        [StructLayout(LayoutKind.Sequential)]
        struct COMMTIMEOUTS
        {
            public uint ReadIntervalTimeout, ReadTotalTimeoutMultiplier, ReadTotalTimeoutConstant;
            public uint WriteTotalTimeoutMultiplier, WriteTotalTimeoutConstant;
        }

        /// <summary>向蓝牙虚拟串口发送原始 PCLE 指令串。</summary>
        public static (bool success, string message) SendRaw(string commands, string portName)
        {
            var (ok, msg, _) = Transceive(commands, portName, 1200);
            return (ok, msg);
        }

        /// <summary>发送并读回响应(PCLE RD/RQ 等反馈口=串口的指令经同一 SPP 链路回传)。respWaitMs=等待响应最长时间。</summary>
        public static (bool success, string message, string? response) SendAndRead(string commands, string portName, int respWaitMs)
            => Transceive(commands, portName, respWaitMs);

        static (bool success, string message, string? response) Transceive(string commands, string portName, int respWaitMs)
        {
            if (string.IsNullOrWhiteSpace(commands))
                return (false, "未提供打印指令", null);
            if (string.IsNullOrWhiteSpace(portName) || !portName.Trim().ToUpperInvariant().StartsWith("COM"))
                return (false, "BT 模式需要在 printerName 里填蓝牙虚拟串口号(如 COM6), 可在 设备管理器→蓝牙→标准串行(SPP)出向端口 查看", null);

            string port = portName.Trim().ToUpperInvariant();
            var h = CreateFileW(@"\\.\" + port, GENERIC_RW, 0, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
            if (h.ToInt64() == -1)
            {
                int err = Marshal.GetLastWin32Error();
                return (false, $"打开 {port} 失败: {new Win32Exception(err).Message} (请确认打印机开机、已配对且串口未被其他程序占用)", null);
            }

            try
            {
                // 等待 RFCOMM 链路建立(出向串口打开后蓝牙拨号是异步的)
                Thread.Sleep(1000);

                var t = new COMMTIMEOUTS
                {
                    ReadIntervalTimeout = 100,
                    ReadTotalTimeoutMultiplier = 0,
                    ReadTotalTimeoutConstant = 2000,
                    WriteTotalTimeoutMultiplier = 0,
                    WriteTotalTimeoutConstant = 15000
                };
                SetCommTimeouts(h, ref t);
                PurgeComm(h, 0x3); // 清收发缓冲

                // GBK 编码: PCLE 中文文本指令必须 GBK(ASCII 会丢中文), 纯 ASCII 指令不受影响
                byte[] payload = Encoding.GetEncoding("GBK").GetBytes(commands);
                if (!WriteFile(h, payload, (uint)payload.Length, out _, IntPtr.Zero))
                    return (false, $"写入 {port} 失败: {new Win32Exception(Marshal.GetLastWin32Error()).Message} (打印机蓝牙可能未开机/超出范围)", null);

                Thread.Sleep(800);
                var resp = ReadAvailable(h, respWaitMs);
                string? text = resp.Length > 0 ? Encoding.GetEncoding("GBK").GetString(resp).Trim('\0', ' ', '\r', '\n') : null;
                string tail = text != null ? $", 回传 {resp.Length} 字节" : ", 无回传";
                return (true, $"蓝牙 SPP 已发送({payload.Length}字节 -> {port}{tail})", text);
            }
            finally
            {
                CloseHandle(h);
            }
        }

        static byte[] ReadAvailable(IntPtr h, int waitMs)
        {
            var all = new System.Collections.Generic.List<byte>();
            var start = Environment.TickCount;
            while (Environment.TickCount - start < waitMs)
            {
                if (!ClearCommError(h, out _, out var stat) || stat.cbInQue == 0)
                {
                    if (all.Count > 0) break;
                    Thread.Sleep(50);
                    continue;
                }
                var buf = new byte[stat.cbInQue];
                if (!ReadFile(h, buf, (uint)buf.Length, out uint read, IntPtr.Zero) || read == 0) break;
                all.AddRange(buf);
                if (read < (uint)buf.Length) break;
            }
            return all.ToArray();
        }
    }
}
