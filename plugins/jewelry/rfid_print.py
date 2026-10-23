"""RFID 珠宝标签排版引擎（ZMIN X19D，PCLE 原生指令通道）。

标签规格（固定）：宽 66mm × 高 25.4mm 横版，203 DPI → 528 × 203 dots，间隙 40 dots。
唯一打印路径：模板 slots → ZMIN 统一指令（content_to_commands）→ 助手翻译为 PCLE
（`N / q528 / Q203,40 / T / B / RF / W1`）→ UsbPcleService.WriteToPort。
不再生成 ZPL：ZMIN 固件不识别 ZPL，SDK 结构化通道又不渲染条码。
"""

from __future__ import annotations

import json
import re


def chip_epc_hex(epc: str, prefix: str = "E280") -> str:
    """可读 EPC → 写入芯片的十六进制串。

    - 新格式（20 位纯数字，GS1 式）：按 BCD 打包 10 字节 + 版本号 0x01 +
      前 10 字节逐字节异或校验，共 12 字节 96bit；
      例：69012345670104000001 → 690123456701040000016D。
    - 纯十六进制码（旧 E280 开头）原样写入；
    - 含企业拼音字母前缀（如 YZZ）时，前缀按 ASCII 编码为十六进制
      （YZZ → 595A5A），品类码与十六进制序号保持原样；
      例：YZZ0100000001 → 595A5A0100000001。
    - 门店段为 2 位字母/数字（如 HQ）：纯 hex 段原样（01 占 2 位），
      含非 hex 字母时同样转 ASCII-hex（HQ → 4851）；
      例：YZZHQ01000001 → 595A5A485101000001。
    """
    epc = (epc or "").strip().upper()
    if not epc:
        return ""
    if len(epc) == 20 and epc.isdigit():  # 新格式：BCD 打包 + 版本/校验
        x = 0
        for v in bytes.fromhex(epc):
            x ^= v
        return epc + "01" + f"{x:02X}"
    try:
        int(epc, 16)
        return epc
    except ValueError:
        p = (prefix or "").strip().upper()
        if p and epc.startswith(p):
            body = epc[len(p):]
            head = p.encode("ascii", "ignore").hex().upper()
            # body = 门店段(2位字符) + 品类码(2位数字) + 序号(hex)
            if len(body) >= 2:
                seg = body[:2]
                if all(c in "0123456789ABCDEF" for c in seg):
                    seg_hex = seg
                else:
                    seg_hex = seg.encode("ascii", "ignore").hex().upper()
                return head + seg_hex + body[2:]
            return head + body
        return epc.encode("ascii", "ignore").hex().upper()


def decode_chip_epc(raw: str, prefix: str = "E28", seq_bits: int = 6,
                    pat: "re.Pattern | None" = None,
                    num_pat: "re.Pattern | None" = None) -> str:
    """芯片回读值 → 库内可读 EPC（chip_epc_hex 的逆变换）；认不出就原样返回。

    需要归一化的原因：芯片里存的是编码后的 hex（前缀 ASCII + 门店段 ASCII/hex +
    品类码 + 序号），库内 rfid_epc 存的是明文；且 Gen2 的 EPC 长度以 16 位字为单位，
    奇数长度会被写侧补 00 到偶数字节，回读值尾部会多出 1 字节。

    自检用传入的合规正则（db._epc_rule 的 pat / num_pat），匹配不上就宁可原样返回、不猜。

    新格式（20 位纯数字 BCD + 版本/校验，共 12 字节 24 hex）：倒数第 2 字节为版本号
    0x01，末字节为前 10 字节逐字节异或校验；校验通过且（有 num_pat 时）符合数字规则，
    即还原 20 位数字 EPC。
    """
    s = (raw or "").strip().upper()
    if not s:
        return s
    # ---- 新格式判别：须在旧逻辑前，避免 24 hex 被旧纯 hex 分支截尾 ----
    if len(s) == 24 and s[20:22] == "01":
        try:
            x = 0
            for v in bytes.fromhex(s[:20]):
                x ^= v
        except ValueError:
            x = -1
        if x >= 0 and f"{x:02X}" == s[22:24] and (num_pat is None or num_pat.fullmatch(s[:20])):
            return s[:20]
    bits = max(4, min(6, int(seq_bits or 6)))
    p = (prefix or "").strip().upper() or "E28"
    rx = pat or re.compile(re.escape(p) + r"([0-9A-Z]{2})(\d{2})([0-9A-F]{%d})" % bits)
    if rx.fullmatch(s):
        return s
    head_hex = p.encode("ascii", "ignore").hex().upper()
    if s.startswith(head_hex) and len(s) > len(head_hex) + 4:
        # 前缀 + 门店段(2 字节) + 品类码/序号（编码时原样保留）
        base = len(head_hex)
        for trim in (0, 2, 4):
            cand = s[:len(s) - trim] if trim else s
            if len(cand) <= base + 4:
                break
            try:
                seg_b = bytes.fromhex(cand[base:base + 4])
            except ValueError:
                break
            seg = seg_b.decode("ascii") if all(32 <= b < 127 for b in seg_b) else cand[base:base + 4]
            if rx.fullmatch(p + seg + cand[base + 4:]):
                return p + seg + cand[base + 4:]
    # 旧格式：明文本身即 hex 串、芯片直接存该 hex 值；奇数 nibble 会被补 1 个 0 位
    if re.fullmatch(r"[0-9A-F]+", s):
        for trim in (1, 2, 3, 4):
            if len(s) <= trim + 8:
                break
            cand = s[:len(s) - trim]
            if rx.fullmatch(cand):
                return cand
    return s

