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

            app.MapGet("/api/printers", (HttpContext ctx) =>
            {
                string netParam = ctx.Request.Query["net"].ToString() ?? "";
                return Results.Json(new { code = 0, data = PrinterDiscoveryService.GetAllLocalPrinters(netParam) });
            });

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

            app.MapPost("/api/rfid/exec", async (HttpContext ctx) =>
            {
                var j = await ReadBody(ctx);
                var (code, msg, data) = await RfidCommandExecutor.ExecuteAsync(
                    j.Value<string>("brand") ?? "zmin",
                    j.Value<string>("interface") ?? "USB",
                    j.Value<string>("ip") ?? "",
                    j.Value<string>("name") ?? "",
                    j.Value<string>("commands") ?? "",
                    j.Value<int?>("timeoutMs") ?? 20000,
                    j.Value<bool?>("dryRun") ?? false);
                return Results.Json(new { code, msg, data });
            });

            app.MapGet("/api/rfid/capabilities", (HttpContext ctx) =>
            {
                string brand = ctx.Request.Query["brand"].ToString() ?? "zmin";
                return Results.Json(RfidCommandExecutor.Capabilities(brand));
            });

            app.MapGet("/api/labelpapers", () => Results.Json(new { code = 0, data = LabelPaperStore.Load() }));

            // 连接巡检状态（不打打印任务）：GET 读缓存 / POST action=probe 立即巡检
            app.MapGet("/api/printer-status", () => Results.Json(new { code = 0, data = ConnectionProbeService.Snapshot() }));
            app.MapPost("/api/printer-status", async (HttpContext ctx) =>
            {
                var j = await ReadBody(ctx);
                if ((j.Value<string>("action") ?? "").Equals("probe", StringComparison.OrdinalIgnoreCase))
                    ConnectionProbeService.ProbeOnce();
                return Results.Json(new { code = 0, data = ConnectionProbeService.Snapshot() });
            });

            // 云端指派目标登记（NET IP 等）：前端保存指派后调用，确保下轮巡检覆盖该目标
            app.MapPost("/api/printer-status/register", async (HttpContext ctx) =>
            {
                var j = await ReadBody(ctx);
                ConnectionProbeService.RegisterTarget(
                    j.Value<string>("brand") ?? "zmin",
                    j.Value<string>("interface") ?? "USB",
                    j.Value<string>("ip") ?? "",
                    j.Value<string>("name") ?? "");
                return Results.Json(new { code = 0, msg = "已登记巡检目标" });
            });

            // 标签方案应用（撕纸位置）：CONFIG tear 走统一指令层（NV 持久，三通道）
            app.MapPost("/api/print-config/apply", async (HttpContext ctx) =>
            {
                var j = await ReadBody(ctx);
                double? tear = j.Value<double?>("tear_mm");
                if (tear == null || tear <= 0)
                    return Results.Json(new { code = 1, msg = "缺少 tear_mm" });
                string cmds = $"CONFIG tear,{(tear.Value).ToString(System.Globalization.CultureInfo.InvariantCulture)}";
                var (code, msg, _) = await RfidCommandExecutor.ExecuteAsync(
                    j.Value<string>("brand") ?? "zmin",
                    j.Value<string>("interface") ?? "USB",
                    j.Value<string>("ip") ?? "",
                    j.Value<string>("name") ?? "",
                    cmds, 8000, false);
                return Results.Json(new { code, msg });
            });

            // 设备档案(含已绑定标签纸 Id): 门店详情卡片回显绑定用
            app.MapGet("/api/profiles", () => Results.Json(new { code = 0, data = AppConfig.Load().DeviceProfiles }));

            // 打印机 UI 偏好(用途备注/从列表移除): 按 ProfileKey 存设备档案, 仅本机
            app.MapPost("/api/printer-prefs", async (HttpContext ctx) =>
            {
                var j = await ReadBody(ctx);
                string brand = j.Value<string>("brand") ?? "zmin";
                string iface = j.Value<string>("interface") ?? "USB";
                string name = j.Value<string>("name") ?? "";
                string key = RfidCommandExecutor.ProfileKey(brand, iface, j.Value<string>("ip") ?? "", name);
                var cfg = AppConfig.Load();
                if (!cfg.DeviceProfiles.TryGetValue(key, out var prof) || prof == null)
                    cfg.DeviceProfiles[key] = prof = new DeviceProfile();
                if (j["hidden"] != null) prof.Hidden = j.Value<bool?>("hidden") ?? false;
                if (j["note"] != null) prof.Note = j.Value<string>("note") ?? "";
                cfg.Save();
                return Results.Json(new { code = 0, msg = $"已保存打印机偏好: {key}" });
            });

            app.MapPost("/api/labelpapers", async (HttpContext ctx) =>
            {
                var j = await ReadBody(ctx);
                string action = (j.Value<string>("action") ?? "save").ToLower();
                object resp;
                switch (action)
                {
                    case "save":
                        var paper = j["paper"]?.ToObject<LabelPaper>();
                        resp = paper == null
                            ? new { code = 1, msg = "paper 不能为空" }
                            : new { code = 0, msg = "标签纸已保存", data = LabelPaperStore.Upsert(paper) };
                        break;
                    case "delete":
                        bool del = LabelPaperStore.Delete(j.Value<string>("id") ?? "");
                        resp = new { code = del ? 0 : 1, msg = del ? "已删除" : "未找到该 Id 的标签纸" };
                        break;
                    case "bind":
                        string brand = j.Value<string>("brand") ?? "zmin";
                        string iface = j.Value<string>("interface") ?? "USB";
                        string lpId = j.Value<string>("labelPaperId") ?? "";
                        string bindWarn = "";
                        if (!string.IsNullOrWhiteSpace(lpId) && LabelPaperStore.Find(lpId) == null)
                            bindWarn = " (该标签纸 Id 不存在于形状库, 执行时将忽略)";
                        var cfg = AppConfig.Load();
                        string key = RfidCommandExecutor.ProfileKey(brand, iface,
                            j.Value<string>("ip") ?? "", j.Value<string>("name") ?? "");
                        if (!cfg.DeviceProfiles.TryGetValue(key, out var prof) || prof == null)
                            cfg.DeviceProfiles[key] = prof = new DeviceProfile();
                        prof.LabelPaperId = string.IsNullOrWhiteSpace(lpId) ? null : lpId;
                        cfg.Save();
                        resp = new { code = 0, msg = (string.IsNullOrWhiteSpace(lpId) ? $"已解绑标签纸: {key}" : $"已绑定标签纸: {key} -> {lpId}") + bindWarn };
                        break;
                    default:
                        resp = new { code = 1, msg = $"未知 action: {action}" };
                        break;
                }
                return Results.Json(resp);
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

                if (_config.IsConfigured
                    && string.Equals(_config.StoreKey, storeKey, StringComparison.Ordinal)
                    && string.Equals(_config.ServerUrl, serverUrl, StringComparison.Ordinal))
                    return Results.Json(new { code = 0, msg = "已配置", configured = true });

                OnConfigReceived?.Invoke(serverUrl, storeKey);
                if (!string.IsNullOrWhiteSpace(storeId))
                {
                    var cfg = AppConfig.Load();
                    cfg.StoreId = storeId;
                    cfg.Save();
                }
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
