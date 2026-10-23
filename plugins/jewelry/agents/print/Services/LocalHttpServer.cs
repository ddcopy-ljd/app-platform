using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    public class LocalHttpServer
    {
        private readonly int _port;
        private readonly AppConfig _config;
        private readonly CloudSyncService _cloudSync;
        private readonly PrintDispatcher _dispatcher = new PrintDispatcher();
        private IHost? _host;

        public event Action<string, string>? OnConfigReceived;
        public event Action<PrintTask>? OnPrintTaskReceived;
        public event Action<PrintTask, bool, string>? OnPrintTaskFinished;

        public LocalHttpServer(int port, AppConfig config, CloudSyncService cloudSync)
        {
            _port = port;
            _config = config;
            _cloudSync = cloudSync;
        }

        public void Start()
        {
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.ConfigureKestrel(options =>
            {
                // 仅回环 http 监听: 浏览器直接访问无需自签证书, 同时对齐 AGENTS.md 仅回环约束
                options.Listen(System.Net.IPAddress.Loopback, _port);
            });
            // 静默 Kestrel 控制台日志
            builder.Logging.ClearProviders();

            var app = builder.Build();

            // CORS
            app.Use(async (ctx, next) =>
            {
                ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
                ctx.Response.Headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS";
                ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-Store-Key";
                if (ctx.Request.Method == "OPTIONS")
                {
                    ctx.Response.StatusCode = 200;
                    return;
                }
                await next();
            });

            app.MapGet("/api/ping", () => Results.Json(new { code = 0, msg = "pong", time = DateTime.Now }));

            app.MapGet("/api/status", () =>
            {
                var printers = PrinterDiscoveryService.GetAllLocalPrinters();
                return Results.Json(new
                {
                    code = 0,
                    configured = _config.IsConfigured,
                    storeId = _config.StoreId,
                    serverUrl = _config.ServerUrl,
                    cloudState = _cloudSync.CurrentState.ToString(),
                    printers = printers
                });
            });

            app.MapGet("/api/tasks", () => Results.Json(new { code = 0, data = PrintDispatcher.GetRecentTasks() }));

            app.MapPost("/api/calibrate", async (HttpContext ctx) =>
            {
                var j = await ReadBody(ctx);
                string action = (j.Value<string>("action") ?? "paper").ToLower();
                (bool ok, string msg) r;
                string? epc = null;
                switch (action)
                {
                    case "paper": r = UsbPcleService.PaperCalibrate(); break;
                    case "rfid": r = UsbPcleService.RfidCalibrate(); break;
                    case "config": r = UsbPcleService.PrintConfigPage(); break;
                    case "info": r = UsbPcleService.QueryInfo(j.Value<int?>("type") ?? 1); break;
                    case "epc_read": { var (ok2, msg2, epc2) = UsbPcleService.ReadEpc(); r = (ok2, msg2); epc = epc2; break; }
                    case "epc_write": r = UsbPcleService.WriteEpc(j.Value<string>("epc") ?? "", j.Value<string>("layout") ?? "N\r"); break;
                    case "raw": r = UsbPcleService.SendRaw(j.Value<string>("rawCommands") ?? ""); break;
                    case "power": r = UsbPcleService.SetRfPower(j.Value<int?>("read") ?? 0, j.Value<int?>("write") ?? 0); break;
                    default: r = (false, $"未知 action: {action}"); break;
                }
                return Results.Json(new { code = r.ok ? 0 : 1, msg = r.msg, epc, action });
            });

            // 页面注入门店 key: 相同返回已配置, 不同则接收并触发云端注册
            app.MapPost("/api/init", async (HttpContext ctx) =>
            {
                var j = await ReadBody(ctx);
                string serverUrl = j.Value<string>("serverUrl") ?? "";
                string storeKey = j.Value<string>("storeKey") ?? "";
                string storeId = j.Value<string>("storeId") ?? "";

                if (string.IsNullOrWhiteSpace(serverUrl) || string.IsNullOrWhiteSpace(storeKey))
                    return Results.Json(new { code = 400, msg = "serverUrl 与 storeKey 不能为空" }, statusCode: 400);

                bool sameEndpoint = _config.IsConfigured
                    && string.Equals(_config.StoreKey, storeKey, StringComparison.Ordinal)
                    && string.Equals(_config.ServerUrl, serverUrl, StringComparison.Ordinal);

                // 地址与密钥没变、仅门店号变化：必须写进内存里的 _config 并重连,
                // 否则 register 仍带旧门店号, 云端任务会因门店不匹配被静默拒收。
                if (!string.IsNullOrWhiteSpace(storeId)
                    && !string.Equals(_config.StoreId, storeId, StringComparison.Ordinal))
                {
                    _config.StoreId = storeId;
                    _config.Save();
                    _cloudSync.Restart();
                    return Results.Json(new { code = 0, msg = "门店绑定已更新", configured = true, updated = true });
                }

                if (sameEndpoint)
                    return Results.Json(new { code = 0, msg = "已配置", configured = true });

                // 先写入共享配置对象, OnConfigReceived 的 Save() 才会带上 storeId
                if (!string.IsNullOrWhiteSpace(storeId)) _config.StoreId = storeId;
                OnConfigReceived?.Invoke(serverUrl, storeKey);
                return Results.Json(new { code = 0, msg = "配置已更新, 正在连接云端", configured = false, updated = true });
            });

            app.MapPost("/api/print", async (HttpContext ctx) =>
            {
                string raw = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
                var task = JsonConvert.DeserializeObject<PrintTask>(raw) ?? new PrintTask();
                task.Source = "Local";
                task.ContentJson = raw;
                task.Status = "执行中";
                OnPrintTaskReceived?.Invoke(task);
                _ = Task.Run(async () =>
                {
                    var (success, msg) = await _dispatcher.DispatchAsync(task);
                    task.Status = success ? "已完成" : "失败";
                    OnPrintTaskFinished?.Invoke(task, success, msg);
                });
                return Results.Json(new { code = 0, msg = "任务已提交执行", taskId = task.TaskId });
            });

            _host = app;
            _ = app.RunAsync();
        }

        public async void Stop()
        {
            if (_host != null)
            {
                await _host.StopAsync();
                _host = null;
            }
        }

        private static async Task<Newtonsoft.Json.Linq.JObject> ReadBody(HttpContext ctx)
        {
            string raw = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            return string.IsNullOrWhiteSpace(raw)
                ? new Newtonsoft.Json.Linq.JObject()
                : Newtonsoft.Json.Linq.JObject.Parse(raw);
        }
    }
}
