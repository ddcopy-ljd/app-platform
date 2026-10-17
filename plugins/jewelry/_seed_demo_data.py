# -*- coding: utf-8 -*-
"""沙箱演示数据填充脚本 v2：基于真实表结构，生成近 90 天销售/去年对比/多品类数据。

用法：python _seed_demo_data.py
前提：jewelry 服务已在 8002 端口运行（或独立模式 dev_data 库已建）。
"""
import json
import random
import sqlite3
import sys
import urllib.request
from datetime import datetime, timedelta, date

BASE = "http://127.0.0.1:8002"
DB = r"C:\Users\俊达\Desktop\综合业务应用服务平台\plugins\jewelry\dev_data\db_jewelry_tenant_trial_v1.0.0.sqlite"

random.seed(42)

# ---------- 登录 ----------
def login():
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=json.dumps({"username": "admin", "password": "123456"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["token"]

TOKEN = login()
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

# ---------- 直接操作数据库 ----------
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA busy_timeout=5000")

today = date.today()

# ---------- 1. 补充商品（多品类、多分类） ----------
NEW_PRODUCTS = [
    # (code, name, category, product_type, cost, price, store_id, weight)
    ("J011", "足金手镯·古法金", "黄金", "手镯", 15200, 18800, 1, 35.2),
    ("J012", "足金项链·肖邦链", "黄金", "项链", 8600, 10800, 1, 18.5),
    ("J013", "铂金钻戒·30分", "铂金", "戒指", 9800, 13800, 1, 3.2),
    ("J014", "翡翠手镯·冰种", "翡翠", "手镯", 28000, 39800, 1, 58.6),
    ("J015", "翡翠观音吊坠", "翡翠", "吊坠", 12000, 16800, 1, 12.8),
    ("J016", "和田玉平安扣", "和田玉", "吊坠", 3600, 5200, 1, 8.5),
    ("J017", "钻石耳钉·50分", "钻石", "耳饰", 15800, 21800, 1, 1.8),
    ("J018", "珍珠项链·Akoya", "珍珠", "项链", 6800, 9800, 1, 0),
    ("J019", "足金耳环·光面", "黄金", "耳饰", 2800, 3600, 1, 5.2),
    ("J020", "K金手链·玫瑰金", "K金", "手链", 3200, 4500, 1, 4.8),
    ("J021", "古董金簪·清代", "古董金", "古董款", 22000, 35000, 1, 28.5),
    ("J022", "足金摆件·金元宝", "黄金", "摆件", 45000, 52000, 1, 100.0),
    ("J023", "钻石项链·1克拉", "钻石", "项链", 58000, 78000, 1, 5.6),
    ("J024", "翡翠戒指·阳绿", "翡翠", "戒指", 18800, 26800, 1, 4.2),
    ("J025", "足金转运珠·串珠", "黄金", "串珠", 1800, 2600, 1, 3.8),
]

existing_codes = {r["code"] for r in conn.execute("SELECT code FROM products").fetchall()}
prod_added = 0
for code, name, cat, ptype, cost, price, sid, weight in NEW_PRODUCTS:
    if code in existing_codes:
        continue
    conn.execute(
        "INSERT INTO products(code,name,category,product_type,cost,price,status,store_id,weight,created) "
        "VALUES(?,?,?,?,?,?,'在库',?,?,?)",
        (code, name, cat, ptype, cost, price, sid, weight,
         (today - timedelta(days=random.randint(30, 90))).isoformat())
    )
    prod_added += 1
print(f"[products] added {prod_added}")

# ---------- 2. 补充客户 ----------
NEW_CUSTOMERS = [
    ("王丽", "13811112222", "VIP1", "2025-06-15"),
    ("李强", "13933334444", "VIP2", "2025-08-20"),
    ("张敏", "13755556666", "普通", "2025-11-01"),
    ("刘洋", "13677778888", "VIP3", "2026-01-10"),
    ("陈静", "13599990000", "VIP1", "2026-03-22"),
    ("赵磊", "13422223333", "普通", "2026-05-18"),
    ("孙芳", "13344445555", "VIP2", "2026-07-04"),
]
existing_cust_names = {r["name"] for r in conn.execute("SELECT name FROM customers").fetchall()}
cust_added = 0
for name, phone, level, created in NEW_CUSTOMERS:
    if name in existing_cust_names:
        continue
    conn.execute(
        "INSERT INTO customers(name,phone,level,total_amount,due_amount,points,created,store_id) "
        "VALUES(?,?,?,0,0,0,?,1)",
        (name, phone, level, created)
    )
    cust_added += 1
print(f"[customers] added {cust_added}")

# ---------- 3. 批量生成销售单（近 90 天） ----------
all_products = conn.execute(
    "SELECT id, code, name, category, product_type, cost, price, store_id FROM products WHERE status='在库'"
).fetchall()
all_customers = conn.execute("SELECT id, name, phone FROM customers").fetchall()
all_stores = [r["id"] for r in conn.execute("SELECT id FROM stores").fetchall()]

existing_sale_dates = {r["d"] for r in conn.execute("SELECT DISTINCT date(created) as d FROM sales").fetchall()}

sales_created = 0
sale_items_created = 0

for day_offset in range(90, -1, -1):
    d = today - timedelta(days=day_offset)
    ds = d.isoformat()
    if ds in existing_sale_dates:
        continue
    n_sales = random.randint(2, 6) if d.weekday() >= 5 else random.randint(0, 3)
    for _ in range(n_sales):
        store_id = random.choice(all_stores)
        store_products = [p for p in all_products if p["store_id"] == store_id]
        if not store_products:
            store_products = all_products
        n_items = random.choices([1, 2, 3], weights=[70, 20, 10])[0]
        items = random.sample(store_products, min(n_items, len(store_products)))
        cust = random.choice(all_customers) if random.random() < 0.6 else None
        hour = random.randint(10, 21)
        minute = random.randint(0, 59)
        created = f"{ds} {hour:02d}:{minute:02d}:00"
        total = sum(p["price"] for p in items)
        cost_total = sum(p["cost"] for p in items)
        pay_method = random.choice(["现金", "微信", "支付宝", "刷卡", "转账"])
        bill_no = f"S{d.strftime('%Y%m%d')}{random.randint(1000,9999)}"

        cur = conn.execute(
            "INSERT INTO sales(bill_no,customer,phone,product,product_id,amount,paid,method,biz_date,"
            "type,status,discount,receivable,customer_id,created,store_id) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (bill_no, cust["name"] if cust else "", cust["phone"] if cust else "",
             items[0]["name"], items[0]["id"], total, total, pay_method, ds,
             "正常", "已完成", 1.0, total, cust["id"] if cust else None, created, store_id)
        )
        sale_id = cur.lastrowid
        for p in items:
            conn.execute(
                "INSERT INTO sale_items(sale_id,product_id,epc,code,name,price,pricing_mode,weight,gold_price,labor_fee,subtotal,seq) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (sale_id, p["id"], "", p["code"], p["name"], p["price"], "一口价", p["weight"] if "weight" in p.keys() else 0, 0, 0, p["price"], 1)
            )
            sale_items_created += 1
        # 标记已售商品
        for p in items:
            conn.execute("UPDATE products SET status='已售' WHERE id=? AND status='在库'", (p["id"],))
        sales_created += 1

print(f"[sales] created {sales_created} sales, {sale_items_created} items")

# ---------- 4. 去年同月数据 ----------
last_year_created = 0
for day_offset in range(90, -1, -1):
    d = today - timedelta(days=day_offset)
    ly = d.replace(year=d.year - 1)
    lys = ly.isoformat()
    exists = conn.execute("SELECT COUNT(*) FROM sales WHERE date(created)=?", (lys,)).fetchone()[0]
    if exists:
        continue
    n_sales = random.randint(0, 4)
    for _ in range(n_sales):
        store_id = random.choice(all_stores)
        store_products = [p for p in all_products if p["store_id"] == store_id]
        if not store_products:
            store_products = all_products
        items = random.sample(store_products, min(random.randint(1, 2), len(store_products)))
        cust = random.choice(all_customers) if random.random() < 0.5 else None
        hour = random.randint(10, 21)
        created = f"{lys} {hour:02d}:{random.randint(0,59):02d}:00"
        total = sum(p["price"] for p in items)
        pay_method = random.choice(["现金", "微信", "支付宝", "刷卡"])
        bill_no = f"S{ly.strftime('%Y%m%d')}{random.randint(1000,9999)}"
        cur = conn.execute(
            "INSERT INTO sales(bill_no,customer,phone,product,product_id,amount,paid,method,biz_date,"
            "type,status,discount,receivable,customer_id,created,store_id) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (bill_no, cust["name"] if cust else "", cust["phone"] if cust else "",
             items[0]["name"], items[0]["id"], total, total, pay_method, lys,
             "正常", "已完成", 1.0, total, cust["id"] if cust else None, created, store_id)
        )
        sale_id = cur.lastrowid
        for p in items:
            conn.execute(
                "INSERT INTO sale_items(sale_id,product_id,epc,code,name,price,pricing_mode,weight,gold_price,labor_fee,subtotal,seq) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (sale_id, p["id"], "", p["code"], p["name"], p["price"], "一口价", 0, 0, 0, p["price"], 1)
            )
        last_year_created += 1

