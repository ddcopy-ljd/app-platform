using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using PrintAgent.Models;
using PrintAgent.Services;

namespace PrintAgent.Forms
{
    /// <summary>
    /// 打印机参数配置窗口。
    /// 左侧「标签方案」仅保存标签规格(尺寸/边距/天线位置), 一种标签纸一套方案;
    /// 右侧「打印参数 / 网络参数 / 蓝牙参数」为全局统一保存(写入 config.json, 不随方案变化);
    /// 底部「保存」同时落盘方案与全局参数; 「应用到打印机」批量下发 撕裂线/网络/读写功率(均 NV 持久)。
    /// 另附「可连接打印机」列表(仅展示枚举结果, 不影响打印通道)。
    /// 布局用 FlowLayoutPanel 自动排列: 每个控件的名称紧贴自己的输入框, 字段之间留固定间距。
    /// </summary>
    public class FormPrinterConfig : Form
    {
        private readonly AppConfig _config;

        private ListBox _lstPapers = null!;
        private TextBox _txtName = null!;
        private NumericUpDown _numWidth = null!;
        private NumericUpDown _numHeight = null!;
        private NumericUpDown _numGap = null!;
        private NumericUpDown _numMarginL = null!;
        private NumericUpDown _numMarginR = null!;
        private NumericUpDown _numMarginT = null!;
        private NumericUpDown _numMarginB = null!;
        private NumericUpDown _numAntX = null!;
        private NumericUpDown _numAntY = null!;
        private NumericUpDown _numAntW = null!;
        private NumericUpDown _numAntH = null!;
        private NumericUpDown _numTear = null!;
        private NumericUpDown _numSpeed = null!;
        private NumericUpDown _numDarkness = null!;
        private ComboBox _cboDpi = null!;
        private NumericUpDown _numReadPower = null!;
        private NumericUpDown _numWritePower = null!;
        private TextBox _txtIp = null!;
        private TextBox _txtMask = null!;
        private TextBox _txtGateway = null!;
        private TextBox _txtBle = null!;
        private TextBox _txtSpp = null!;
        private ListView _lstPrinters = null!;
        private Button _btnRefreshPrinters = null!;
        private Button _btnTestPrint = null!;
        private Label _lblPrinterResult = null!;
        private GroupBox _grpPrinters = null!;
        private GroupBox _grpCalib = null!;
        private TextBox _txtEpc = null!;
        private Label _lblCalibResult = null!;
        private Label _lblResult = null!;
        private Control[] _calibControls = Array.Empty<Control>();

        private LabelPaper? _current;
        private bool _loading;

        public FormPrinterConfig(AppConfig config)
        {
            _config = config;
            InitializeUI();
            LoadGlobalToForm();
            LoadPapers();
            RefreshPrinters();
        }

        private void InitializeUI()
        {
            this.Text = "打印机参数配置";
            this.AutoScaleMode = AutoScaleMode.None;
            this.ClientSize = new Size(900, 680);
            this.MinimumSize = new Size(860, 560);
            this.StartPosition = FormStartPosition.CenterParent;
            this.Font = new Font("Microsoft YaHei", 9f);

            // ===== 左侧: 标签方案列表 =====
            var leftPanel = new Panel { Dock = DockStyle.Left, Width = 220, BackColor = Color.FromArgb(245, 247, 250) };
            var lblList = new Label { Text = "标签方案", Location = new Point(16, 14), AutoSize = true, Font = new Font("Microsoft YaHei", 9.5f, FontStyle.Bold) };
            _lstPapers = new ListBox { Location = new Point(16, 42), Width = 188, Height = 520 };
            _lstPapers.SelectedIndexChanged += (s, e) =>
            {
                if (_loading) return;
                if (_lstPapers.SelectedItem is LabelPaper p) LoadPaperToForm(p);
            };
            var btnAdd = new Button { Text = "新增方案", Location = new Point(16, 574), Width = 90, Height = 30 };
            btnAdd.Click += (s, e) => AddNewPaper();
            var btnDel = new Button { Text = "删除", Location = new Point(114, 574), Width = 90, Height = 30 };
            btnDel.Click += (s, e) => DeletePaper();
            leftPanel.Controls.AddRange(new Control[] { lblList, _lstPapers, btnAdd, btnDel });

            // ===== 右侧: 参数编辑(自动纵向排列 + 滚动) =====
            var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(16, 12, 16, 12) };
            var stack = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Location = new Point(16, 12)
            };

