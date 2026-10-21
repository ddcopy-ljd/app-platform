using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace PrintAgent.Services
{
    /// <summary>
    /// 统一通道收发: TCP 9100 发送指令, 回读同时兼容两种到达方式(与实测跑通的
    /// BtPrintTest.NetChannel.ReadWithFeedback 一致):
    /// ① 同链路 9100 直接回送; ② 打印机反连本机 9200 反馈口(默认, 可用 NB 指令改)。
    /// LAN 反馈走 9200 是主流: RD{r},2,0,0 的回读数据由打印机主动反连主机 9200 送回。
    /// </summary>
    public static class RfidTransport
    {
        static readonly object _netLock = new object(); // 序列化 NET 收发, 保护 9200 监听口

        public static Task<(bool ok, string msg, string? response)> TcpSendReceiveAsync(
            string ip, int port, string payload, int timeoutMs)
            => Task.Run(() => { lock (_netLock) { return Core(ip, port, payload, timeoutMs); } });

        static (bool ok, string msg, string? response) Core(string ip, int port, string payload, int timeoutMs)
        {
            TcpClient? client = null;
            TcpListener? listener = null;
            try
            {
                client = new TcpClient();
                var connect = client.ConnectAsync(ip, port);
                if (!connect.Wait(timeoutMs))
                    return (false, $"连接打印机 {ip}:{port} 超时", null);
                client.NoDelay = true;
                var stream = client.GetStream();

                // 9200 反馈监听尽力而为: 被占用/防火墙拦截时退化为仅同链路读(原行为)
                try { listener = new TcpListener(IPAddress.Any, 9200); listener.Start(); }
                catch { listener = null; }

                byte[] bytes = Encoding.ASCII.GetBytes(payload);
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush();

                var all = new List<byte>();
                var buf = new byte[4096];
                var sw = Stopwatch.StartNew();
                while (sw.ElapsedMilliseconds < timeoutMs)
                {
                    bool got = false;
                    if (stream.DataAvailable)
                    {
                        int n = stream.Read(buf, 0, buf.Length);
                        if (n > 0) { all.AddRange(buf.Take(n)); got = true; }
                    }
                    if (listener != null && listener.Pending())
                    {
                        using var fb = listener.AcceptTcpClient();
                        fb.ReceiveTimeout = 3000;
                        using var s = fb.GetStream();
                        int n = s.Read(buf, 0, buf.Length);
                        if (n > 0) { all.AddRange(buf.Take(n)); got = true; }
                    }
                    if (got) sw.Restart(); // 有数据则重置超时窗口(同实测工具)
                    else Thread.Sleep(50);
                }

                if (all.Count == 0) return (true, "已发送, 无回传数据", null);
                string resp = Encoding.ASCII.GetString(all.ToArray()).Trim('\0', ' ', '\r', '\n');
                return (true, "读取成功", resp);
            }
            catch (Exception ex)
            {
                return (false, $"TCP {ip}:{port} 收发失败: {ex.Message}", null);
            }
            finally
            {
                try { listener?.Stop(); } catch { /* 忽略 */ }
                client?.Dispose();
            }
        }
    }
}
