using System;
using System.Drawing;
using System.Windows.Forms;
using PrintAgent.Models;
using PrintAgent.Services;

namespace PrintAgent.Forms
{
    public partial class FormMain : Form
    {
        private readonly NotifyIcon _trayIcon;
        private readonly AppConfig _config;
        private readonly LocalHttpServer _httpServer;
        private readonly CloudSyncService _cloudSync;

        private Label _lblStatus = null!;
        private Label _lblCloudStatus = null!;
        private Label _lblConfig = null!;
        private ListView _taskListView = null!;
        private ComboBox _cboLang = null!;
        private CloudState _currentCloudState = CloudState.NotConfigured;
        private bool _exitConfirmed;

        /// <summary>宿主(Program)注入的退出动作: 停止服务并结束进程。</summary>
        public Action? ExitRequested { get; set; }

        public enum TaskItemState
        {
            Pending,
            Success,
            Failed
        }

        public class TaskRowTag
        {
            public string TaskId { get; set; } = string.Empty;
            public TaskItemState State { get; set; } = TaskItemState.Pending;
            public string Detail { get; set; } = string.Empty;
        }

        public FormMain(AppConfig config, LocalHttpServer httpServer, CloudSyncService cloudSync, NotifyIcon trayIcon)
        {
            _config = config;
            _httpServer = httpServer;
            _cloudSync = cloudSync;
            _trayIcon = trayIcon;

            I18nService.SetLanguage(_config.Language);

            InitializeCustomUI();
            BindEvents();
            ApplyLanguage();
        }

        private void InitializeCustomUI()
        {
            this.AutoScaleMode = AutoScaleMode.None;
            this.ClientSize = new Size(880, 480);
            this.MinimumSize = new Size(880, 400);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Icon = _trayIcon.Icon;

            var topPanel = new Panel { Dock = DockStyle.Top, Height = 90, BackColor = Color.FromArgb(245, 247, 250) };
            _lblStatus = new Label { Location = new Point(15, 12), AutoSize = true, Font = new Font("Microsoft YaHei", 9.5f, FontStyle.Bold) };
            _lblCloudStatus = new Label { Location = new Point(320, 12), AutoSize = true, Font = new Font("Microsoft YaHei", 9.5f, FontStyle.Bold), ForeColor = Color.DarkGoldenrod };
            _lblConfig = new Label { Location = new Point(15, 45), AutoSize = true, Font = new Font("Microsoft YaHei", 9f), ForeColor = Color.FromArgb(100, 100, 100) };

            _cboLang = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Width = 110,
                Location = new Point(740, 10)
            };
            foreach (var item in I18nService.SupportedLanguages)
            {
                _cboLang.Items.Add(new LangItem(item.Key, item.Value));
            }
            _cboLang.SelectedIndexChanged += (s, e) =>
            {
                if (_cboLang.SelectedItem is LangItem selected)
                {
                    _config.Language = selected.Code;
                    _config.Save();
                    I18nService.SetLanguage(selected.Code);
                    ApplyLanguage();
                }
            };

            topPanel.Controls.Add(_lblStatus);
            topPanel.Controls.Add(_lblCloudStatus);
            topPanel.Controls.Add(_lblConfig);
            topPanel.Controls.Add(_cboLang);

            // ===== 底部: 标签参数与校准入口(校准/参数配置已合并到独立窗口) =====
            var bottomPanel = new Panel { Dock = DockStyle.Bottom, Height = 56, BackColor = Color.FromArgb(245, 247, 250) };
            var btnConfig = new Button { Text = "标签参数与校准", Location = new Point(16, 12), Width = 150, Height = 32 };
            btnConfig.Click += (s, e) =>
            {
                using var dlg = new FormPrinterConfig(_config);
                dlg.ShowDialog(this);
            };
            bottomPanel.Controls.Add(btnConfig);