# 203 DPI 下的标签尺寸（固定 66×25.4mm 横版，与内建模板画布一致）
LABEL_WIDTH_DOTS = 528   # 66mm
LABEL_HEIGHT_DOTS = 203  # 25.4mm

# 可输出字段：key → 中文名称
FIELD_OPTIONS = {
    "store": "门店名称",
    "name": "商品名称",
    "spec": "材质克重",
    "price": "售价",
    "cert": "证书号",
    "barcode": "条码",
    "epc_text": "EPC明文",
    "epc_barcode": "EPC条码",
    "code": "货号",
    "category": "品类",
    "material": "材质",
    "weight": "克重",
    "size": "尺寸",
    "cost": "成本",
    "origin": "产地",
}

DEFAULT_FIELDS = {"store", "name", "spec", "price", "barcode"}

# 无模板时的回退布局：与 db.py 内建「珠宝RFID标准签（66×25.4）」同版式，
# 画布 528×203 点，坐标单位 203dpi 点
FALLBACK_DEFINITION = {
    "slots": [
        {"field": "name", "x": 5, "y": 5, "w": 189, "h": 19, "font": {"type": "cn", "w": 18, "h": 18}},
        {"field": "price", "x": 5, "y": 28, "w": 189, "h": 23, "font": {"type": "ascii", "w": 20, "h": 20}},
        {"field": "barcode", "x": 5, "y": 57, "w": 183, "h": 47, "font": {"type": "barcode", "h": 34}},
        {"field": "epc_text", "x": 5, "y": 133, "w": 189, "h": 12, "font": {"type": "ascii", "w": 9, "h": 9}},
        {"field": "spec", "x": 5, "y": 152, "w": 189, "h": 12, "font": {"type": "cn", "w": 9, "h": 9}},
    ]
}


def _ascii_safe(s: str) -> str:
    """打印内容转义：去掉会打断指令的 ^ ~ 字符。"""
    return str(s or "").replace("^", " ").replace("~", " ")


def _cn(s: str) -> str:
    return str(s or "").replace("^", " ").replace("~", " ")


def _spec_str(product: dict) -> str:
    parts = []
    if product.get("material"):
        parts.append(_cn(product["material"]))
    if product.get("weight"):
        parts.append(f"{float(product['weight']):.2f}g")
    if product.get("size"):
        parts.append(_cn(product["size"]))
    return " ".join(parts)


def _strip_epc_prefix(epc: str, prefix: str = "E280") -> str:
    """去掉 EPC 企业前缀，仅保留品类+序号段（店内全局唯一），用于缩短印刷条码。

    新格式（20 位纯数字）：前 8 位为数字前缀，截去后剩 门店4+品类2+序号6=12 位纯数字。
    """
    epc = (epc or "").strip().upper()
    if len(epc) == 20 and epc.isdigit():
        return epc[8:]
    prefix = (prefix or "").strip().upper()
    if prefix and epc.startswith(prefix):
        return epc[len(prefix):]
    return epc


