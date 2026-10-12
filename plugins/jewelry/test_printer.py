import sys
import datetime
import win32print

# 70mm x 35mm @ 203 DPI (8 dots/mm)
LABEL_WIDTH = 560
LABEL_HEIGHT = 280

def get_new_epc() -> tuple[str, str]:
    """生成 E280 + yyyymmddhhmmss，补足 24 位 16 进制 (96-bit)"""
    ts = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    epc_hex = f"E280{ts}".ljust(24, "0")
    return epc_hex, ts

def select_usb_printer() -> str:
    """列出并选择 USB / 本地已安装打印机"""
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    printers = [p[2] for p in win32print.EnumPrinters(flags)]
    if not printers:
        print("❌ 未检测到系统打印机，请检查 USB 连线与驱动。")
        sys.exit(1)

    default_p = win32print.GetDefaultPrinter()
    print("\n" + "=" * 50)
    print(" 系统可用打印机列表:")
    print("=" * 50)
    
    match_index = 1
    for idx, p in enumerate(printers, 1):
        is_def = " (默认)" if p == default_p else ""
        is_rec = ""
        if "735" in p.upper() or "DASCOM" in p.upper():
            is_rec = " [推荐匹配]"
            match_index = idx
        print(f" [{idx}] {p}{is_def}{is_rec}")
    print("=" * 50)

    choice = input(f"请选择打印机序号 [默认 {match_index}]: ").strip()
    sel_idx = int(choice) if choice.isdigit() and 1 <= int(choice) <= len(printers) else match_index
    selected = printers[sel_idx - 1]
    print(f"✅ 已选定打印机: {selected}\n")
    return selected

def send_zpl_usb(printer_name: str):
    new_epc, ts = get_new_epc()
    print(f"[*] 准备写入的新 EPC: {new_epc}")
    print(f"[*] 时间戳: {ts}")

    # ==========================================
    # ZPL II 指令构建
    # ==========================================
    zpl = f"""^XA
^PW{LABEL_WIDTH}
^LL{LABEL_HEIGHT}
^PON

; ==========================================
; 1. 四角输出 (70x35mm 边缘校验)
; ==========================================
; 左上角 (X=20, Y=20)
^FO20,20^A0N,22,22^FD[TL]^FS

; 右上角 (X=460, Y=20)
^FO460,20^A0N,22,22^FD[TR]^FS

; 左下角 (X=20, Y=240)
^FO20,240^A0N,20,20^FD[BL] DASCOM^FS

; 右下角 (X=440, Y=240)
^FO440,240^A0N,20,20^FD[BR] 70x35^FS

; ==========================================
; 2. 读取芯片原有 EPC 并输出在上方
; ==========================================
; 读取 EPC 存储区(Bank 1), 偏移 2 字, 长度 6 字, 载入变量 1
^RFR,H,1,2,6,1^FN1^FS
^FO40,55^A0N,18,18^FDOLD EPC:^FS
^FO130,55^A0N,18,18^FN1^FS

; ==========================================
; 3. 写入新 EPC 芯片数据
; ==========================================
^FN2^FD{new_epc}^FS
; 写入 EPC 存储区 (Bank 1, 偏移 2 字, 长度 6 字)
^RFW,H,1,2,6,1^FS

; ==========================================
; 4. 中心排版打印 (新 EPC 字符 + 条码)
; ==========================================
^FO190,85^A0N,22,22^FD--- NEW EPC ---^FS
^FO35,115^A0N,22,22^FN2^FS
^FO110,145^BCN,42,N,N,N^FN2^FS
^FO160,200^A0N,18,18^FDTIME: {ts}^FS

^XZ
"""

    try:
        hprinter = win32print.OpenPrinter(printer_name)
        try:
            hjob = win32print.StartDocPrinter(hprinter, 1, ("DL735Z_Test_Label", None, "RAW"))
            win32print.StartPagePrinter(hprinter)
            win32print.WritePrinter(hprinter, zpl.encode("utf-8"))
            win32print.EndPagePrinter(hprinter)
            win32print.EndDocPrinter(hprinter)
            print("🚀 ZPL II 任务已成功通过 USB 驱动发送到打印机！")
        finally:
            win32print.ClosePrinter(hprinter)
    except Exception as e:
        print(f"❌ 打印失败: {e}")

if __name__ == "__main__":
    printer = select_usb_printer()
    send_zpl_usb(printer)