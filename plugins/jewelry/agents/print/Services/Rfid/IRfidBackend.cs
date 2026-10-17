using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    /// <summary>执行通道规格: USB=致明兴免驱(主板SN可选), NET=TCP 9100, BT=经典蓝牙SPP虚拟串口</summary>
    public class TransportSpec
    {
        public string Interface { get; set; } = "USB"; // USB / NET / BT
        public string Ip { get; set; } = string.Empty;
        public string Target { get; set; } = string.Empty; // USB: 主板SN(可空); BT: COM 口号
        public int Port { get; set; } = 9100;
        public bool IsUsb => Interface.Equals("USB", StringComparison.OrdinalIgnoreCase);
        public bool IsBt => Interface.Equals("BT", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 品牌后端接口: 统一指令 → 品牌原生指令。
    /// SupportedOps 为能力矩阵键(含细粒度如 IP.static / CAL.paper), 不在清单内的指令执行前即报错, 不静默忽略。
    /// </summary>
    public interface IRfidBackend
    {
        string Brand { get; }
        string[] SupportedOps { get; }

        /// <summary>不支持原因提示(默认通用文案)</summary>
        string? UnsupportedReason(string key) => null;

        /// <summary>只翻译不执行, 返回品牌原生指令文本(无真机验证翻译正确性)</summary>
        string TranslatePreview(IReadOnlyList<RfidCommand> cmds, TransportSpec spec, DeviceProfile? profile);

        Task<(bool ok, string msg, string? readData)> ExecuteAsync(
            IReadOnlyList<RfidCommand> cmds, TransportSpec spec, DeviceProfile? profile, int timeoutMs);
    }

    public static class RfidBackendExtensions
    {
        public static bool Supports(this IRfidBackend b, string key)
            => b.SupportedOps.Contains(key, StringComparer.OrdinalIgnoreCase);
    }
}
