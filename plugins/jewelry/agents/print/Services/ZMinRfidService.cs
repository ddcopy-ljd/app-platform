using System;
using System.Collections.Generic;
using LabelPrinter;
using Newtonsoft.Json.Linq;

namespace PrintAgent.Services
{
    public class ZMinRfidService
    {
        private readonly PrintUtility _utility = new PrintUtility();

        /// <summary>
        /// 执行结构化 RFID 标签打印 (支持网络与 USB)
        /// </summary>
        public (bool success, string message) PrintRfidLabel(JObject content, string iface, string ip, string usbSn, int dpi = 203)
        {
            var printer = new ZMPrinter();
            bool isNet = iface.Equals("NET", StringComparison.OrdinalIgnoreCase);

            // 1. 设置接口与硬件参数
            if (isNet)
            {
                printer.printerinterface = PrinterStyle.RFID_NET;
                printer.printernetip = ip;
            }
            else
            {
                printer.printerinterface = PrinterStyle.RFID_USB;
                if (!string.IsNullOrEmpty(usbSn))
                {
                    printer.printermbsn = usbSn;
                }
            }

            printer.printerdpi = dpi;
            printer.printSpeed = content.Value<int?>("speed") ?? 4;
            printer.printDarkness = content.Value<int?>("darkness") ?? 12;
            printer.labelhavegap = content.Value<bool?>("haveGap") ?? true;

            // 2. 打印前状态检查
            int statusCode = _utility.getPrinterStatusCode(printer);
            if (statusCode != 0)
            {
                string errStr = _utility.PrinterErrorCodeToString(statusCode);
                return (false, $"打印机状态异常 [{statusCode}]: {errStr}");
            }

            // 3. 构建标签尺寸
            var label = new ZMLabel
            {
                labelwidth = content.Value<float?>("width") ?? 75f,
                labelheight = content.Value<float?>("height") ?? 35f,
                labelrowgap = content.Value<float?>("gap") ?? 2f
            };

            var objList = new List<LabelObject>();

            // 4. 解析并装配 RFID 写入芯片数据 (必须以 rfiduhf 开头)
            string? epc = content.Value<string>("epc");
            if (!string.IsNullOrEmpty(epc))
            {
                objList.Add(new LabelObject
                {
                    ObjectName = "rfiduhf-01",
                    objectdata = epc,
                    RFIDDatablock = content.Value<int?>("rfidBlock") ?? 0, // 0: EPC, 1: USER
                    RFIDDatatype = 1,                                       // 1: 16进制HEX
                    RFIDerrortimes = 2
                });
            }

            // 5. 解析并装配文本图元 (必须以 text 开头)
            var texts = content["texts"] as JArray;
            if (texts != null)
            {
                int textIdx = 1;
                foreach (var t in texts)
                {
                    objList.Add(new LabelObject
                    {
                        ObjectName = $"text-{textIdx++:D2}",
                        objectdata = t.Value<string>("text") ?? "",
                        Xposition = t.Value<float?>("x") ?? 5f,
                        Yposition = t.Value<float?>("y") ?? 5f,
                        fontsize = t.Value<float?>("size") ?? 9f,
                        textfont = t.Value<string>("font") ?? "黑体",
                        fontstyle = t.Value<int?>("style") ?? 0
                    });
                }
            }

            // 6. 解析并装配条形码 (必须以 barcode 开头)
            var barcode = content["barcode"] as JObject;
            if (barcode != null)
            {
                objList.Add(new LabelObject
                {
                    ObjectName = "barcode-01",
                    objectdata = barcode.Value<string>("code") ?? "",
                    barcodekind = barcode.Value<string>("type") ?? "Code 128 Auto",
                    Xposition = barcode.Value<float?>("x") ?? 5f,
                    Yposition = barcode.Value<float?>("y") ?? 12f,
                    barcodescale = barcode.Value<int?>("scale") ?? 2,
                    barcodeheight = barcode.Value<float?>("height") ?? 8f,
                    textposition = barcode.Value<int?>("textPosition") ?? 0
                });
            }

            // 7. 发送打印
            string ret = _utility.PrintLabel(printer, label, objList, true, true);
            if (ret.StartsWith("Error:", StringComparison.OrdinalIgnoreCase))
            {
                return (false, ret);
            }

            return (true, "打印并写入成功");
        }

        /// <summary>
        /// RFID 指令透传模式 (TSPL/ZPL/厂商原生控制串)
        /// </summary>
        public (bool success, string message) SendRawCommands(string rawCommand, string iface, string ip, string usbSn)
        {
            var printer = new ZMPrinter();
            if (iface.Equals("NET", StringComparison.OrdinalIgnoreCase))
            {
                printer.printerinterface = PrinterStyle.NET;
                printer.printernetip = ip;
            }
            else
            {
                printer.printerinterface = PrinterStyle.USB;
                if (!string.IsNullOrEmpty(usbSn))
                {
                    printer.printermbsn = usbSn;
                }
            }

            string ret = _utility.SetPrinterParams(printer, rawCommand);
            if (ret.StartsWith("Error:", StringComparison.OrdinalIgnoreCase))
            {
                return (false, ret);
            }
            return (true, "指令透传成功");
        }
    }
}