def _field_value(field: str, product: dict, store_name: str, rfid_prefix: str = "E280") -> str:
    """根据字段 key 从 product 或 store_name 中取实际值。"""
    p = product or {}
    if field == "store":
        return _cn(store_name)
    if field == "name":
        return _cn(p.get("name", ""))
    if field == "code":
        return _ascii_safe(p.get("code", ""))
    if field == "spec":
        return _spec_str(p)
    if field == "price":
        v = p.get("price")
        return f"RMB {float(v):,.0f}" if v else ""
    if field == "cert":
        v = _ascii_safe(p.get("cert", ""))
        return f"CERT {v}" if v else ""
    if field == "barcode":
        return _ascii_safe(p.get("barcode") or p.get("code") or "")
    if field == "epc_text":
        v = _ascii_safe(p.get("rfid_epc", ""))
        return f"EPC {v}" if v else ""
    if field == "epc_barcode":
        return _strip_epc_prefix(_ascii_safe(p.get("rfid_epc", "")), rfid_prefix)
    if field == "category":
        return _cn(p.get("product_type") or p.get("category", ""))
    if field == "material":
        return _cn(p.get("material", ""))
    if field == "weight":
        v = p.get("weight")
        return f"{float(v):.2f}g" if v else ""
    if field == "size":
        return _cn(p.get("size", ""))
    if field == "cost":
        v = p.get("cost")
        return f"￥{float(v):,.0f}" if v else ""
    if field == "origin":
        return _cn(p.get("origin", ""))
    return ""


# ---------------------------------------------------------------- ZMIN 统一指令任务
# 唯一可靠路径 = printerType:"rfid_cmd" 统一指令 → 助手翻译成 PCLE → USB WriteToPort。
# SDK 结构化通道（PrintUtility.PrintLabel）会把整张标签栅格化，条码不出（假成功）。
# 坐标换算：模板 slots 为 203DPI 点阵（7.992 dots = 1mm）→ content 用 mm。
DOTS_PER_MM = 203 / 25.4            # ≈7.992（X19D 实测为 203DPI）


def normalize_template_slots(definition: dict, width_mm: float, height_mm: float) -> dict:
    """把越界槽位等比缩回标签画布内（保存模板时调用）。

    编辑器允许字段框拖到画布外，落库后预览会裁掉、打印也不会出现；
    这里按最大边界等比压缩坐标与尺寸，保证所有字段都落在画布内。
    """
    canvas_w = max(1, round(float(width_mm or 66) * DOTS_PER_MM))
    canvas_h = max(1, round(float(height_mm or 25.4) * DOTS_PER_MM))
    slots = definition.get("slots") or []
    if not slots:
        return definition
    bottom = max(int(s.get("y", 0)) + int(s.get("h", 0)) for s in slots)
    right = max(int(s.get("x", 0)) + int(s.get("w", 0)) for s in slots)
    ky = canvas_h / bottom if bottom > canvas_h else 1.0
    kx = canvas_w / right if right > canvas_w else 1.0
    for s in slots:
        s["x"] = max(0, round(int(s.get("x", 0)) * kx))
        s["y"] = max(0, round(int(s.get("y", 0)) * ky))
        s["w"] = max(1, round(int(s.get("w", 0)) * kx))
        s["h"] = max(1, round(int(s.get("h", 0)) * ky))
        font = s.get("font")
        if isinstance(font, dict):
            # 字号同步压缩，保持画布上的相对观感（否则缩完文字会盖住下一行）
            if int(font.get("h") or 0):
                font["h"] = max(8, round(int(font["h"]) * ky))
            if int(font.get("w") or 0):
                font["w"] = max(8, round(int(font["w"]) * kx))
            # PCLE 单字节字体最小 24 点（中文点阵同为 24×24），字号低于 24 时
            # 打印机会按 24 点出字，模板一并抬到 24 保证预览与实物一致
            if font.get("type", "ascii") != "barcode" and int(font.get("h") or 0):
                font["h"] = max(24, int(font["h"]))
    return definition