            _taskListView = new ListView
            {
                Dock = DockStyle.Fill,
                View = View.Details,
                FullRowSelect = true,
                GridLines = true
            };
            _taskListView.Columns.Add("", 140);
            _taskListView.Columns.Add("", 65);
            _taskListView.Columns.Add("", 90);
            _taskListView.Columns.Add("", 150);
            _taskListView.Columns.Add("", 80);
            _taskListView.Columns.Add("", 170);
            _taskListView.Columns.Add("", 120);

            this.Controls.Add(_taskListView);
            this.Controls.Add(topPanel);
            this.Controls.Add(bottomPanel);
        }

        public void ApplyLanguage()
        {
            this.Text = I18nService.T("AppTitle");
            _trayIcon.Text = I18nService.T("TrayTooltip");

            _taskListView.Columns[0].Text = I18nService.T("ColTime");
            _taskListView.Columns[1].Text = I18nService.T("ColSource");
            _taskListView.Columns[2].Text = I18nService.T("ColType");
            _taskListView.Columns[3].Text = I18nService.T("ColPrinter");
            _taskListView.Columns[4].Text = I18nService.T("ColStatus");
            _taskListView.Columns[5].Text = I18nService.T("ColInfo");
            _taskListView.Columns[6].Text = I18nService.T("ColTaskId");

            for (int i = 0; i < _cboLang.Items.Count; i++)
            {
                if (_cboLang.Items[i] is LangItem item && item.Code == I18nService.CurrentLang)
                {
                    _cboLang.SelectedIndex = i;
                    break;
                }
            }

            // 联动刷新已有任务列表每行的状态与信息文字
            foreach (ListViewItem item in _taskListView.Items)
            {
                if (item.Tag is TaskRowTag tag)
                {
                    switch (tag.State)
                    {
                        case TaskItemState.Pending:
                            item.SubItems[4].Text = I18nService.T("StatusPending");
                            item.SubItems[4].ForeColor = Color.DarkGoldenrod;
                            item.SubItems[5].Text = I18nService.T("StatusPending");
                            break;
                        case TaskItemState.Success:
                            item.SubItems[4].Text = I18nService.T("StatusSuccess");
                            item.SubItems[4].ForeColor = Color.Green;
                            item.SubItems[5].Text = string.IsNullOrEmpty(tag.Detail) ? I18nService.T("SuccessDetail") : tag.Detail;
                            break;
                        case TaskItemState.Failed:
                            item.SubItems[4].Text = I18nService.T("StatusFailed");
                            item.SubItems[4].ForeColor = Color.Red;
                            item.SubItems[5].Text = tag.Detail;
                            break;
                    }
                }
            }

            UpdateConfigUI();
            UpdateCloudStatusUI();
        }