            // 方案名称
            var rowName = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, Margin = new Padding(0, 0, 0, 10) };
            rowName.Controls.Add(MkLabel("方案名称"));
            _txtName = new TextBox { Width = 220, Margin = new Padding(0, 2, 0, 0) };
            rowName.Controls.Add(_txtName);
            stack.Controls.Add(rowName);

            // 标签尺寸
            var grpSize = MkGroup("标签尺寸 (mm)");
            _numWidth = MkNum(grpSize, "宽", 0, 999, 1m);
            _numHeight = MkNum(grpSize, "高", 0, 999, 1m);
            _numGap = MkNum(grpSize, "间隙", 0, 50, 0.1m);
            FinishGroup(grpSize);
            stack.Controls.Add(grpSize);

            // 可打印区域边距
            var grpMargin = MkGroup("可打印区域边距 (mm)");
            _numMarginL = MkNum(grpMargin, "左", 0, 999, 0.5m);
            _numMarginR = MkNum(grpMargin, "右", 0, 999, 0.5m);
            _numMarginT = MkNum(grpMargin, "上", 0, 999, 0.5m);
            _numMarginB = MkNum(grpMargin, "下", 0, 999, 0.5m);
            FinishGroup(grpMargin);
            stack.Controls.Add(grpMargin);

            // 天线位置
            var grpAnt = MkGroup("天线 (inlay) 位置 mm, 相对标签左上角");
            _numAntX = MkNum(grpAnt, "中心X", 0, 999, 0.5m);
            _numAntY = MkNum(grpAnt, "中心Y", 0, 999, 0.5m);
            _numAntW = MkNum(grpAnt, "宽", 0, 999, 0.5m);
            _numAntH = MkNum(grpAnt, "高", 0, 999, 0.5m);
            FinishGroup(grpAnt);
            stack.Controls.Add(grpAnt);

            // 打印参数 (全局统一保存)
            var grpPrint = MkGroup("打印参数 (全局统一保存)");
            _numTear = MkNum(grpPrint, "撕裂线mm", 0, 999, 0.5m);
            _numSpeed = MkNum(grpPrint, "速度", 0, 20, 1m);
            _numDarkness = MkNum(grpPrint, "黑度", 0, 20, 1m);
            _cboDpi = new ComboBox { Width = 74, DropDownStyle = ComboBoxStyle.DropDownList };
            _cboDpi.Items.AddRange(new object[] { "203", "300" });
            FlowOf(grpPrint).Controls.Add(MkField("DPI", _cboDpi));
            _numReadPower = MkNum(grpPrint, "读功率dBm", 0, 33, 1m);
            _numWritePower = MkNum(grpPrint, "写功率dBm", 0, 33, 1m);
            FinishGroup(grpPrint);
            stack.Controls.Add(grpPrint);

            // 网络参数 (全局统一保存)
            var grpNet = MkGroup("网络参数 (全局统一保存, 应用到打印机后 NV 持久)");
            _txtIp = MkText(grpNet, "IP地址", 130);
            _txtMask = MkText(grpNet, "子网掩码", 130);
            _txtGateway = MkText(grpNet, "网关", 130);
            FinishGroup(grpNet);
            stack.Controls.Add(grpNet);

            // 蓝牙参数 (全局统一保存)
            var grpBt = MkGroup("蓝牙参数 (全局统一保存)");
            _txtBle = MkText(grpBt, "BLE地址(12位HEX)", 130);
            _txtSpp = MkText(grpBt, "SPP串口(如COM5)", 100);
            FinishGroup(grpBt);
            stack.Controls.Add(grpBt);

            // 可连接打印机 (选中后可测试打印)
            var grpPrinters = _grpPrinters = MkGroup("可连接的打印机 (选中后可测试打印)");
            _lstPrinters = new ListView
            {
                View = View.Details,
                FullRowSelect = true,
                GridLines = true,
                HeaderStyle = ColumnHeaderStyle.Nonclickable,
                Width = 590,
                Height = 170,
                Margin = new Padding(0, 2, 0, 4)
            };
            _lstPrinters.Columns.Add("名称", 150);
            _lstPrinters.Columns.Add("接口", 60);
            _lstPrinters.Columns.Add("地址", 130);
            _lstPrinters.Columns.Add("状态", 50);
            _lstPrinters.Columns.Add("详情", 190);
            FlowOf(grpPrinters).Controls.Add(_lstPrinters);
            _btnRefreshPrinters = MkButton(grpPrinters, "刷新列表", 100, (s, e) => RefreshPrinters());
            _btnTestPrint = MkButton(grpPrinters, "测试打印", 100, (s, e) => TestPrintSelected());
            _lblPrinterResult = new Label { AutoSize = true, MaximumSize = new Size(590, 0), ForeColor = Color.FromArgb(80, 80, 80), Margin = new Padding(0, 8, 0, 0) };
            FlowOf(grpPrinters).Controls.Add(_lblPrinterResult);
            FinishGroup(grpPrinters);
            stack.Controls.Add(grpPrinters);

            // USB 校准与维护
            var grpCalib = _grpCalib = MkGroup("USB 校准与维护");
            var btns = new Control[]
            {
                MkButton(grpCalib, "纸校准", 90, (s, e) => RunCalib("纸校准", UsbPcleService.PaperCalibrate)),
                MkButton(grpCalib, "RFID位置校准", 130, (s, e) => RunCalib("RFID位置校准", UsbPcleService.RfidCalibrate)),
                MkButton(grpCalib, "配置页", 80, (s, e) => RunCalib("配置页", UsbPcleService.PrintConfigPage)),
                MkButton(grpCalib, "读EPC", 80, (s, e) => RunCalib("读EPC", () => { var (ok, msg, epc) = UsbPcleService.ReadEpc(); return (ok, epc != null ? $"{msg} EPC={epc}" : msg); }))
            };
            _txtEpc = new TextBox { Width = 170, PlaceholderText = "24位hex" };
            FlowOf(grpCalib).Controls.Add(MkField("待写EPC", _txtEpc));
            var writeBtn = MkButton(grpCalib, "写EPC并打印", 120, (s, e) => RunCalib("写EPC", () => UsbPcleService.WriteEpc(_txtEpc.Text.Trim())));
            var infoBtn = MkButton(grpCalib, "查询型号", 90, (s, e) => RunCalib("查询型号", () => UsbPcleService.QueryInfo(1)));
            _calibControls = btns.Concat(new Control[] { _txtEpc, writeBtn, infoBtn }).ToArray();
            _lblCalibResult = new Label { AutoSize = true, MaximumSize = new Size(590, 0), ForeColor = Color.FromArgb(80, 80, 80), Margin = new Padding(0, 8, 0, 0) };
            FlowOf(grpCalib).Controls.Add(_lblCalibResult);
            FinishGroup(grpCalib);
            stack.Controls.Add(grpCalib);

            scroll.Controls.Add(stack);

            // ===== 底部按钮 =====
            var bottomPanel = new Panel { Dock = DockStyle.Bottom, Height = 54, BackColor = Color.FromArgb(245, 247, 250) };
            var btnSave = new Button { Text = "保存", Location = new Point(16, 12), Width = 100, Height = 30 };
            btnSave.Click += (s, e) => SaveAll();
            var btnApply = new Button { Text = "应用到打印机", Location = new Point(128, 12), Width = 140, Height = 30 };
            btnApply.Click += (s, e) => ApplyToPrinter();
            _lblResult = new Label { Location = new Point(286, 18), AutoSize = true, ForeColor = Color.FromArgb(80, 80, 80), MaximumSize = new Size(520, 0) };
            var btnClose = new Button { Text = "关闭", Location = new Point(804, 12), Width = 80, Height = 30 };
            btnClose.Click += (s, e) => this.Close();
            bottomPanel.Controls.AddRange(new Control[] { btnSave, btnApply, _lblResult, btnClose });

            this.Controls.Add(scroll);
            this.Controls.Add(leftPanel);
            this.Controls.Add(bottomPanel);
        }

        // ===== 布局辅助: 标签紧贴自己的控件, 字段之间固定间距 =====

        private static Label MkLabel(string text) =>
            new Label { Text = text, AutoSize = true, Margin = new Padding(0, 6, 4, 0) };

        private static GroupBox MkGroup(string title)
        {
            const int grpWidth = 620;
            var grp = new GroupBox
            {
                Text = title,
                Width = grpWidth,
                Height = 56,
                AutoSize = false,
                Margin = new Padding(0, 0, 0, 10)
            };
            var flow = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = true,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                // 固定可用宽度: 换行位置确定, 高度由内容计算
                MaximumSize = new Size(grpWidth - 24, 0),
                Location = new Point(12, 22),
                Margin = new Padding(0),
                Padding = new Padding(0)
            };
            grp.Controls.Add(flow);
            grp.Tag = flow;
            return grp;
        }

        private static FlowLayoutPanel FlowOf(GroupBox grp) => (FlowLayoutPanel)grp.Tag!;

        /// <summary>按内容实际高度收口 GroupBox(避免 AutoSize 与换行冲突导致的标题/换行错乱)</summary>
        private static void FinishGroup(GroupBox grp)
        {
            grp.Height = FlowOf(grp).PreferredSize.Height + 34;
        }

        private NumericUpDown MkNum(GroupBox grp, string label, decimal min, decimal max, decimal inc)
        {
            var num = new NumericUpDown
            {
                Width = 62,
                Minimum = min,
                Maximum = max,
                DecimalPlaces = inc < 1 ? 1 : 0,
                Increment = inc
            };
            FlowOf(grp).Controls.Add(MkField(label, num));
            return num;
        }

        private TextBox MkText(GroupBox grp, string label, int width)
        {
            var txt = new TextBox { Width = width };
            FlowOf(grp).Controls.Add(MkField(label, txt));
            return txt;
        }

        /// <summary>标签 + 输入框作为一个不可拆分单元: 名称紧贴自己的控件, 换行时整体换行</summary>
        private static FlowLayoutPanel MkField(string label, Control input)
        {
            var lbl = new Label { Text = label, AutoSize = true, Margin = new Padding(0, 6, 4, 0) };
            input.Margin = new Padding(0, 2, 0, 2);
            var unit = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Margin = new Padding(0, 0, 16, 0),
                Padding = new Padding(0)
            };
            unit.Controls.Add(lbl);
            unit.Controls.Add(input);
            return unit;
        }

        private static Button MkButton(GroupBox grp, string text, int width, EventHandler onClick)
        {
            var btn = new Button { Text = text, Width = width, Height = 30, Margin = new Padding(0, 2, 10, 2) };
            btn.Click += onClick;
            FlowOf(grp).Controls.Add(btn);
            return btn;
        }

        // ===== 方案(标签规格)读写 =====

        private void LoadPapers()
        {
            _loading = true;
            _lstPapers.Items.Clear();
            var lib = LabelPaperStore.Load();
            foreach (var p in lib.Papers.OrderBy(x => x.Name))
                _lstPapers.Items.Add(p);
            _lstPapers.DisplayMember = "Name";
            _loading = false;
            if (_lstPapers.Items.Count > 0) _lstPapers.SelectedIndex = 0;
            else ClearForm();
        }

        /// <summary>仅载入标签规格(尺寸/边距/天线); 打印·网络·蓝牙参数为全局, 由 LoadGlobalToForm 载入</summary>
        private void LoadPaperToForm(LabelPaper p)
        {
            _current = p;
            _loading = true;
            _txtName.Text = p.Name;
            Set(_numWidth, p.Width); Set(_numHeight, p.Height); Set(_numGap, p.Gap);
            Set(_numMarginL, p.MarginLeft); Set(_numMarginR, p.MarginRight);
            Set(_numMarginT, p.MarginTop); Set(_numMarginB, p.MarginBottom);
            Set(_numAntX, p.AntennaX); Set(_numAntY, p.AntennaY);
            Set(_numAntW, p.AntennaW); Set(_numAntH, p.AntennaH);
            _loading = false;
            _lblResult.Text = "";
        }

        /// <summary>载入全局参数(打印/网络/蓝牙)到表单, 仅一次</summary>
        private void LoadGlobalToForm()
        {
            _loading = true;
            Set(_numTear, _config.TearOffset ?? 0);
            Set(_numSpeed, _config.Speed ?? 0);
            Set(_numDarkness, _config.Darkness ?? 0);
            _cboDpi.SelectedItem = (_config.Dpi ?? 203).ToString();
            Set(_numReadPower, _config.ReadPower ?? 0);
            Set(_numWritePower, _config.WritePower ?? 0);
            _txtIp.Text = _config.PrinterIp ?? "";
            _txtMask.Text = string.IsNullOrWhiteSpace(_config.PrinterMask) ? "255.255.255.0" : _config.PrinterMask;
            _txtGateway.Text = _config.PrinterGateway ?? "";
            _txtBle.Text = _config.BleAddress ?? "";
            _txtSpp.Text = _config.BtSppPort ?? "";
            _loading = false;
        }

        private static void Set(NumericUpDown num, double v)
        {
            var d = (decimal)v;
            num.Value = Math.Min(Math.Max(d, num.Minimum), num.Maximum);
        }

        private void ClearForm()
        {
            _current = null;
            _txtName.Text = "";
            _numWidth.Value = 40; _numHeight.Value = 30; _numGap.Value = 2;
            _numMarginL.Value = _numMarginR.Value = _numMarginT.Value = _numMarginB.Value = 2;
            _numAntX.Value = _numAntY.Value = _numAntW.Value = _numAntH.Value = 0;
        }

        private void AddNewPaper()
        {
            var p = new LabelPaper
            {
                Name = $"新方案 {DateTime.Now:MMddHHmm}",
                Width = 40, Height = 30, Gap = 2,
                MarginLeft = 2, MarginRight = 2, MarginTop = 2, MarginBottom = 2
            };
            LabelPaperStore.Upsert(p);
            LoadPapers();
            _lstPapers.SelectedItem = p;
        }

        private void DeletePaper()
        {
            if (_current == null) return;
            if (MessageBox.Show($"确认删除方案「{_current.Name}」？", "确认", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            LabelPaperStore.Delete(_current.Id);
            LoadPapers();
        }

        /// <summary>表单 → 方案对象(仅标签规格)</summary>
        private bool CollectToPaper()
        {
            if (_current == null)
            {
                ShowResult("请先选择或新增一个方案", Color.Crimson);
                return false;
            }
            if (string.IsNullOrWhiteSpace(_txtName.Text))
            {
                ShowResult("方案名称不能为空", Color.Crimson);
                return false;
            }
            _current.Name = _txtName.Text.Trim();
            _current.Width = (double)_numWidth.Value;
            _current.Height = (double)_numHeight.Value;
            _current.Gap = (double)_numGap.Value;
            _current.MarginLeft = (double)_numMarginL.Value;
            _current.MarginRight = (double)_numMarginR.Value;
            _current.MarginTop = (double)_numMarginT.Value;
            _current.MarginBottom = (double)_numMarginB.Value;
            _current.AntennaX = (double)_numAntX.Value;
            _current.AntennaY = (double)_numAntY.Value;
            _current.AntennaW = (double)_numAntW.Value;
            _current.AntennaH = (double)_numAntH.Value;
            return true;
        }

        /// <summary>表单 → 全局配置(打印/网络/蓝牙), 并落盘</summary>
        private void CollectGlobal()
        {
            _config.TearOffset = _numTear.Value > 0 ? (double)_numTear.Value : null;
            _config.Speed = _numSpeed.Value > 0 ? (int)_numSpeed.Value : null;
            _config.Darkness = _numDarkness.Value > 0 ? (int)_numDarkness.Value : null;
            _config.Dpi = int.TryParse(_cboDpi.SelectedItem?.ToString(), out var dpi) ? dpi : null;
            _config.ReadPower = _numReadPower.Value > 0 ? (int)_numReadPower.Value : null;
            _config.WritePower = _numWritePower.Value > 0 ? (int)_numWritePower.Value : null;
            _config.PrinterIp = _txtIp.Text.Trim();
            _config.PrinterMask = _txtMask.Text.Trim();
            _config.PrinterGateway = _txtGateway.Text.Trim();
            _config.BleAddress = _txtBle.Text.Trim();
            _config.BtSppPort = _txtSpp.Text.Trim();
            _config.Save();
        }

        /// <summary>保存: 标签方案 + 全局参数统一落盘</summary>
        private void SaveAll()
        {
            if (!CollectToPaper()) return;
            LabelPaperStore.Upsert(_current!);
            CollectGlobal();
            var idx = _lstPapers.SelectedIndex;
            if (idx >= 0) _lstPapers.Items[idx] = _current!;
            ShowResult("已保存标签方案与全局参数", Color.Green);
        }

        /// <summary>应用到打印机: 从全局配置批量下发 撕裂线 / IP / 读写功率(均可 NV 持久)</summary>
        private void ApplyToPrinter()
        {
            bool hasTear = _config.TearOffset is > 0;
            bool hasIp = !string.IsNullOrWhiteSpace(_config.PrinterIp);
            bool hasPower = _config.ReadPower is > 0 || _config.WritePower is > 0;
            if (!hasTear && !hasIp && !hasPower)
            {
                ShowResult("没有可下发的设备参数 (撕裂线/IP/功率均为空)", Color.DarkGoldenrod);
                return;
            }

            string? channel = ChooseChannel();
            if (channel == null) return;

            var log = new List<string>();
            string? firstError = null;

            void Step(string name, Func<(bool ok, string msg)> action)
            {
                if (firstError != null) return;
                try
                {
                    var (ok, msg) = action();
                    if (ok) log.Add($"{name} ✓");
                    else firstError = $"{name} 失败: {msg}";
                }
                catch (Exception ex) { firstError = $"{name} 异常: {ex.Message}"; }
            }

            bool usb = channel == "USB";
            int dpi = _config.Dpi ?? 203;
            var svc = new ZMinRfidService();

            if (_config.TearOffset is > 0)
            {
                int dots = (int)Math.Round(_config.TearOffset.Value * dpi / 25.4);
                string priv = $"#UM>FD{dots}\r\n";
                Step("撕裂线", () => usb ? UsbPcleService.SendRaw(priv) : svc.SendRawCommands(priv, "NET", channel, ""));
            }

            if (!string.IsNullOrWhiteSpace(_config.PrinterIp))
            {
                string ip = _config.PrinterIp;
                if (ip.Length < 7 || !ip.All(ch => char.IsDigit(ch) || ch == '.'))
                {
                    ShowResult("IP 地址格式不正确, 已跳过", Color.Crimson);
                    return;
                }
                string mask = string.IsNullOrWhiteSpace(_config.PrinterMask) ? "255.255.255.0" : _config.PrinterMask;
                string gw = _config.PrinterGateway ?? "";
                if (gw.Length == 0)
                {
                    var o = ip.Split('.');
                    gw = o.Length == 4 ? $"{o[0]}.{o[1]}.{o[2]}.1" : ip;
                }
                string priv = $"#UM>IA{ip}\r\n#UM>MK{mask}\r\n#UM>GT{gw}\r\n";
                Step("IP地址", () => usb ? UsbPcleService.SendRaw(priv) : svc.SendRawCommands(priv, "NET", channel, ""));
            }

            if (_config.ReadPower is > 0 || _config.WritePower is > 0)
            {
                int rp = _config.ReadPower ?? 15, wp = _config.WritePower ?? 20;
                Step("读写功率", () => usb
                    ? UsbPcleService.SetRfPower(rp, wp)
                    : svc.SendRawCommands($"RW{rp},{wp}\r\n", "NET", channel, ""));
            }

            if (firstError != null)
            {
                ShowResult(firstError, Color.Crimson);
                return;
            }
            ShowResult($"已应用到 {channel}: {string.Join(" · ", log)} (打印机持久保存)".Replace(" ✓", ""), Color.Green);
        }

        /// <summary>选择下发通道: USB 直连, 或配置过的网口打印机</summary>
        private string? ChooseChannel()
        {
            var nets = _config.NetPrinterIps.Where(ip => !string.IsNullOrWhiteSpace(ip)).ToList();
            if (nets.Count == 0) return "USB";

            using var dlg = new Form
            {
                Text = "选择目标打印机",
                ClientSize = new Size(360, 180),
                StartPosition = FormStartPosition.CenterParent,
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false,
                MinimizeBox = false,
                Font = new Font("Microsoft YaHei", 9f)
            };
            dlg.Controls.Add(new Label { Text = "选择下发通道", Location = new Point(20, 20), AutoSize = true });
            var cbo = new ComboBox { Location = new Point(20, 48), Width = 316, DropDownStyle = ComboBoxStyle.DropDownList };
            cbo.Items.Add("USB (本地直连)");
            foreach (var ip in nets) cbo.Items.Add($"网口 {ip}");
            cbo.SelectedIndex = 0;
            var ok = new Button { Text = "确定", Location = new Point(156, 96), Width = 84, Height = 30, DialogResult = DialogResult.OK };
            var cancel = new Button { Text = "取消", Location = new Point(252, 96), Width = 84, Height = 30, DialogResult = DialogResult.Cancel };
            dlg.Controls.AddRange(new Control[] { cbo, ok, cancel });
            dlg.AcceptButton = ok;
            dlg.CancelButton = cancel;
            if (dlg.ShowDialog(this) != DialogResult.OK) return null;
            return cbo.SelectedIndex == 0 ? "USB" : nets[cbo.SelectedIndex - 1];
        }

        // ===== 可连接打印机枚举(仅展示) =====

        private void RefreshPrinters()
        {
            _btnRefreshPrinters.Enabled = false;
            _lblPrinterResult.ForeColor = Color.FromArgb(80, 80, 80);
            _lblPrinterResult.Text = "正在枚举可连接打印机...";
            string probeIps = string.Join(",", _config.NetPrinterIps ?? new List<string>());
            Task.Run(() =>
            {
                List<PrinterDiscoveryService.PrinterDevice> list;
                string? err = null;
                try { list = PrinterDiscoveryService.GetAllLocalPrinters(probeIps); }
                catch (Exception ex) { list = new List<PrinterDiscoveryService.PrinterDevice>(); err = ex.Message; }
                this.Invoke(new Action(() => FillPrinters(list, err)));
            });
        }

        private void FillPrinters(List<PrinterDiscoveryService.PrinterDevice> list, string? err)
        {
            _lstPrinters.BeginUpdate();
            _lstPrinters.Items.Clear();
            foreach (var d in list)
            {
                var it = new ListViewItem(new[] { d.Name, d.Interface, d.Address, d.Online ? "在线" : "离线", d.Detail });
                it.Tag = d; // 供测试打印取回原始设备对象
                if (!d.Online) it.ForeColor = Color.Gray;
                _lstPrinters.Items.Add(it);
            }
            _lstPrinters.EndUpdate();
            _btnRefreshPrinters.Enabled = true;
            if (err != null)
            {
                _lblPrinterResult.Text = $"枚举失败: {err}";
                _lblPrinterResult.ForeColor = Color.Crimson;
                FinishGroup(_grpPrinters);
                return;
            }
            _lblPrinterResult.Text = $"共 {list.Count} 台可连接打印机 (选中一台后点「测试打印」, 不影响打印任务通道)";
            _lblPrinterResult.ForeColor = Color.FromArgb(80, 80, 80);
            FinishGroup(_grpPrinters);
        }

        /// <summary>对选中打印机做一次测试打印: 标签机发 PCLE 测试排版, Windows 驱动打印机走驱动打印文本</summary>
        private void TestPrintSelected()
        {
            if (_lstPrinters.SelectedItems.Count == 0)
            {
                _lblPrinterResult.Text = "请先在列表中选中一台打印机";
                _lblPrinterResult.ForeColor = Color.DarkGoldenrod;
                FinishGroup(_grpPrinters);
                return;
            }
            var d = _lstPrinters.SelectedItems[0].Tag as PrinterDiscoveryService.PrinterDevice;
            if (d == null) return;

            string stamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            string label = $"N\r\nS4\r\nH10\r\nT20,20,0,2,1,1,N,\"PrintAgent TEST\"\r\n" +
                           $"T20,80,0,2,1,1,N,\"{stamp}\"\r\nW1\r\n";

            _btnTestPrint.Enabled = false;
            _lblPrinterResult.Text = $"正在向「{d.Name}」({d.Interface}) 发送测试打印...";
            _lblPrinterResult.ForeColor = Color.FromArgb(80, 80, 80);
            FinishGroup(_grpPrinters);

            Task.Run(() =>
            {
                (bool ok, string msg) r;
                try { r = SendTestTo(d, label); }
                catch (Exception ex) { r = (false, ex.Message); }
                this.Invoke(new Action(() =>
                {
                    _lblPrinterResult.Text = $"测试打印「{d.Name}」: {(r.ok ? "✓ " : "× ")}{r.msg}";
                    _lblPrinterResult.ForeColor = r.ok ? Color.Green : Color.Crimson;
                    _btnTestPrint.Enabled = true;
                    FinishGroup(_grpPrinters);
                }));
            });
        }

        private static (bool ok, string msg) SendTestTo(PrinterDiscoveryService.PrinterDevice d, string label)
        {
            string iface = d.Interface.ToUpperInvariant();
            switch (iface)
            {
                case "DRIVER":
                    // Windows 驱动打印机: 无 PCLE 通道, 走驱动打印一页测试文本
                    return StandardAndPosPrintService.PrintViaDriver(d.Address, $"PrintAgent 测试页 {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
                case "USB":
                    // ZMIN 免驱 USB: 用主板 SN 定位设备
                    return new ZMinRfidService().SendRawCommands(label, "USB", "", d.Address);
                case "NET":
                    // 网口: 去掉 ":9100" 端口后按 IP 下发
                    string ip = d.Address.Split(':')[0];
                    return new ZMinRfidService().SendRawCommands(label, "NET", ip, "");
                case "BT":
                case "SERIAL":
                    // 蓝牙 SPP 虚拟串口 / 物理串口
                    return BtSppPrintService.SendRaw(label, d.Address);
                default:
                    return (false, $"暂不支持通过 {iface} 通道测试打印");
            }
        }

        private void ShowResult(string text, Color color)
        {
            _lblResult.Text = text;
            _lblResult.ForeColor = color;
        }

        // ===== USB 校准(后台执行, 避免界面卡死) =====

        private void RunCalib(string name, Func<(bool ok, string msg)> action)
        {
            foreach (var c in _calibControls) c.Enabled = false;
            _lblCalibResult.ForeColor = Color.FromArgb(80, 80, 80);
            _lblCalibResult.Text = $"{name} 执行中 (USB, 可能需要 10~30 秒)...";
            FinishGroup(_grpCalib); // 文本变化后按内容重新收口组高度, 防止结果被裁掉
            Task.Run(() =>
            {
                (bool ok, string msg) r;
                try { r = action(); }
                catch (Exception ex) { r = (false, ex.Message); }
                this.Invoke(new Action(() =>
                {
                    _lblCalibResult.Text = $"{name}: {(r.ok ? "✓ " : "× ")}{r.msg}";
                    _lblCalibResult.ForeColor = r.ok ? Color.Green : Color.Crimson;
                    foreach (var c in _calibControls) c.Enabled = true;
                    FinishGroup(_grpCalib); // 读EPC等长结果换行后必须重新撑高, 否则被遮挡
                }));
            });
        }
    }
}
