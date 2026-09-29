from sqlalchemy import Column, Integer, String, Float, DateTime, Text, JSON, Boolean, ForeignKey
from sqlalchemy.sql import func
from app.database import Base

class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    store_id = Column(Integer, nullable=False, index=True)
    product_code = Column(String(64), unique=True, nullable=False, index=True)
    epc = Column(String(64), unique=True, nullable=True, index=True)
    name = Column(String(128), nullable=False)
    category = Column(String(64), nullable=True)
    material = Column(String(64), nullable=True)
    weight = Column(Float, nullable=True)
    cost_price = Column(Float, nullable=True)
    sell_price = Column(Float, nullable=True)
    status = Column(String(32), default="在库")
    location = Column(String(64), nullable=True)
    remark = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Customer(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    name = Column(String(64), nullable=False)
    phone = Column(String(32), nullable=True)
    level = Column(String(32), default="普通")
    total_consumption = Column(Float, default=0)
    balance = Column(Float, default=0)
    preference = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Sale(Base):
    __tablename__ = "sales"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    store_id = Column(Integer, nullable=False, index=True)
    customer_id = Column(Integer, nullable=True)
    order_no = Column(String(64), unique=True, nullable=False)
    total_amount = Column(Float, nullable=False)
    paid_amount = Column(Float, nullable=False)
    payment_method = Column(String(32), nullable=True)
    status = Column(String(32), default="已完成")
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

class SaleItem(Base):
    __tablename__ = "sale_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, nullable=False)
    price = Column(Float, nullable=False)

class Deposit(Base):
    __tablename__ = "deposits"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    store_id = Column(Integer, nullable=False, index=True)
    customer_id = Column(Integer, nullable=True)
    product_id = Column(Integer, nullable=False)
    deposit_amount = Column(Float, nullable=False)
    total_amount = Column(Float, nullable=False)
    balance = Column(Float, nullable=False)
    promise_date = Column(DateTime, nullable=True)
    reminder_days = Column(Integer, default=3)
    status = Column(String(32), default="已收定金")
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

class Stocktake(Base):
    __tablename__ = "stocktakes"
    id = Column(String(64), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    store_id = Column(Integer, nullable=False, index=True)
    type = Column(String(32), nullable=False)
    scope = Column(String(128), nullable=True)
    method = Column(String(32), nullable=False)
    status = Column(String(32), default="草稿")
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    submitted_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    total_items = Column(Integer, default=0)
    checked_items = Column(Integer, default=0)
    diff_count = Column(Integer, default=0)
    diff_amount = Column(Float, default=0)
    remark = Column(Text, nullable=True)

class StocktakeItem(Base):
    __tablename__ = "stocktake_items"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    stocktake_id = Column(String(64), ForeignKey("stocktakes.id"), nullable=False)
    product_id = Column(Integer, nullable=False)
    product_code = Column(String(64), nullable=True)
    product_name = Column(String(128), nullable=True)
    book_status = Column(String(32), nullable=True)
    book_store_id = Column(Integer, nullable=True)
    book_location = Column(String(64), nullable=True)
    actual_status = Column(String(32), nullable=True)
    actual_store_id = Column(Integer, nullable=True)
    actual_location = Column(String(64), nullable=True)
    actual_qty = Column(Integer, default=0)
    diff_type = Column(String(32), nullable=True)
    diff_reason = Column(String(128), nullable=True)
    collected_by = Column(String(32), nullable=True)
    identifier = Column(String(64), nullable=True)
    checked_by = Column(Integer, nullable=True)
    checked_at = Column(DateTime, nullable=True)
    remark = Column(Text, nullable=True)

class LabelTemplate(Base):
    __tablename__ = "label_templates"
    id = Column(String(64), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    store_id = Column(Integer, default=0)
    width = Column(Float, nullable=False)
    height = Column(Float, nullable=False)
    elements = Column(JSON, nullable=True)
    is_builtin = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class PrintLog(Base):
    __tablename__ = "print_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    store_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    template_id = Column(String(64), nullable=True)
    printer_type = Column(String(32), nullable=False)
    product_ids = Column(JSON, nullable=True)
    status = Column(String(32), default="成功")
    error_msg = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

class EpcMapping(Base):
    __tablename__ = "epc_mappings"
    epc = Column(String(64), primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    product_id = Column(Integer, nullable=False)
    store_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

class OperationLog(Base):
    __tablename__ = "operation_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    store_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    action = Column(String(128), nullable=False)
    target = Column(String(128), nullable=True)
    detail = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())