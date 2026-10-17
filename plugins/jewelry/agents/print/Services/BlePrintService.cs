using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace PrintAgent.Services
{
    /// <summary>
    /// BLE(低功耗蓝牙)通道: 通过 GATT 直写 PCLE/TSPL 指令给已配对的 ZMIN 打印机。
    /// 适用于无 SDK 支持的 BLE 型号(如 X19D)。用法: interface=BLE, printerName=蓝牙地址HEX(如 0F0423317002)。
    /// </summary>
    public static class BlePrintService
    {
        // 排除标准 GATT 服务(只找厂商私有服务里的可写特征值)
        private static readonly HashSet<string> StandardServices = new HashSet<string>
        {
            "00001800-0000-1000-8000-00805f9b34fb", // Generic Access
            "00001801-0000-1000-8000-00805f9b34fb", // Generic Attribute
            "0000180a-0000-1000-8000-00805f9b34fb", // Device Information
            "0000180f-0000-1000-8000-00805f9b34fb", // Battery
        };

        public static async Task<(bool success, string message)> SendRawAsync(string commands, string addressHex)
        {
            if (string.IsNullOrWhiteSpace(commands))
                return (false, "未提供打印指令");
            if (string.IsNullOrWhiteSpace(addressHex) || addressHex == "Default")
                return (false, "BLE 模式需要在 printerName 里填打印机蓝牙地址HEX(12位), 或先调用 /api/printers 自动获取");

            byte[] payload = Encoding.ASCII.GetBytes(commands);

            // 地址字节序自动尝试: 原序 + 反序
            foreach (ulong addr in ParseAddressCandidates(addressHex))
            {
                var (ok, msg) = TrySendTo(addr, payload);
                if (ok) return (true, msg);
                lastError = msg;
            }
            return (false, lastError);
        }

        private static string lastError = "未知错误";

        private static List<ulong> ParseAddressCandidates(string hex)
        {
            var list = new List<ulong>();
            string clean = hex.Replace(":", "").Replace("-", "").Trim();
            try { list.Add(Convert.ToUInt64(clean, 16)); } catch { }
            if (clean.Length == 12)
            {
                var rev = clean.ToArray();
                Array.Reverse(rev);
                try { list.Add(Convert.ToUInt64(new string(rev), 16)); } catch { }
            }
            return list;
        }

        private static (bool, string) TrySendTo(ulong address, byte[] payload)
        {
            try
            {
                return TrySendToAsync(address, payload).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                return (false, $"BLE 连接异常(地址{address:X12}): {ex.Message}");
            }
        }

        private static async Task<(bool, string)> TrySendToAsync(ulong address, byte[] payload)
        {
            BluetoothLEDevice device = null;
            GattSession session = null;
            try
            {
                device = await BluetoothLEDevice.FromBluetoothAddressAsync(address);
                if (device == null || string.IsNullOrEmpty(device.Name))
                    return (false, $"找不到蓝牙设备(地址{address:X12})，请确认打印机开机且已配对");

                session = await GattSession.FromDeviceIdAsync(device.BluetoothDeviceId);
                if (session != null)
                {
                    session.MaintainConnection = true;
                    await Task.Delay(800); // 等待连接建立
                }

                var svcResult = await device.GetGattServicesAsync(BluetoothCacheMode.Uncached);
                if (svcResult.Status != GattCommunicationStatus.Success)
                    return (false, $"枚举蓝牙服务失败: {svcResult.Status}");

                GattCharacteristic writeChar = null;
                foreach (var svc in svcResult.Services)
                {
                    if (StandardServices.Contains(svc.Uuid.ToString())) continue;
                    var chResult = await svc.GetCharacteristicsAsync();
                    if (chResult.Status != GattCommunicationStatus.Success) continue;
                    foreach (var ch in chResult.Characteristics)
                    {
                        var p = ch.CharacteristicProperties;
                        if ((p & GattCharacteristicProperties.Write) != 0)
                            { writeChar = ch; if ((p & GattCharacteristicProperties.WriteWithoutResponse) == 0) break; }
                        else if ((p & GattCharacteristicProperties.WriteWithoutResponse) != 0 && writeChar == null)
                            writeChar = ch;
                    }
                    if (writeChar != null) break;
                }

                if (writeChar == null)
                    return (false, "打印机上未找到可写的蓝牙特征值");

                // 按 MTU 分块发送
                int chunkSize = 180;
                if (session != null && session.MaxPduSize > 23)
                    chunkSize = session.MaxPduSize - 3;

                for (int offset = 0; offset < payload.Length; offset += chunkSize)
                {
                    int len = Math.Min(chunkSize, payload.Length - offset);
                    var writer = new DataWriter();
                    writer.WriteBytes(payload.Skip(offset).Take(len).ToArray());
                    // GattWriteOption ABI: WithResponse=0, WithoutResponse=1
                    var option = (writeChar.CharacteristicProperties & GattCharacteristicProperties.WriteWithoutResponse) != 0
                        ? (GattWriteOption)1
                        : (GattWriteOption)0;
                    var status = await writeChar.WriteValueAsync(writer.DetachBuffer(), option);
                    if (status != GattCommunicationStatus.Success)
                        return (false, $"蓝牙写入失败: {status}");
                }

                return (true, $"BLE 打印指令已发送({payload.Length}字节 -> {device.Name})");
            }
            finally
            {
                session?.Dispose();
                if (device != null) device.Dispose();
            }
        }
    }
}
