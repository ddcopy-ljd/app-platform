from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Product, EpcMapping, OperationLog
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter()

class ProductCreate(BaseModel):
    name: str
    category: Optional[str] = None
    material: Optional[str] = None
    weight: Optional[float] = None
    cost_price: Optional[float] = None
    sell_price: Optional[float] = None
    location: Optional[str] = None
    remark: Optional[str] = None

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    material: Optional[str] = None
    weight: Optional[float] = None
    cost_price: Optional[float] = None
    sell_price: Optional[float] = None
    status: Optional[str] = None
    location: Optional[str] = None
    remark: Optional[str] = None

def generate_epc(store_id: int, category: str):
    prefix = "JEWELRY"
    store_code = str(store_id).zfill(4)
    cat_code = category[:2].upper() if category else "00"
    serial = str(uuid.uuid4().int)[:10]
    return f"{prefix}{store_code}{cat_code}{serial}"

@router.get("")
def get_products(
    keyword: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    tenant_id = 1
    query = db.query(Product).filter(Product.tenant_id == tenant_id)
    
    if keyword:
        query = query.filter(
            (Product.name.contains(keyword)) | 
            (Product.product_code.contains(keyword))
        )
    if status:
        query = query.filter(Product.status == status)
    if category:
        query = query.filter(Product.category == category)
    
    total = query.count()
    products = query.order_by(Product.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": p.id,
                    "product_code": p.product_code,
                    "epc": p.epc,
                    "name": p.name,
                    "category": p.category,
                    "material": p.material,
                    "weight": p.weight,
                    "cost_price": p.cost_price,
                    "sell_price": p.sell_price,
                    "status": p.status,
                    "location": p.location,
                    "created_at": p.created_at.isoformat() if p.created_at else None
                }
                for p in products
            ]
        }
    }

@router.get("/{product_id}")
def get_product(product_id: int, db: Session = Depends(get_db)):
    tenant_id = 1
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.tenant_id == tenant_id
    ).first()
    
    if not product:
        return {"code": 40401, "message": "商品不存在"}
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "id": product.id,
            "product_code": product.product_code,
            "epc": product.epc,
            "name": product.name,
            "category": product.category,
            "material": product.material,
            "weight": product.weight,
            "cost_price": product.cost_price,
            "sell_price": product.sell_price,
            "status": product.status,
            "location": product.location,
            "remark": product.remark,
            "created_at": product.created_at.isoformat() if product.created_at else None,
            "updated_at": product.updated_at.isoformat() if product.updated_at else None
        }
    }

@router.post("")
def create_product(data: ProductCreate, db: Session = Depends(get_db)):
    tenant_id = 1
    store_id = 1
    
    product_code = f"P{uuid.uuid4().hex[:8].upper()}"
    epc = generate_epc(store_id, data.category or "")
    
    product = Product(
        tenant_id=tenant_id,
        store_id=store_id,
        product_code=product_code,
        epc=epc,
        name=data.name,
        category=data.category,
        material=data.material,
        weight=data.weight,
        cost_price=data.cost_price,
        sell_price=data.sell_price,
        location=data.location,
        remark=data.remark,
        status="在库"
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    
    epc_mapping = EpcMapping(
        epc=epc,
        tenant_id=tenant_id,
        product_id=product.id,
        store_id=store_id
    )
    db.add(epc_mapping)
    db.commit()
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=store_id,
        user_id=1,
        action="创建商品",
        target=f"商品:{product.name}",
        detail={"product_id": product.id, "product_code": product_code}
    )
    db.add(log)
    db.commit()
    
    return {
        "code": 0,
        "message": "success",
        "data": {"id": product.id, "product_code": product_code, "epc": epc}
    }

@router.put("/{product_id}")
def update_product(product_id: int, data: ProductUpdate, db: Session = Depends(get_db)):
    tenant_id = 1
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.tenant_id == tenant_id
    ).first()
    
    if not product:
        return {"code": 40401, "message": "商品不存在"}
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(product, key, value)
    
    db.commit()
    db.refresh(product)
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=1,
        user_id=1,
        action="更新商品",
        target=f"商品:{product.name}",
        detail={"product_id": product_id, "updates": update_data}
    )
    db.add(log)
    db.commit()
    
    return {"code": 0, "message": "success", "data": {"id": product.id}}