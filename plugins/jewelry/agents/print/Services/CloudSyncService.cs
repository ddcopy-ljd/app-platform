using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    public enum CloudState
    {
        NotConfigured,
        Connecting,
        Connected,
        Disconnected
    }

    public class CloudSyncService
    {
        private ClientWebSocket? _webSocket;
        private CancellationTokenSource? _cts;
        private readonly AppConfig _config;
        private readonly PrintDispatcher _dispatcher;
        private bool _isDisposed;

        /// <summary>当前云端连接状态（供 /api/status 探查）</summary>
        public CloudState CurrentState { get; private set; } = CloudState.NotConfigured;

        public event Action<CloudState, string>? OnConnectionStateChanged;
        public event Action<PrintTask>? OnCloudTaskReceived;
        public event Action<PrintTask, bool, string>? OnCloudTaskFinished;

        /// <summary>本地打印机与服务端记录不匹配时触发(缺失或离线), 参数为缺失/离线的打印机名列表</summary>
        public event Action<List<string>>? OnPrinterMismatch;

        public CloudSyncService(AppConfig config, PrintDispatcher dispatcher)
        {
            _config = config;
            _dispatcher = dispatcher;
        }

        public void Start()
        {
            _isDisposed = false;
            _cts?.Cancel();
            _cts = new CancellationTokenSource();
            _ = ConnectionLoopAsync(_cts.Token);
        }

        public void Stop()
        {
            _isDisposed = true;
            _cts?.Cancel();
            CloseSocketAsync();
        }

        public void Restart()
        {
            Stop();
            Start();
        }

        private async Task ConnectionLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested && !_isDisposed)
            {
                if (!_config.IsConfigured || string.IsNullOrWhiteSpace(_config.ServerUrl))
                {
                    CurrentState = CloudState.NotConfigured;
                    OnConnectionStateChanged?.Invoke(CloudState.NotConfigured, string.Empty);
                    await Task.Delay(3000, token).ContinueWith(_ => { });
                    continue;
                }

                try
                {
                    CurrentState = CloudState.Connecting;
                    OnConnectionStateChanged?.Invoke(CloudState.Connecting, string.Empty);
                    _webSocket = new ClientWebSocket();

                    _webSocket.Options.SetRequestHeader("X-Store-Key", _config.StoreKey);
                    _webSocket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

                    var serverUri = new Uri(_config.ServerUrl);
                    await _webSocket.ConnectAsync(serverUri, token);

                    CurrentState = CloudState.Connected;
                    OnConnectionStateChanged?.Invoke(CloudState.Connected, string.Empty);

                    var authPayload = new
                    {
                        type = "register",
                        storeKey = _config.StoreKey,
                        storeId = _config.StoreId,
                        clientTime = DateTime.Now,
                        printers = PrinterDiscoveryService.GetAllLocalPrinters()
                    };
                    await SendJsonAsync(authPayload, token);

                    // 心跳: 每 5 秒上报, 后端据此判定在线(15 秒超时)
                    var heartbeatTask = HeartbeatLoopAsync(token);

                    await ReceiveLoopAsync(_webSocket, token);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    CurrentState = CloudState.Disconnected;
                    OnConnectionStateChanged?.Invoke(CloudState.Disconnected, ex.Message);
                }
                finally
                {
                    CloseSocketAsync();
                }

                await Task.Delay(5000, token).ContinueWith(_ => { });
            }
        }

        /// <summary>连接期间定时发心跳, 维持后端在线判定</summary>
        private async Task HeartbeatLoopAsync(CancellationToken token)
        {
            try
            {
                while (!token.IsCancellationRequested && _webSocket != null && _webSocket.State == WebSocketState.Open)
                {
                    await SendJsonAsync(new { type = "heartbeat", time = DateTime.Now }, token);
                    await Task.Delay(5000, token).ContinueWith(_ => { });
                }
            }
            catch { }
        }

        private async Task ReceiveLoopAsync(ClientWebSocket ws, CancellationToken token)
        {
            var buffer = new byte[1024 * 64];
            var ms = new System.IO.MemoryStream();

            while (ws.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                WebSocketReceiveResult result;
                do
                {
                    result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", token);
                        return;
                    }
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                string message = Encoding.UTF8.GetString(ms.ToArray());
                ms.SetLength(0);

                _ = Task.Run(() => HandleIncomingMessageAsync(message, token));
            }
        }

        private async Task HandleIncomingMessageAsync(string message, CancellationToken token)
        {
            try
            {
                var jMsg = JObject.Parse(message);
                string msgType = jMsg.Value<string>("type") ?? "";

                if (msgType.Equals("ping", StringComparison.OrdinalIgnoreCase))
                {
                    await SendJsonAsync(new { type = "pong", time = DateTime.Now }, token);
                    return;
                }

                // 服务端推送的门店配置: 含 biz_printers(业务→打印机名), 与本地打印机对比, 缺失/离线报警
                if (msgType.Equals("config", StringComparison.OrdinalIgnoreCase))
                {
                    CheckPrinterMismatch(jMsg);
                    return;
                }

                // 远程维护设备指令 (珠宝云预留通道, 本期仅 printer): exec|capabilities|profile_get|profile_set → device_ack
                if (msgType.Equals("device_cmd", StringComparison.OrdinalIgnoreCase))
                {
                    string taskId = jMsg.Value<string>("taskId") ?? Guid.NewGuid().ToString("N");

                    // 门店/租户校验: 复用 print_task 过滤模式, 不符即拒收
                    string cmdStore = jMsg.Value<string>("storeId") ?? "";
                    if (string.IsNullOrWhiteSpace(cmdStore)) cmdStore = jMsg.Value<string>("storeKey") ?? "";
                    if (!string.IsNullOrWhiteSpace(cmdStore))
                    {
                        bool bound = string.IsNullOrEmpty(_config.StoreId) && string.IsNullOrEmpty(_config.StoreKey)
                            ? false
                            : cmdStore.Equals(_config.StoreId, StringComparison.OrdinalIgnoreCase)
                              || cmdStore.Equals(_config.StoreKey, StringComparison.OrdinalIgnoreCase);
                        if (!bound)
                        {
                            await SendJsonAsync(new { type = "device_ack", taskId, code = 1, msg = $"门店不匹配, 已拒收 (任务门店: {cmdStore})", finishTime = DateTime.Now }, token);
                            return;
                        }
                    }

                    string targetType = (jMsg.Value<string>("targetType") ?? "printer").ToLowerInvariant();
                    if (targetType != "printer")
                    {
                        await SendJsonAsync(new { type = "device_ack", taskId, code = 1, msg = $"暂不支持的设备类型: {targetType} (本期仅 printer; pda/pc 预留)", finishTime = DateTime.Now }, token);
                        return;
                    }

                    string action = (jMsg.Value<string>("action") ?? "exec").ToLowerInvariant();
                    string brand = jMsg.Value<string>("brand") ?? "zmin";
                    string iface = jMsg.Value<string>("interface") ?? "USB";
                    string ip = jMsg.Value<string>("ip") ?? "";
                    string target = jMsg.Value<string>("target") ?? "";
                    int code; string msg; string? data;

                    switch (action)
                    {
                        case "exec":
                        {
                            var r = await RfidCommandExecutor.ExecuteAsync(
                                brand, iface, ip, target,
                                jMsg.Value<string>("commands") ?? "",
                                jMsg.Value<int?>("timeoutMs") ?? 20000,
                                jMsg.Value<bool?>("dryRun") ?? false);
                            (code, msg, data) = r;
                            break;
                        }
                        case "capabilities":
                        {
                            var cap = (JObject)JsonConvert.DeserializeObject(JsonConvert.SerializeObject(RfidCommandExecutor.Capabilities(brand)))!;
                            code = cap.Value<int>("code");
                            msg = cap.Value<string>("msg") ?? "ok";
                            data = cap["data"]?.ToString(Newtonsoft.Json.Formatting.None);
                            break;
                        }
                        case "profile_get":
                        {
                            string key = RfidCommandExecutor.ProfileKey(brand, iface, ip, target);
                            _config.DeviceProfiles.TryGetValue(key, out var prof);
                            code = 0; msg = prof == null ? "该设备无档案" : "ok";
                            data = prof == null ? null : JsonConvert.SerializeObject(prof);
                            break;
                        }
                        case "profile_set":
                        {
                            var prof = jMsg["profile"]?.ToObject<DeviceProfile>();
                            if (prof == null) { code = 1; msg = "profile 不能为空"; data = null; break; }
                            string key = RfidCommandExecutor.ProfileKey(brand, iface, ip, target);
                            _config.DeviceProfiles[key] = prof;
                            _config.Save();
                            code = 0; msg = $"设备档案已保存: {key}"; data = null;
                            break;
                        }
                        // 标签纸形状库 (珠宝云管理后台预留): 绑定复用 profile_set(LabelPaperId)
                        case "labelpaper_list":
                            code = 0; msg = "ok";
                            data = JsonConvert.SerializeObject(LabelPaperStore.Load());
                            break;
                        case "labelpaper_save":
                        {
                            var paper = jMsg["paper"]?.ToObject<LabelPaper>();
                            if (paper == null) { code = 1; msg = "paper 不能为空"; data = null; break; }
                            paper.Source = "cloud";
                            code = 0; msg = "标签纸已保存";
                            data = JsonConvert.SerializeObject(LabelPaperStore.Upsert(paper));
                            break;
                        }
                        case "labelpaper_delete":
                        {
                            bool del = LabelPaperStore.Delete(jMsg.Value<string>("id") ?? "");
                            code = del ? 0 : 1; msg = del ? "已删除" : "未找到该 Id 的标签纸"; data = null;
                            break;
                        }
                        case "labelpaper_sync":
                        {
                            var papers = jMsg["papers"]?.ToObject<List<LabelPaper>>();
                            if (papers == null || papers.Count == 0) { code = 1; msg = "papers 不能为空"; data = null; break; }
                            var (added, updatedCnt) = LabelPaperStore.Sync(papers, jMsg.Value<string>("mode") ?? "replace");
                            code = 0; msg = $"整库同步完成: 新增 {added}, 更新 {updatedCnt}"; data = null;
                            break;
                        }
                        default:
                            code = 1; msg = $"未知 action: {action} (exec|capabilities|profile_get|profile_set|labelpaper_list|labelpaper_save|labelpaper_delete|labelpaper_sync)"; data = null;
                            break;
                    }

                    await SendJsonAsync(new { type = "device_ack", taskId, code, msg, data, finishTime = DateTime.Now }, token);
                    return;
                }

                if (msgType.Equals("print_task", StringComparison.OrdinalIgnoreCase) || jMsg["printerType"] != null)
                {
                    var task = JsonConvert.DeserializeObject<PrintTask>(message) ?? new PrintTask();
                    task.Source = "Cloud";
                    task.ContentJson = message;
                    task.Status = "执行中";

                    // 门店绑定过滤: 任务带 storeId/storeKey 且与本机配置不符 -> 拒收, 防止执行别家门店任务
                    string taskStore = task.StoreId;
                    if (string.IsNullOrWhiteSpace(taskStore)) taskStore = jMsg.Value<string>("storeKey") ?? "";
                    if (!string.IsNullOrWhiteSpace(taskStore))
                    {
                        bool bound = string.IsNullOrEmpty(_config.StoreId) && string.IsNullOrEmpty(_config.StoreKey)
                            ? false
                            : taskStore.Equals(_config.StoreId, StringComparison.OrdinalIgnoreCase)
                              || taskStore.Equals(_config.StoreKey, StringComparison.OrdinalIgnoreCase);
                        if (!bound)
                        {
                            PrintDispatcher.RecordTask(task, false, $"门店不匹配: 任务门店 {taskStore} ≠ 本机 {_config.StoreId}/{_config.StoreKey}");
                            await SendJsonAsync(new
                            {
                                type = "task_ack",
                                taskId = task.TaskId,
                                success = false,
                                message = $"门店不匹配, 已拒收 (任务门店: {taskStore})",
                                finishTime = DateTime.Now
                            }, token);
                            return;
                        }
                    }

                    OnCloudTaskReceived?.Invoke(task);

                    var (success, msg) = await _dispatcher.DispatchAsync(task);
                    task.Status = success ? "已完成" : "失败";

                    OnCloudTaskFinished?.Invoke(task, success, msg);

                    var ack = new
                    {
                        type = "task_ack",
                        taskId = task.TaskId,
                        success = success,
                        message = msg,
                        finishTime = DateTime.Now
                    };
                    await SendJsonAsync(ack, token);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"解析云端报文失败: {ex.Message}");
            }
        }

        public async Task SendJsonAsync(object obj, CancellationToken token = default)
        {
            if (_webSocket != null && _webSocket.State == WebSocketState.Open)
            {
                string json = JsonConvert.SerializeObject(obj);
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                await _webSocket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
            }
        }

        /// <summary>对比服务端 biz_printers 与本地打印机, 缺失或离线的触发报警</summary>
        private void CheckPrinterMismatch(JObject configMsg)
        {
            try
            {
                var bizPrinters = configMsg["biz_printers"] as JObject;
                if (bizPrinters == null) return;

                // 服务端记录的打印机名集合(去重, 空串跳过)
                var expected = bizPrinters.Properties()
                    .Select(p => p.Value?.ToString() ?? "")
                    .Where(n => !string.IsNullOrWhiteSpace(n))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                if (expected.Count == 0) return;

                var local = PrinterDiscoveryService.GetAllLocalPrinters();
                var localNames = new HashSet<string>(
                    local.Select(p => p.Name), StringComparer.OrdinalIgnoreCase);

                var problems = new List<string>();
                foreach (var name in expected)
                {
                    if (!localNames.Contains(name))
                    {
                        problems.Add($"缺失: {name}");
                    }
                    else
                    {
                        var dev = local.FirstOrDefault(p =>
                            string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
                        if (dev != null && !dev.Online)
                            problems.Add($"离线: {name}");
                    }
                }

                if (problems.Count > 0)
                    OnPrinterMismatch?.Invoke(problems);
            }
            catch { }
        }

        private void CloseSocketAsync()
        {
            try
            {
                if (_webSocket != null)
                {
                    _webSocket.Dispose();
                    _webSocket = null;
                }
            }
            catch { }
        }
    }
}
