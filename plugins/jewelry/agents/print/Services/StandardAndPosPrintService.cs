using System;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

namespace PrintAgent.Services
{
    public class StandardAndPosPrintService
    {
        /// <summary>
        /// 小票机 ESC/POS 网络端口透传 (默认 9100)
        /// </summary>
        public static async Task<(bool success, string message)> PrintPosRawAsync(string ip, int port, byte[] data)
        {
            try
            {
                using var client = new TcpClient();
                await client.ConnectAsync(ip, port == 0 ? 9100 : port);
                using var stream = client.GetStream();
                await stream.WriteAsync(data, 0, data.Length);
                await stream.FlushAsync();
                return (true, "小票字节流透传成功");
            }
            catch (Exception ex)
            {
                return (false, $"小票连接失败: {ex.Message}");
            }
        }

        /// <summary>
        /// ESC/POS 原始字节经 Windows 驱动假脱机直发 (datatype=RAW, 驱动不过滤字节, 适用 USB/串口小票机装驱动后的场景)
        /// </summary>
        public static (bool success, string message) PrintPosRawViaDriver(string printerName, byte[] data)
        {
            try
            {
                if (!OpenPrinterW(printerName, out IntPtr hPrinter, 0))
                    return (false, $"打开打印机 '{printerName}' 失败 (Win32err={Marshal.GetLastWin32Error()}, 检查驱动名是否与 /api/printers 一致)");
                try
                {
                    var di = new DOC_INFO_1W
                    {
                        pDocName = "POS_RAW",
                        pOutputFile = null,
                        pDatatype = "RAW"
                    };
                    if (StartDocPrinterW(hPrinter, 1, ref di) == 0)
                        return (false, $"StartDocPrinter 失败 (Win32err={Marshal.GetLastWin32Error()})");
                    try
                    {
                        if (!StartPagePrinter(hPrinter)) return (false, "StartPagePrinter 失败");
                        if (!WritePrinter(hPrinter, data, (uint)data.Length, out uint written) || written != data.Length)
                            return (false, $"WritePrinter 失败 (写入 {written}/{data.Length})");
                        EndPagePrinter(hPrinter);
                    }
                    finally
                    {
                        EndDocPrinter(hPrinter);
                    }
                    return (true, $"ESC/POS 原始字节已经驱动假脱机发送 ({data.Length} 字节)");
                }
                finally
                {
                    ClosePrinter(hPrinter);
                }
            }
            catch (Exception ex)
            {
                return (false, $"驱动 RAW 小票打印异常: {ex.Message}");
            }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DOC_INFO_1W
        {
            public string pDocName;
            public string? pOutputFile;
            public string pDatatype;
        }

        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinterW(string name, out IntPtr hPrinter, int def);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr hPrinter);
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinterW(IntPtr hPrinter, int level, ref DOC_INFO_1W di);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr hPrinter);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr hPrinter);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr hPrinter);
        [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr hPrinter, byte[] data, uint size, out uint written);

        /// <summary>
        /// 通过 Windows 系统驱动打印纯文本 / 票据
        /// </summary>
        public static (bool success, string message) PrintViaDriver(string printerName, string textContent)
        {
            try
            {
                var doc = new PrintDocument();
                doc.PrinterSettings.PrinterName = printerName;

                if (!doc.PrinterSettings.IsValid)
                {
                    return (false, $"打印机驱动 '{printerName}' 无效或未安装");
                }

                doc.PrintPage += (s, e) =>
                {
                    using var font = new Font("Microsoft YaHei", 9f);
                    e.Graphics?.DrawString(textContent, font, Brushes.Black, new PointF(10, 10));
                };

                doc.Print();
                return (true, "已发送至系统打印队列");
            }
            catch (Exception ex)
            {
                return (false, $"驱动打印异常: {ex.Message}");
            }
        }
    }
}