        private void BindEvents()
        {
            _httpServer.OnConfigReceived += (serverUrl, storeKey) =>
            {
                this.Invoke(new Action(() =>
                {
                    _config.ServerUrl = serverUrl;
                    _config.StoreKey = storeKey;
                    _config.IsConfigured = true;
                    _config.Save();
                    UpdateConfigUI();
                    _trayIcon.ShowBalloonTip(2000, "PrintAgent", I18nService.T("CloudConnecting"), ToolTipIcon.Info);
                    _cloudSync.Restart();
                }));
            };

            _cloudSync.OnConnectionStateChanged += (state, _) =>
            {
                this.Invoke(new Action(() =>
                {
                    _currentCloudState = state;
                    UpdateCloudStatusUI();
                }));
            };

            // 本地打印机与服务端记录不匹配(缺失/离线)时报警
            _cloudSync.OnPrinterMismatch += problems =>
            {
                this.Invoke(new Action(() =>
                {
                    string detail = string.Join("\n", problems);
                    _trayIcon.ShowBalloonTip(5000, "打印机资源不匹配", detail, ToolTipIcon.Warning);
                }));
            };

            Action<PrintTask> insertTask = (task) =>
            {
                this.Invoke(new Action(() =>
                {
                    var item = new ListViewItem(task.CreatedAt.ToString("yyyy-MM-dd HH:mm:ss"));
                    item.Tag = new TaskRowTag
                    {
                        TaskId = task.TaskId,
                        State = TaskItemState.Pending,
                        Detail = ""
                    };
                    item.SubItems.Add(task.Source);
                    item.SubItems.Add(task.PrinterType);
                    item.SubItems.Add(task.Interface == "NET" ? task.PrinterIp : task.PrinterName);
                    item.SubItems.Add(I18nService.T("StatusPending"));
                    item.SubItems.Add(I18nService.T("StatusPending"));
                    item.SubItems.Add(task.TaskId);
                    item.SubItems[4].ForeColor = Color.DarkGoldenrod;

                    _taskListView.Items.Insert(0, item);
                }));
            };

            Action<PrintTask, bool, string> finishTask = (task, success, msg) =>
            {
                this.Invoke(new Action(() =>
                {
                    foreach (ListViewItem item in _taskListView.Items)
                    {
                        if (item.Tag is TaskRowTag tag && tag.TaskId == task.TaskId)
                        {
                            tag.State = success ? TaskItemState.Success : TaskItemState.Failed;
                            tag.Detail = msg;

                            item.SubItems[4].Text = success ? I18nService.T("StatusSuccess") : I18nService.T("StatusFailed");
                            item.SubItems[4].ForeColor = success ? Color.Green : Color.Red;
                            item.SubItems[5].Text = success && (string.IsNullOrEmpty(msg) || msg.Contains("成功"))
                                ? I18nService.T("SuccessDetail")
                                : msg;
                            break;
                        }
                    }
                }));
            };

            _httpServer.OnPrintTaskReceived += insertTask;
            _httpServer.OnPrintTaskFinished += finishTask;
            _cloudSync.OnCloudTaskReceived += insertTask;
            _cloudSync.OnCloudTaskFinished += finishTask;
        }

        private void UpdateConfigUI()
        {
            _lblStatus.Text = I18nService.T("LocalPort", _config.LocalHttpPort);
            if (_config.IsConfigured)
            {
                _lblConfig.Text = I18nService.T("ConfigStatusNormal", _config.ServerUrl, _config.StoreKey);
            }
            else
            {
                _lblConfig.Text = I18nService.T("ConfigStatusWaiting");
            }
        }

        private void UpdateCloudStatusUI()
        {
            string statusText;
            Color statusColor;

            switch (_currentCloudState)
            {
                case CloudState.Connected:
                    statusText = I18nService.T("CloudConnected");
                    statusColor = Color.Green;
                    break;
                case CloudState.Connecting:
                    statusText = I18nService.T("CloudConnecting");
                    statusColor = Color.DarkGoldenrod;
                    break;
                case CloudState.Disconnected:
                    statusText = I18nService.T("CloudDisconnected");
                    statusColor = Color.Crimson;
                    break;
                case CloudState.NotConfigured:
                default:
                    statusText = I18nService.T("CloudNotConfigured");
                    statusColor = Color.Gray;
                    break;
            }

            _lblCloudStatus.Text = I18nService.T("CloudStatus", statusText);
            _lblCloudStatus.ForeColor = statusColor;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && !_exitConfirmed)
            {
                var result = MessageBox.Show(this,
                    I18nService.T("ExitPromptText"),
                    I18nService.T("ExitPromptTitle"),
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
                if (result == DialogResult.Yes)
                {
                    _exitConfirmed = true;
                    ExitRequested?.Invoke(); // 走 Application.Exit, 二次进入本方法时 _exitConfirmed 已置位, 不会再弹窗
                }
                else
                {
                    e.Cancel = true;
                    this.Hide();
                    _trayIcon.ShowBalloonTip(1000, "PrintAgent", I18nService.T("TrayMinimized"), ToolTipIcon.None);
                }
            }
            base.OnFormClosing(e);
        }

        private class LangItem
        {
            public string Code { get; }
            public string Name { get; }
            public LangItem(string code, string name) { Code = code; Name = name; }
            public override string ToString() => Name;
        }
    }
}
