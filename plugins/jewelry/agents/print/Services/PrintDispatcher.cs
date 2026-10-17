using System;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    public class PrintDispatcher
    {
        private readonly ZMinRfidService _rfidService = new ZMinRfidService();

        // 最近任务记录（供 /api/tasks 查询，便于外部观测打印结果与失败原因）
        private static readonly object _storeLock = new object();
        private static readonly List<PrintTask> _recentTasks = new List<PrintTask>();

        public static void RecordTask(PrintTask task, bool success, string message)
        {
            lock (_storeLock)
            {
                task.Status = success ? "已完成" : "失败";
                task.ResultMessage = message ?? string.Empty;
                _recentTasks.Add(task);
                while (_recentTasks.Count > 100) _recentTasks.RemoveAt(0);
            }
        }

        public static List<PrintTask> GetRecentTasks()
        {
            lock (_storeLock)
            {
                return new List<PrintTask>(_recentTasks);
            }
        }

        public async Task<(bool success, string message)> DispatchAsync(PrintTask task)
        {
            (bool success, string message) result;
            try
            {
                JObject root = JObject.Parse(task.ContentJson);
                var content = root["content"] as JObject ?? root;

                switch (task.PrinterType.ToLower())
                {
                    case "rfid":
                        // 结构化超高频 RFID 排版与写入
                        result = _rfidService.PrintRfidLabel(
                            content,
                            task.Interface,
                            task.PrinterIp,
                            task.PrinterName,
                            content.Value<int?>("dpi") ?? 203
                        );
                        break;

                    case "rfid_cmd":
                    {
                        // 统一指令流: 解析→能力校验→设备档案→按品牌后端执行
                        string cmdStream = content.Value<string>("commands") ?? "";
                        int timeoutMs = content.Value<int?>("timeoutMs") ?? 20000;
                        var (code, msg, data) = await RfidCommandExecutor.ExecuteAsync(
                            task.Brand, task.Interface, task.PrinterIp, task.PrinterName,
                            cmdStream, timeoutMs, false);
                        result = (code == 0, string.IsNullOrEmpty(data) ? msg : $"{msg} | 回传: {data}");
                        break;
                    }

                    case "raw_passthrough":
                        // 指令透传模式: BLE 走 GATT 通道, BT/SPP 走蓝牙虚拟串口, 其余走 ZMIN SDK
                        string rawCmd = content.Value<string>("rawCommands") ?? "";
                        if (string.Equals(task.Interface, "BLE", StringComparison.OrdinalIgnoreCase))
                            result = await BlePrintService.SendRawAsync(rawCmd, task.PrinterName);
                        else if (string.Equals(task.Interface, "BT", StringComparison.OrdinalIgnoreCase)
                              || string.Equals(task.Interface, "SPP", StringComparison.OrdinalIgnoreCase))
                            result = BtSppPrintService.SendRaw(rawCmd, task.PrinterName);
                        else
                            result = _rfidService.SendRawCommands(rawCmd, task.Interface, task.PrinterIp, task.PrinterName);
                        break;

                    case "pos":
                        // ESC/POS 小票: DRIVER/USB 走驱动假脱机 RAW 字节, 其余走网络 9100 直连
                        string posDataStr = content.Value<string>("rawBase64") ?? "";
                        byte[] posBytes = !string.IsNullOrEmpty(posDataStr)
                            ? Convert.FromBase64String(posDataStr)
                            : Encoding.GetEncoding("GBK").GetBytes(content.Value<string>("text") ?? "");

                        if (string.Equals(task.Interface, "DRIVER", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(task.Interface, "USB", StringComparison.OrdinalIgnoreCase))
                            result = StandardAndPosPrintService.PrintPosRawViaDriver(task.PrinterName, posBytes);
                        else
                            result = await StandardAndPosPrintService.PrintPosRawAsync(task.PrinterIp, 9100, posBytes);
                        break;

                    case "standard":
                    default:
                        // Windows 普通驱动打印
                        string textToPrint = content.Value<string>("text") ?? content.ToString();
                        result = StandardAndPosPrintService.PrintViaDriver(task.PrinterName, textToPrint);
                        break;
                }
            }
            catch (Exception ex)
            {
                result = (false, $"任务调度异常: {ex.Message}");
            }

            RecordTask(task, result.success, result.message);
            return result;
        }
    }
}
