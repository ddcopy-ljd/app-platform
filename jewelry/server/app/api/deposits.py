from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Deposit, Product, Sale, SaleItem, Customer, OperationLog
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

router = APIRouter()

class DepositCreate(BaseModel):
    customer_id: Optional[int] = None
    product_id: int
    deposit_amount: float
    total_amount: float
    promise_date: Optional[str] = None
    reminder_days: int = 3

@router.get("")
def get_deposits(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    tenant_id = 1
    query = db.query(Deposit).filter(Deposit.tenant_id == tenant_id)
    
    if status:
        query = query.filter(Deposit.status == status)
    
    total = query.count()
    deposits = query.order_by(Deposit.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": d.id,
                    "customer_id": d.customer_id,
                    "product_id": d.product_id,
                    "deposit_amount": d.deposit_amount,
                    "total_amount": d.total_amount,
                    "balance": d.balance,
                    "promise_date": d.promise_date.isoformat() if d.promise_date else None,
                    "reminder_days": d.reminder_days,
                    "status": d.status,
                    "created_at": d.created_at.isoformat() if d.created_at else None
                }
                for d in deposits
            ]
        }
    }

@router.post("")
def create_deposit(data: DepositCreate, db: Session = Depends(get_db)):
    tenant_id = 1
    store_id = 1
    
    product = db.query(Product).filter(
        Product.id == data.product_id,
        Product.tenant_id == tenant_id
    ).first()
    
    if not product:
        return {"code": 40401, "message": "商品不存在"}
    
    product.status = "已定"
    
    deposit = Deposit(
        tenant_id=tenant_id,
        store_id=store_id,
        customer_id=data.customer_id,
        product_id=data.product_id,
        deposit_amount=data.deposit_amount,
        total_amount=data.total_amount,
        balance=data.total_amount - data.deposit_amount,
        promise_date=datetime.fromisoformat(data.promise_date) if data.promise_date else None,
        reminder_days=data.reminder_days,
        status="已收定金",
        created_by=1
    )
    db.add(deposit)
    db.commit()
    db.refresh(deposit)
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=store_id,
        user_id=1,
        action="收定金",
        target=f"定金单:{deposit.id}",
        detail={"product_id": data.product_id, "deposit_amount": data.deposit_amount}
    )
    db.add(log)
    db.commit()
    
    return {"code": 0, "message": "success", "data": {"id": deposit.id}}

@router.post("/{deposit_id}/pay")
def pay_balance(deposit_id: int, db: Session = Depends(get_db)):
    tenant_id = 1
    store_id = 1
    
    deposit = db.query(Deposit).filter(
        Deposit.id == deposit_id,
        Deposit.tenant_id == tenant_id
    ).first()
    
    if not deposit:
        return {"code": 40401, "message": "定金单不存在"}
    
    if deposit.status != "已收定金":
        return {"code": 40001, "message": "定金单状态异常"}
    
    order_no = f"SO{datetime.now().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:4].upper()}"
    
    sale = Sale(
        tenant_id=tenant_id,
        store_id=store_id,
        customer_id=deposit.customer_id,
        order_no=order_no,
        total_amount=deposit.total_amount,
        paid_amount=deposit.total_amount,
        payment_method="尾款",
        created_by=1
    )
    db.add(sale)
    db.flush()
    
    sale_item = SaleItem(
        tenant_id=tenant_id,
        sale_id=sale.id,
        product_id=deposit.product_id,
        price=deposit.total_amount
    )
    db.add(sale_item)
    
    product = db.query(Product).filter(
        Product.id == deposit.product_id,
        Product.tenant_id == tenant_id
    ).first()
    if product:
        product.status = "已完成"
    
    if deposit.customer_id:
        customer = db.query(Customer).filter(
            Customer.id == deposit.customer_id,
            Customer.tenant_id == tenant_id
        ).first()
        if customer:
            customer.total_consumption = (customer.total_consumption or 0) + deposit.total_amount
    
    deposit.status = "已付尾款"
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=store_id,
        user_id=1,
        action="付尾款转销售",
        target=f"订单:{order_no}",
        detail={"deposit_id": deposit_id, "order_no": order_no}
    )
    db.add(log)
    db.commit()
    
    return {"code": 0, "message": "success", "data": {"sale_id": sale.id, "order_no": order_no}}