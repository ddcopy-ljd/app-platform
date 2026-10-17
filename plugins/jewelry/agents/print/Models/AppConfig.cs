using System;
using System.IO;
using Newtonsoft.Json;

namespace PrintAgent.Models
{
    public class AppConfig
    {
        public string ServerUrl { get; set; } = string.Empty;
        public string StoreKey { get; set; } = string.Empty;
        public string StoreId { get; set; } = string.Empty; // 门店唯一标识, 用于任务过滤(防止收到别家门店任务)
        public int LocalHttpPort { get; set; } = 18180;
        public bool IsConfigured { get; set; } = false;
        public string Language { get; set; } = "zh-CN"; // 默认简体中文
        public List<string> NetPrinterIps { get; set; } = new List<string>(); // 网口打印机固定IP, 供 /api/printers 探测
        public bool AutoUpdateEnabled { get; set; } = true; // 自动升级开关(服务端 MD5 与本地不一致时升级)
        public string UpdateServerUrl { get; set; } = string.Empty; // 可选: 升级服务地址; 为空时由 ServerUrl 推导

        // ===== 全局打印参数(统一保存, 不随标签方案变化) =====
        public double? TearOffset { get; set; }  // 撕裂线位置 mm (#UM>FD, 打印机 NV 持久)
        public int? Speed { get; set; }          // 打印速度 (S 指令, 随打印任务下发)
        public int? Darkness { get; set; }       // 黑度 0-20 (S 指令)
        public int? Dpi { get; set; }            // 分辨率 203/300
        public int? ReadPower { get; set; }      // 读功率 dBm (PWR 指令)
        public int? WritePower { get; set; }     // 写功率 dBm (PWR 指令)

        // ===== 全局网络参数(应用到打印机, NV 持久) =====
        public string PrinterIp { get; set; } = string.Empty;      // 打印机 IP
        public string PrinterMask { get; set; } = string.Empty;    // 子网掩码
        public string PrinterGateway { get; set; } = string.Empty; // 网关

        // ===== 全局蓝牙参数 =====
        public string BleAddress { get; set; } = string.Empty; // BLE 直写地址(12位HEX, 无 SDK 型号用 GATT)
        public string BtSppPort { get; set; } = string.Empty;  // 蓝牙 SPP 虚拟串口(如 COM5)

        // 设备档案: key = "brand|ip或SN" (如 "zmin|192.168.1.180" / "zmin|SN123"), rfid_cmd 任务省略 L/S/PWR 时自动套用
        public Dictionary<string, DeviceProfile> DeviceProfiles { get; set; } = new Dictionary<string, DeviceProfile>();

        // 单文件发布时 BaseDirectory 指向解包临时目录, 必须用 exe 所在目录定位 config.json
        private static readonly string ConfigPath = Path.Combine(
            Path.GetDirectoryName(Environment.ProcessPath) ?? AppDomain.CurrentDomain.BaseDirectory, "config.json");

        public static AppConfig Load()
        {
            if (!File.Exists(ConfigPath)) return new AppConfig();
            try
            {
                var json = File.ReadAllText(ConfigPath);
                return JsonConvert.DeserializeObject<AppConfig>(json) ?? new AppConfig();
            }
            catch
            {
                return new AppConfig();
            }
        }

        public void Save()
        {
            var json = JsonConvert.SerializeObject(this, Formatting.Indented);
            File.WriteAllText(ConfigPath, json);
        }
    }

    /// <summary>单台设备的持久化默认参数(不同类型打印机独立校准/配置)</summary>
    public class DeviceProfile
    {
        public double? Width { get; set; }      // 标签宽 mm
        public double? Height { get; set; }     // 标签高 mm
        public double? Gap { get; set; }        // 间隙 mm
        public int? Speed { get; set; }         // 打印速度
        public int? Darkness { get; set; }      // 黑度 0-20
        public int? Dpi { get; set; }           // 分辨率 203/300
        public int? ReadPower { get; set; }     // 读功率 dBm
        public int? WritePower { get; set; }    // 写功率 dBm
        public string? LabelPaperId { get; set; } // 绑定的标签纸形状库条目 Id(勾选所用标签纸)
    }
}
