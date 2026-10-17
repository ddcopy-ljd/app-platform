using System;

namespace PrintAgent.Models
{
    /// <summary>
    /// RFID 标签纸形状: 尺寸/间隙、可打印区域边距、天线(inlay)位置与尺寸, 单位 mm, 坐标相对标签左上角。
    /// 租户为打印机勾选所用标签纸(DeviceProfile.LabelPaperId), 业务端模板依据可打印区域+天线坐标做数据布局。
    /// </summary>
    public class LabelPaper
    {
        public string Id { get; set; } = Guid.NewGuid().ToString("N");
        public string Name { get; set; } = string.Empty;

        public double Width { get; set; }        // 标签宽 mm
        public double Height { get; set; }       // 标签高 mm
        public double Gap { get; set; } = 2;     // 间隙 mm

        // 可打印区域边距 mm(默认 2): 有效打印区 = [MarginLeft, Width-MarginRight] × [MarginTop, Height-MarginBottom]
        public double MarginLeft { get; set; } = 2;
        public double MarginRight { get; set; } = 2;
        public double MarginTop { get; set; } = 2;
        public double MarginBottom { get; set; } = 2;

        public double AntennaX { get; set; }     // inlay 中心 X mm
        public double AntennaY { get; set; }     // inlay 中心 Y mm
        public double AntennaW { get; set; }     // inlay 宽 mm, 0=未知(不做压天线警告)
        public double AntennaH { get; set; }     // inlay 高 mm

        public string Notes { get; set; } = string.Empty;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
        public string Source { get; set; } = "local"; // local | cloud (珠宝云整库同步预留)
    }
}
