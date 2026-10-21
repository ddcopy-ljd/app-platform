using System;
using System.Collections.Generic;
using System.Drawing.Printing;
using System.IO.Ports;
using System.Linq;
using LabelPrinter;
using Microsoft.Win32;

namespace PrintAgent.Services
{
    public class PrinterDiscoveryService
    {
        public class PrinterDevice
        {
            public string Name { get; set; } = string.Empty;
            public string Type { get; set; } = string.Empty;    // label / receipt / driver
            public string Interface { get; set; } = string.Empty; // USB / BT / NET / SERIAL / DRIVER
            public string Address { get; set; } = string.Empty;  // SN / COM口 / IP:端口 / 驱动名
            public string Detail { get; set; } = string.Empty;
            public string Brand { get; set; } = string.Empty; // zmin / tspl / zpl / ""(未知)
            public bool Online { get; set; }
            public bool IsDefault { get; set; }
        }

        /// <summary>
        /// 枚举本机可连接的物理打印机: 驱动打印机 + 致明兴免驱USB + 串口(含蓝牙SPP虚拟口)
        /// </summary>
        public static List<PrinterDevice> GetAllLocalPrinters()
        {
            var list = new List<PrinterDevice>();

            // 1. Windows 驱动打印机 (普通A4/针式/小票驱动等)
            string defaultPrinter = new PrinterSettings().PrinterName;
            foreach (string printerName in PrinterSettings.InstalledPrinters)
            {
                list.Add(new PrinterDevice
                {
                    Name = printerName,
                    Type = "driver",
                    Interface = "DRIVER",
                    Address = printerName,
                    Detail = "Windows 打印驱动",
                    Brand = BrandFromName(printerName),
                    Online = true,
                    IsDefault = printerName.Equals(defaultPrinter, StringComparison.OrdinalIgnoreCase)
                });
            }

            // 2. 致明兴免驱 USB 打印机 (主板SN)
            try
            {
                var utility = new PrintUtility();
                List<string>? zminUsbList = utility.getUSBPrinterMainboardSN();
                if (zminUsbList != null)
                {
                    foreach (var sn in zminUsbList)
                    {
                        list.Add(new PrinterDevice
                        {
                            Name = $"ZMIN_USB_{sn}",
                            Type = "label",
                            Interface = "USB",
                            Address = sn,
                            Detail = $"致明兴免驱动 USB (主板SN: {sn})",
                            Brand = "zmin",
                            Online = true
                        });
                    }
                }
            }
            catch
            {
                // 未插免驱 USB 设备或 DLL 异常时忽略
            }

            // 3. 串口设备: 含蓝牙 SPP 出向虚拟串口 (HKLM\HARDWARE\DEVICEMAP\SERIALCOMM 判定来源)
            var serialMap = ReadSerialCommMap();
            foreach (string port in SerialPort.GetPortNames().OrderBy(p => p))
            {
                serialMap.TryGetValue(port, out string? devicePath);
                devicePath ??= string.Empty;
                bool isBt = devicePath.Contains("BthModem", StringComparison.OrdinalIgnoreCase)
                         || devicePath.Contains("RFCOMM", StringComparison.OrdinalIgnoreCase);
                list.Add(new PrinterDevice
                {
                    Name = isBt ? $"BT_SPP_{port}" : $"SERIAL_{port}",
                    Type = isBt ? "label" : "serial",
                    Interface = isBt ? "BT" : "SERIAL",
                    Address = port,
                    Detail = isBt
                        ? $"蓝牙SPP虚拟串口 (设备路径: {devicePath})。打印机任务传 interface=BT, printerName={port}"
                        : $"物理串口 (设备路径: {devicePath})",
                    Online = true
                });
            }

            return list;
        }

        // 驱动名关键词 → 统一指令品牌后端
        static string BrandFromName(string name)
        {
            if (name.Contains("ZMIN", StringComparison.OrdinalIgnoreCase) || name.Contains("致明兴")) return "zmin";
            if (name.Contains("TSC", StringComparison.OrdinalIgnoreCase) || name.Contains("芯烨")
                || name.Contains("XPrinter", StringComparison.OrdinalIgnoreCase) || name.Contains("汉印")
                || name.Contains("HPRT", StringComparison.OrdinalIgnoreCase)) return "tspl";
            if (name.Contains("ZEBRA", StringComparison.OrdinalIgnoreCase)) return "zpl";
            return string.Empty;
        }

        // 注册表 DEVICEMAP 列出系统全部串口及其设备路径 (蓝牙出向口路径含 BthModem)
        private static Dictionary<string, string> ReadSerialCommMap()
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DEVICEMAP\SERIALCOMM");
                if (key != null)
                {
                    foreach (string vName in key.GetValueNames())
                    {
                        string port = (key.GetValue(vName) as string) ?? "";
                        if (!string.IsNullOrEmpty(port)) map[port] = vName;
                    }
                }
            }
            catch { }
            return map;
        }
    }
}