print(f"[last year] created {last_year_created} sales")

# ---------- 5. 寄存单 ----------
NEW_DEPOSITS = [
    # (customer, phone, product, total, deposit, balance, promised_date, status)
    ("王丽", "13811112222", "足金手镯", 18800, 5000, 13800, "2026-10-01", "已取件"),
    ("李强", "13933334444", "翡翠吊坠", 16800, 3000, 13800, "2026-10-15", "已取件"),
    ("张敏", "13755556666", "钻石戒指", 13800, 8000, 5800, "2026-11-01", "已逾期"),
    ("刘洋", "13677778888", "和田玉挂件", 5200, 2000, 3200, "2026-10-20", "已取件"),
    ("陈静", "13599990000", "铂金项链", 10800, 6000, 4800, "2026-10-18", "在押"),
    ("赵磊", "13422223333", "珍珠耳环", 4500, 1500, 3000, "2026-10-25", "在押"),
    ("孙芳", "13344445555", "古董金簪", 35000, 20000, 15000, "2026-11-12", "在押"),
]
dep_added = 0
for cust, phone, product, total, deposit, balance, promised, status in NEW_DEPOSITS:
    conn.execute(
        "INSERT INTO deposits(customer,phone,product,total,deposit,balance,promised_date,status,created,store_id) "
        "VALUES(?,?,?,?,?,?,?,?,?,1)",
        (cust, phone, product, total, deposit, balance, promised, status, promised)
    )
    dep_added += 1
