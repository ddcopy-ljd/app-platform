from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Customer, OperationLog
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    level: Optional[str] = "普通"
    preference: Optional[str] = None

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    level: Optional[str] = None
    preference: Optional[str] = None

@router.get("")
def get_customers(
    keyword: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    tenant_id = 1
    query = db.query(Customer).filter(Customer.tenant_id == tenant_id)
    
    if keyword:
        query = query.filter(
            (Customer.name.contains(keyword)) | 
            (Customer.phone.contains(keyword))
        )
    
    total = query.count()
    customers = query.order_by(Customer.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": c.id,
                    "name": c.name,
                    "phone": c.phone,
                    "level": c.level,
                    "total_consumption": c.total_consumption,
                    "balance": c.balance,
                    "preference": c.preference,
                    "created_at": c.created_at.isoformat() if c.created_at else None
                }
                for c in customers
            ]
        }
    }

@router.get("/{customer_id}")
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    tenant_id = 1
    customer = db.query(Customer).filter(
        Customer.id == customer_id,
        Customer.tenant_id == tenant_id
    ).first()
    
    if not customer:
        return {"code": 40401, "message": "客户不存在"}
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "level": customer.level,
            "total_consumption": customer.total_consumption,
            "balance": customer.balance,
            "preference": customer.preference,
            "created_at": customer.created_at.isoformat() if customer.created_at else None
        }
    }

@router.post("")
def create_customer(data: CustomerCreate, db: Session = Depends(get_db)):
    tenant_id = 1
    
    customer = Customer(
        tenant_id=tenant_id,
        name=data.name,
        phone=data.phone,
        level=data.level,
        preference=data.preference
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=1,
        user_id=1,
        action="新增客户",
        target=f"客户:{customer.name}",
        detail={"customer_id": customer.id}
    )
    db.add(log)
    db.commit()
    
    return {"code": 0, "message": "success", "data": {"id": customer.id}}

@router.put("/{customer_id}")
def update_customer(customer_id: int, data: CustomerUpdate, db: Session = Depends(get_db)):
    tenant_id = 1
    customer = db.query(Customer).filter(
        Customer.id == customer_id,
        Customer.tenant_id == tenant_id
    ).first()
    
    if not customer:
        return {"code": 40401, "message": "客户不存在"}
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(customer, key, value)
    
    db.commit()
    db.refresh(customer)
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=1,
        user_id=1,
        action="更新客户",
        target=f"客户:{customer.name}",
        detail={"customer_id": customer_id, "updates": update_data}
    )
    db.add(log)
    db.commit()
    
    return {"code": 0, "message": "success", "data": {"id": customer.id}}