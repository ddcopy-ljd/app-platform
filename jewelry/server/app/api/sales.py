from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Sale, SaleItem, Product, Customer, OperationLog
from pydantic import BaseModel
from typing import Optional, List
import uuid
from datetime import datetime

router = APIRouter()

class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    items: List[dict]
    payment_method: Optional[str] = None

@router.get("")
def get_sales(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    tenant_id = 1
    total = db.query(Sale).filter(Sale.tenant_id == tenant_id).count()
    sales = db.query(Sale).filter(
        Sale.tenant_id == tenant_id
    ).order_by(Sale.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": s.id,
                    "order_no": s.order_no,
                    "total_amount": s.total_amount,
                    "paid_amount": s.paid_amount,
                    "payment_method": s.payment_method,
                    "status": s.status,
                    "created_at": s.created_at.isoformat() if s.created_at else None
                }
                for s in sales
            ]
        }
    }

@router.post("")
def create_sale(data: SaleCreate, db: Session = Depends(get_db)):
    tenant_id = 1
    store_id = 1
    
    order_no = f"SO{datetime.now().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:4].upper()}"
    total_amount = sum(item.get("price", 0) for item in data.items)
    paid_amount = total_amount
    
    sale = Sale(
        tenant_id=tenant_id,
        store_id=store_id,
        customer_id=data.customer_id,
        order_no=order_no,
        total_amount=total_amount,
        paid_amount=paid_amount,
        payment_method=data.payment_method,
        created_by=1
    )
    db.add(sale)
    db.flush()
    
    for item in data.items:
        sale_item = SaleItem(
            tenant_id=tenant_id,
            sale_id=sale.id,
            product_id=item["product_id"],
            price=item["price"]
        )
        db.add(sale_item)
        
        product = db.query(Product).filter(
            Product.id == item["product_id"],
            Product.tenant_id == tenant_id
        ).first()
        if product:
            product.status = "已完成"
    
    if data.customer_id:
        customer = db.query(Customer).filter(
            Customer.id == data.customer_id,
            Customer.tenant_id == tenant_id
        ).first()
        if customer:
            customer.total_consumption = (customer.total_consumption or 0) + total_amount
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=store_id,
        user_id=1,
        action="销售开单",
        target=f"订单:{order_no}",
        detail={"order_no": order_no, "total_amount": total_amount}
    )
    db.add(log)
    db.commit()
    db.refresh(sale)
    
    return {
        "code": 0,
        "message": "success",
        "data": {"id": sale.id, "order_no": order_no}
    }