print(f"[deposits] created {dep_added}")

# ---------- 6. 借货单 ----------
# 口径自洽：direction 必须 'out'/'in'（loan_create/loan_return 只认英文值）；
# status 只用系统真实值（借出中/借入中/已归还/已核销），逾期由 due_date 推导，不存在"已逾期"状态；
# 活动借出单必须同步 products.status='借出'，否则提醒条（查 loans）与库存 KPI（查 products）对不上。
NEW_LOANS = [
    # (direction, product, code, party, qty, loan_date, due_date, status, store_id)
    ("out", "足金项链·肖邦链", "J012", "周大福", 1, "2026-09-10", "2026-10-10", "已归还", 1),
    ("out", "翡翠手镯·冰种", "J014", "老凤祥", 1, "2026-10-01", "2026-10-14", "借出中", 1),
    ("in", "钻石项链·1克拉", "J023", "钻石世家", 1, "2026-10-05", "2026-10-20", "已归还", 2),
    ("out", "足金手镯·古法金", "J011", "六福珠宝", 1, "2026-10-08", "2026-10-22", "借出中", 1),
    ("out", "铂金钻戒·30分", "J013", "谢瑞麟", 1, "2026-10-12", "2026-10-26", "借出中", 1),
]
loan_added = 0
for direction, product, code, party, qty, loan_date, due_date, status, sid in NEW_LOANS:
    # 商品名以库内实际 code 为准（基础 seed 与脚本商品可能抢码，防止单货不符）
    prow = conn.execute("SELECT name FROM products WHERE code=?", (code,)).fetchone()
    if prow:
        product = prow["name"]
    conn.execute(
        "INSERT INTO loans(direction,product,code,party,qty,loan_date,due_date,status,store_id) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (direction, product, code, party, qty, loan_date, due_date, status, sid)
    )
    if direction == "out" and status == "借出中":
        conn.execute("UPDATE products SET status='借出' WHERE code=? AND status='在库'", (code,))
    loan_added += 1
