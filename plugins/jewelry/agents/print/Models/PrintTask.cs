using System;
using System.Collections.Generic;

namespace PrintAgent.Models
{
    public class PrintTask
    {
        public string TaskId { get; set; } = Guid.NewGuid().ToString("N");
        public string Source { get; set; } = "Local"; // Local 或 Cloud
        public string StoreId { get; set; } = string.Empty; // 门店绑定: 任务归属门店, 与本机 StoreId/StoreKey 不符则拒收
        public string PrinterType { get; set; } = "rfid"; // rfid, rfid_cmd(统一指令流), pos, standard, raw_passthrough
        public string Brand { get; set; } = "zmin"; // 打印机品牌后端: zmin (tspl/zpl 规划中); 旧任务缺省即 ZMIN
        public string Interface { get; set; } = "NET"; // NET, USB, DRIVER
        public string PrinterIp { get; set; } = "192.168.1.180";
        public string PrinterName { get; set; } = "Default";
        public string Status { get; set; } = "待处理";
        public string ResultMessage { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public string ContentJson { get; set; } = string.Empty;
    }
}
