"""RFID 珠宝标签 ZPL 排版引擎（得实 DL-735RE 等 ZPL 指令打印机）。

标签规格：70mm × 35mm，300 DPI → 827 × 413 dots。
- ASCII 内容（货号/价格/条码/EPC）用内置字体 ^A0N
- 中文使用机内字体 ^A@N（默认宋体 E:SIMSUN.FNT，可按打印机实际字体调整）
- RFID 芯片写入：^RFW,H,<EPC十六进制>
"""

from __future__ import annotations

# 300 DPI 下的标签尺寸
LABEL_WIDTH_DOTS = 827   # 70mm
LABEL_HEIGHT_DOTS = 413  # 35mm

# 可输出字段：key → 中文名称
FIELD_OPTIONS = {
    "store": "门店名称",
    "name": "商品名称",
    "spec": "材质克重",
    "price": "售价",
    "cert": "证书号",
    "barcode": "货号条码",
    "epc_text": "EPC明文",
}

DEFAULT_FIELDS = {"store", "name", "spec", "price", "barcode"}
DEFAULT_FONT = "E:SIMSUN.FNT"  # 打印机内中文字体（无中文字体的机器可改为空）


def _ascii_safe(s: str) -> str:
    """ZPL ^FD 内容转义；非 ASCII 不进 ASCII 字体行。"""
    return str(s or "").replace("^", " ").replace("~", " ")


def _cn(s: str) -> str:
    return str(s or "").replace("^", " ").replace("~", " ")


def build_label_zpl(product: dict, *, fields: set[str], store_name: str = "",
                    font: str = DEFAULT_FONT, write_epc: bool = True) -> str:
    """生成单件商品的 ZPL（^XA ... ^XZ）。"""
    code = _ascii_safe(product.get("code", ""))
    name = _cn(product.get("name", ""))
    material = _cn(product.get("material", ""))
    weight = product.get("weight") or 0
    size = _cn(product.get("size", ""))
    cert = _ascii_safe(product.get("cert", ""))
    price = product.get("price") or 0
    epc = _ascii_safe(product.get("rfid_epc", ""))
    store = _cn(store_name)

    spec_parts = []
    if material:
        spec_parts.append(material)
    if weight:
        spec_parts.append(f"{float(weight):.2f}g")
    if size:
        spec_parts.append(size)
    spec = " ".join(spec_parts)

    L: list[str] = ["^XA", "^CI27", f"^PW{LABEL_WIDTH_DOTS}", f"^LL{LABEL_HEIGHT_DOTS}"]

    # ---- 写 RFID 芯片（EPC 区，十六进制）----
    if write_epc and epc:
        L.append(f"^RFW,H^FD{epc}^FS")

    cn_font = bool(font)
    # ---- 左上：商品名称（中文 ^A@）----
    y = 24
    if "name" in fields and name:
        if cn_font:
            L.append(f"^FO24,{y}^A@N,30,30,{font}^FD{name}^FS")
        else:
            L.append(f"^FO24,{y}^A0N,28,28^FD{code}^FS")
        y += 44

    # ---- 左中：材质 / 克重 / 尺寸 ----
    if "spec" in fields and spec:
        if cn_font:
            L.append(f"^FO24,{y}^A@N,22,22,{font}^FD{spec}^FS")
        else:
            L.append(f"^FO24,{y}^A0N,22,22^FD{_ascii_safe(spec)}^FS")
        y += 34

    # ---- 左下：货号 + Code128 条码 ----
    if "barcode" in fields and code:
        L.append(f"^FO24,{y + 34}^BY2^BCN,64,Y,N,N^FD{code}^FS")
        L.append(f"^FO24,{y + 4}^A0N,22,22^FD{code}^FS")

    # ---- 右上：售价（大字）----
    if "price" in fields and price:
        price_s = f"RMB {float(price):,.0f}"
        L.append(f"^FO560,24^A0N,42,42^FD{price_s}^FS")

    # ---- 右中：证书号 ----
    if "cert" in fields and cert:
        L.append(f"^FO520,108^A0N,20,20^FDCERT {cert}^FS")

    # ---- 右下：EPC 明文 ----
    if "epc_text" in fields and epc:
        L.append(f"^FO420,{LABEL_HEIGHT_DOTS - 40}^A0N,18,18^FDEPC {epc[-12:]}^FS")

    # ---- 底部：门店名（中文）----
    if "store" in fields and store:
        if cn_font:
            L.append(f"^FO24,{LABEL_HEIGHT_DOTS - 36}^A@N,20,20,{font}^FD{store}^FS")

    L += ["^PQ1", "^XZ"]
    return "\r\n".join(L) + "\r\n"


def build_batch_zpl(products: list[dict], *, fields: set[str], store_name: str = "",
                    font: str = DEFAULT_FONT, write_epc: bool = True, copies: int = 1) -> str:
    """批量：每件 copies 张，拼成一个打印作业。"""
    blocks = []
    for p in products:
        one = build_label_zpl(p, fields=fields, store_name=store_name, font=font, write_epc=write_epc)
        blocks.append(one.replace("^PQ1", f"^PQ{max(1, copies)}"))
    return "".join(blocks)


def list_printers() -> list[str]:
    """列出本机打印机（仅 Windows + pywin32）。"""
    try:
        import win32print  # type: ignore
    except Exception:
        return []
    names = set()
    for flag in (2, 6):  # PRINTER_ENUM_LOCAL / CONNECTIONS
        try:
            for p in win32print.EnumPrinters(flag):
                if p and len(p) >= 3:
                    names.add(p[2])
        except Exception:
            pass
    return sorted(names)


def send_raw(printer_name: str, data: bytes | str, job_title: str = "jewelry-label",
             encoding: str = "gb18030") -> None:
    """通过 Windows 打印后台 RAW 通道发送 ZPL。

    ^CI27 + 机内中文字体要求按 GB18030（兼容 GBK）编码字节流；
    ASCII 指令部分是 GB18030 的子集，整体按 GB18030 编码即可。
    """
    import win32print  # type: ignore
    if isinstance(data, str):
        data = data.encode(encoding, errors="replace")
    h = win32print.OpenPrinter(printer_name)
    try:
        job = win32print.StartDocPrinter(h, 1, (job_title, None, "RAW"))
        try:
            win32print.StartPagePrinter(h)
            win32print.WritePrinter(h, data)
            win32print.EndPagePrinter(h)
        finally:
            win32print.EndDocPrinter(h)
    finally:
        win32print.ClosePrinter(h)