def _slot_to_content_el(slot: dict, product: dict, store_name: str,
                        rfid_prefix: str, content: dict) -> None:
    """模板单个 slot → 结构化图元（text/barcode），写入 content。"""
    field = slot.get("field", "")
    value = _field_value(field, product, store_name, rfid_prefix)
    if field in ("epc_text", "epc_barcode") and (slot.get("font") or {}).get("type", "ascii") == "barcode":
        value = _strip_epc_prefix(_ascii_safe((product or {}).get("rfid_epc", "")), rfid_prefix)
    if not value:
        return
    x = round(int(slot.get("x", 0)) / DOTS_PER_MM, 2)
    y = round(int(slot.get("y", 0)) / DOTS_PER_MM, 2)
    font = slot.get("font") or {}
    ftype = font.get("type", "ascii")
    h_dot = int(font.get("h", 24))
    size_pt = max(6, min(40, round(h_dot / DOTS_PER_MM * 2.835, 1)))  # 字高点阵→mm→pt
    if ftype == "empty":
        return
    if ftype == "barcode":
        content["barcode"] = {
            "code": value, "type": "Code 128 Auto",
            "x": x, "y": y, "scale": 2,
            "height": round(h_dot / DOTS_PER_MM, 2), "textPosition": 2,
        }
    elif ftype == "qrcode":
        # SDK 结构化图元不支持 QR：降级为明文文本，保证信息可见
        content["texts"].append({"text": value, "x": x, "y": y, "size": size_pt})
    else:
        content["texts"].append({"text": value, "x": x, "y": y, "size": size_pt})


def build_zmin_content(product: dict, *, fields: set[str] | None = None,
                       store_name: str = "", write_epc: bool = True,
                       template: dict | None = None, rfid_prefix: str = "E280",
                       width: float = 66.0, height: float = 25.4,
                       gap: float = 5.0, dpi: int = 203) -> dict:
    """单件商品 → PrintAgent 结构化 rfid 任务 content。

    优先模板 slots 布局；无模板回退到 FALLBACK_DEFINITION。
    """
    p = product or {}
    content: dict = {"width": width, "height": height, "gap": gap, "dpi": dpi,
                     "speed": 4, "darkness": 12, "haveGap": True,
                     "texts": []}
    epc = _ascii_safe(p.get("rfid_epc", ""))
    if write_epc and epc:
        content["epc"] = chip_epc_hex(epc, rfid_prefix)
        content["rfidBlock"] = 0

    tpl_def = None
    if template and template.get("definition"):
        try:
            tpl_def = json.loads(template["definition"]) if isinstance(template["definition"], str) else template["definition"]
        except (json.JSONDecodeError, TypeError):
            tpl_def = {}
    slots = (tpl_def or FALLBACK_DEFINITION).get("slots", [])
    for slot in slots:
        _slot_to_content_el(slot, p, store_name, rfid_prefix, content)
    return content


def content_to_commands(content: dict) -> str:
    """结构化 content → ZMIN 统一指令流（助手按 brand 翻译为 PCLE）。

    SDK 结构化通道会把整张标签栅格化成位图，条码不渲染（假成功）；
    统一指令 USB 通道走 UsbPcleService.WriteToPort，可正常输出 Code128 条码，
    因此业务标签一律改走这里生成的指令流。
    """
    w = float(content.get("width") or 66.0)
    h = float(content.get("height") or 25.4)
    gap = float(content.get("gap") or 5.0)
    lines = [
        "N",
        f"L {w},{h},{gap}",
        f"S {int(content.get('speed') or 4)},{int(content.get('darkness') or 12)}",
    ]
    for t in content.get("texts") or []:
        txt = str(t.get("text") or "").replace('"', " ")
        if not txt:
            continue
        x = float(t.get("x") or 0)
        y = float(t.get("y") or 0)
        # pt → 点高 → 倍率（机内 ASCII 字体高 24 点；中文自动换 24×24 点阵字体 a）
        h_dot = float(t.get("size") or 9) / 2.835 * DOTS_PER_MM
        mult = max(1, min(4, round(h_dot / 24)))
        lines.append(f'T {x},{y},0,1,{mult},{mult},N,"{txt}"')
    bc = content.get("barcode") or {}
    code = str(bc.get("code") or "").replace('"', " ")
    if code:
        # B x,y,条码高mm,窄条mm,文字位,码制(1=Code128 Auto),"内容"
        lines.append(
            f'B {float(bc.get("x") or 0)},{float(bc.get("y") or 0)},'
            f'{float(bc.get("height") or 8)},0.15,1,1,"{code}"'
        )
    epc = str(content.get("epc") or "")
    if epc:
        lines.append(f'RF 0,0,0,"{epc}"')
    lines.append("PRINT 1")
    return "\r\n".join(lines) + "\r\n"



