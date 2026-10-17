using System;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace PrintAgent.Services
{
    /// <summary>统一通道收发: TCP 9100 发送并带超时读回(供 NET 通道 RD/RQ 回读)</summary>
    public static class RfidTransport
    {
        public static async Task<(bool ok, string msg, string? response)> TcpSendReceiveAsync(
            string ip, int port, string payload, int timeoutMs)
        {
            try
            {
                using var client = new TcpClient();
                var connect = client.ConnectAsync(ip, port);
                if (await Task.WhenAny(connect, Task.Delay(timeoutMs)) != connect)
                    return (false, $"连接打印机 {ip}:{port} 超时", null);
                await connect;

                var stream = client.GetStream();
                byte[] bytes = Encoding.ASCII.GetBytes(payload);
                await stream.WriteAsync(bytes, 0, bytes.Length);
                await stream.FlushAsync();

                // 读回: 首包等待剩余超时, 收到数据后静默 500ms 即认为结束
                var buf = new byte[4096];
                var ms = new MemoryStream();
                var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
                bool got = false;
                while (true)
                {
                    int left = (int)(deadline - DateTime.UtcNow).TotalMilliseconds;
                    if (left <= 0) break;
                    var readTask = stream.ReadAsync(buf, 0, buf.Length);
                    if (await Task.WhenAny(readTask, Task.Delay(got ? Math.Min(500, left) : left)) != readTask) break;
                    int n = await readTask;
                    if (n <= 0) break;
                    ms.Write(buf, 0, n);
                    got = true;
                }

                if (!got) return (true, "已发送, 无回传数据", null);
                string resp = Encoding.ASCII.GetString(ms.ToArray()).Trim('\0', ' ', '\r', '\n');
                return (true, "读取成功", resp);
            }
            catch (Exception ex)
            {
                return (false, $"TCP {ip}:{port} 收发失败: {ex.Message}", null);
            }
        }
    }
}
