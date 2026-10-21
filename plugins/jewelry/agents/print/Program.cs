using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;
using PrintAgent.Forms;
using PrintAgent.Models;
using PrintAgent.Services;

namespace PrintAgent
{
    internal static class Program
    {
        private static Mutex? _mutex;

        [STAThread]
        static void Main(string[] args)
        {
            const string appName = @"Global\PrintAgent_SingleInstance_Mutex";
            _mutex = new Mutex(true, appName, out bool createdNew);
            if (!createdNew && args.Contains("--updated"))
            {
                // 升级重启场景: 等待旧进程退出释放互斥体(旧进程退出时 mutex 被 abandoned, WaitOne 仍会获得所有权)
                try { createdNew = _mutex.WaitOne(TimeSpan.FromSeconds(15)); }
                catch (AbandonedMutexException) { createdNew = true; }
            }
            if (!createdNew)
            {
                MessageBox.Show("PrintAgent is already running!", "Info", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.SetHighDpiMode(HighDpiMode.DpiUnaware);
            ApplicationConfiguration.Initialize();
            System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance); // 启用 GBK 等代码页(小票打印需要)

            var config = AppConfig.Load();
            I18nService.SetLanguage(config.Language);

            var dispatcher = new PrintDispatcher();
            var cloudSync = new CloudSyncService(config, dispatcher);
            var httpServer = new LocalHttpServer(config.LocalHttpPort, config, cloudSync);

            try
            {
                httpServer.Start();
                cloudSync.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Startup failed: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // 启动即下发固定撕裂线偏移(17.0mm, X19D 硬件撕纸参数, CONFIG tear → #UM>FD, 打印机 NV 持久):
            // 走统一指令层(zmin/USB), 失败仅记日志, 不弹窗不阻塞启动
            _ = Task.Run(async () =>
            {
                try
                {
                    string cmds = $"CONFIG tear,{AppConfig.FixedTearOffsetMm.ToString(System.Globalization.CultureInfo.InvariantCulture)}";
                    var (code, msg, _) = await RfidCommandExecutor.ExecuteAsync("zmin", "USB", "", "", cmds, 8000, false);
                    Console.WriteLine($"[PrintAgent] 启动下发 {cmds}: code={code}, msg={msg}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[PrintAgent] 启动下发 CONFIG tear 失败: {ex.Message}");
                }
            });

            Icon appIcon;
            try
            {
                // 单文件发布时 BaseDirectory 是解包临时目录, 用 exe 所在目录查找 app.ico
                string exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppDomain.CurrentDomain.BaseDirectory;
                string icoFile = Path.Combine(exeDir, "app.ico");
                if (File.Exists(icoFile))
                    appIcon = new Icon(icoFile);
                else
                    appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
            }
            catch
            {
                appIcon = SystemIcons.Application;
            }

            var trayIcon = new NotifyIcon
            {
                Text = I18nService.T("TrayTooltip"),
                Icon = appIcon,
                Visible = true
            };

            FormMain mainForm = new FormMain(config, httpServer, cloudSync, trayIcon);

            void ShowTrayTip(string msg, ToolTipIcon icon)
            {
                try { mainForm.BeginInvoke(new Action(() => trayIcon.ShowBalloonTip(3000, "PrintAgent", msg, icon))); }
                catch { trayIcon.ShowBalloonTip(3000, "PrintAgent", msg, icon); }
            }

            var updateService = new UpdateService(config, ShowTrayTip);

            Action shutdown = () =>
            {
                updateService.Stop();
                trayIcon.Visible = false;
                cloudSync.Stop();
                httpServer.Stop();
                Application.Exit();
            };

            mainForm.ExitRequested = shutdown;
            updateService.UpdateApplied += () => { try { mainForm.BeginInvoke(shutdown); } catch { } };

            var contextMenu = new ContextMenuStrip();
            var menuShow = new ToolStripMenuItem(I18nService.T("MenuShow"));
            menuShow.Click += (s, e) => {
                mainForm.Show();
                mainForm.WindowState = FormWindowState.Normal;
                mainForm.BringToFront();
            };

            var menuCheckUpdate = new ToolStripMenuItem(I18nService.T("MenuCheckUpdate"));
            menuCheckUpdate.Click += async (s, e) => await updateService.CheckNowAsync();

            var menuExit = new ToolStripMenuItem(I18nService.T("MenuExit"));
            menuExit.Click += (s, e) => shutdown();

            contextMenu.Items.Add(menuShow);
            contextMenu.Items.Add(menuCheckUpdate);
            contextMenu.Items.Add(new ToolStripSeparator());
            contextMenu.Items.Add(menuExit);

            trayIcon.ContextMenuStrip = contextMenu;
            trayIcon.DoubleClick += (s, e) => {
                mainForm.Show();
                mainForm.WindowState = FormWindowState.Normal;
                mainForm.BringToFront();
            };

            updateService.Start();

            mainForm.WindowState = FormWindowState.Normal;
            mainForm.ShowInTaskbar = true;

            Application.Run(mainForm);
        }
    }
}