print(f"[loans] created {loan_added}")

# ---------- 7. 维修单 ----------
NEW_REPAIRS = [
    # (customer, phone, item, issue, est_fee, actual_fee, receive_date, promised_date, done_date, status, store_id)
    ("王丽", "13811112222", "足金戒指", "改圈号", 200, 200, "2026-09-20", "2026-09-25", "2026-09-24", "已完成", 1),
    ("李强", "13933334444", "翡翠吊坠", "换扣头", 150, 150, "2026-10-01", "2026-10-05", "2026-10-04", "已完成", 1),
    ("张敏", "13755556666", "铂金项链", "焊接", 300, 0, "2026-10-10", "2026-10-18", "", "维修中", 2),
    ("刘洋", "13677778888", "钻石耳钉", "翻新", 500, 500, "2026-10-08", "2026-10-15", "2026-10-14", "待取件", 1),
    ("陈静", "13599990000", "珍珠项链", "重串", 180, 180, "2026-09-15", "2026-09-20", "2026-09-19", "已完成", 1),
    ("赵磊", "13422223333", "K金手链", "抛光", 100, 0, "2026-10-12", "2026-10-20", "", "维修中", 1),
]
rep_added = 0
for cust, phone, item, issue, est_fee, actual_fee, recv, promised, done, status, sid in NEW_REPAIRS:
    conn.execute(
        "INSERT INTO repairs(customer,phone,item,issue,est_fee,actual_fee,receive_date,promised_date,done_date,status,store_id) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (cust, phone, item, issue, est_fee, actual_fee, recv, promised, done, status, sid)
    )
    rep_added += 1
print(f"[repairs] created {rep_added}")

# ---------- 8. 采购单 ----------
NEW_PURCHASES = [
    # (supplier, product, qty, cost, order_date, expected_date, received_date, status, store_id)
    ("深圳金展珠宝", "足金原料 500g", 500, 210000, "2026-09-05", "2026-09-08", "2026-09-07", "已入库", 1),
    ("广州翡翠批发", "翡翠手镯·冰种 x2", 2, 56000, "2026-09-12", "2026-09-15", "2026-09-14", "已入库", 1),
    ("上海钻石交易所", "钻石裸石·50分 x5", 5, 75000, "2026-10-01", "2026-10-05", "2026-10-04", "已入库", 2),
    ("深圳金展珠宝", "足金原料 300g", 300, 127500, "2026-10-08", "2026-10-10", "2026-10-09", "已入库", 1),
    ("诸暨珍珠市场", "Akoya珍珠 x50", 50, 6000, "2026-10-12", "2026-10-18", "", "在途", 1),
]
pur_added = 0
for supplier, product, qty, cost, order_d, expected, received, status, sid in NEW_PURCHASES:
    conn.execute(
        "INSERT INTO purchases(supplier,product,qty,cost,order_date,expected_date,received_date,status,store_id) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (supplier, product, qty, cost, order_d, expected, received, status, sid)
    )
    pur_added += 1
