using System;
using System.IO;
using Newtonsoft.Json;

namespace PrintAgent.Models
{
    public class AppConfig
    {
        /// <summary>固定撕裂线偏移 mm: ZMIN X19D 硬件撕纸参数, 启动时经 CONFIG tear,17.0 下发(NV 持久)</summary>
        public const double FixedTearOffsetMm = 17.0;

        public string ServerUrl { get; set; } = string.Empty;
        public string StoreKey { get; set; } = string.Empty;
        public string StoreId { get; set; } = string.Empty; // 门店唯一标识, 用于任务过滤(防止收到别家门店任务)
        public int LocalHttpPort { get; set; } = 18180;
        public bool IsConfigured { get; set; } = false;
        public string Language { get; set; } = "zh-CN"; // 默认简体中文
        public bool AutoUpdateEnabled { get; set; } = true; // 自动升级开关(服务端 MD5 与本地不一致时升级)
        public string UpdateServerUrl { get; set; } = string.Empty; // 可选: 升级服务地址; 为空时由 ServerUrl 推导

        // ===== 全局打印参数(保留字段, 兼容老 config.json) =====
        public int? Speed { get; set; }          // 打印速度 (S 指令, 随打印任务下发)
        public int? Darkness { get; set; }       // 黑度 0-20 (S 指令)
        public int? Dpi { get; set; }            // 分辨率 203/300
        public int? ReadPower { get; set; }      // 读功率 dBm (PWR 指令)
        public int? WritePower { get; set; }     // 写功率 dBm (PWR 指令)

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
}