print(f"[purchases] created {pur_added}")

# ---------- 9. 委外加工单 ----------
NEW_OUTSOURCINGS = [
    # (factory, product, material, weight, gold_price, labor_fee, send_date, expected_date, received_date, status, store_id)
    ("深圳精工坊", "足金手镯·古法金", "足金", 35.2, 420, 2000, "2026-09-10", "2026-09-20", "2026-09-18", "已收货", 1),
    ("广州玉雕厂", "翡翠观音吊坠", "翡翠", 12.8, 0, 800, "2026-10-01", "2026-10-10", "2026-10-08", "已收货", 1),
    ("深圳镶嵌厂", "钻石项链·1克拉", "铂金+钻石", 5.6, 0, 5000, "2026-10-08", "2026-10-25", "", "加工中", 2),
]
out_added = 0
for factory, product, material, weight, gold_price, labor_fee, send_d, expected, received, status, sid in NEW_OUTSOURCINGS:
    conn.execute(
        "INSERT INTO outsourcings(factory,product,material,weight,gold_price,labor_fee,send_date,expected_date,received_date,status,store_id) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (factory, product, material, weight, gold_price, labor_fee, send_d, expected, received, status, sid)
    )
    out_added += 1
print(f"[outsourcings] created {out_added}")

# ---------- 10. 预约单 ----------
NEW_APPOINTMENTS = [
    # (name, contact, category, want_date, want_slot, status, store_id)
    ("王丽", "13811112222", "看货", "2026-10-16", "10:00-11:00", "已预约", 1),
    ("李强", "13933334444", "试戴", "2026-10-16", "14:00-15:00", "已到店", 1),
    ("张敏", "13755556666", "维修取件", "2026-10-17", "11:00-12:00", "已预约", 2),
    ("刘洋", "13677778888", "看货", "2026-10-18", "15:00-16:00", "已预约", 1),
    ("陈静", "13599990000", "保养", "2026-10-15", "10:00-11:00", "已成交", 1),
    ("赵磊", "13422223333", "看货", "2026-10-19", "16:00-17:00", "已预约", 1),
]
appt_added = 0
for name, contact, cat, want_date, want_slot, status, sid in NEW_APPOINTMENTS:
    conn.execute(
        "INSERT INTO appointments(name,contact,category,want_date,want_slot,status,created,store_id) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (name, contact, cat, want_date, want_slot, status, today.isoformat(), sid)
    )
    appt_added += 1
print(f"[appointments] created {appt_added}")

conn.commit()
conn.close()

# ---------- 验证 ----------
TOKEN = login()
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

trend = api("/api/dashboard/trend?range=30d")
print(f"\n[trend 30d] labels={len(trend['labels'])} non-null={sum(1 for a in trend['amounts'] if a)}")
print(f"[trend 30d] lastYear non-null={sum(1 for a in trend['amountsLastYear'] if a)}")

sale_ana = api("/api/sales/analysis")
print(f"[sale analysis] categories={len(sale_ana['categories'])}")
for c in sale_ana["categories"]:
    print(f"  {c['name']}: ¥{c['value']:,.0f}")
print(f"[sale analysis] ptypeShares={len(sale_ana.get('ptypeShares', []))}")

inv_sum = api("/api/inventory/summary")
print(f"[inventory] categories={len(inv_sum['categories'])}")
for c in inv_sum["categories"]:
    print(f"  {c['name']}: {c['value']}")
print(f"[inventory] ptypeInv={len(inv_sum.get('ptypeShares', []))}")

sales = api("/api/sales")
print(f"[sales] total={len(sales['items'])}")
deposits = api("/api/deposits")
print(f"[deposits] total={len(deposits['items'])}")
loans = api("/api/loans")
print(f"[loans] total={len(loans['items'])}")
repairs = api("/api/repairs")
print(f"[repairs] total={len(repairs['items'])}")

print("\n✅ 沙箱演示数据填充完成！")
