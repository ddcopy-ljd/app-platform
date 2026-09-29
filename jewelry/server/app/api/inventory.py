from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Product
from typing import Optional

router = APIRouter()

@router.get("")
def get_inventory(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    tenant_id = 1
    query = db.query(Product).filter(Product.tenant_id == tenant_id)
    
    if status:
        query = query.filter(Product.status == status)
    
    items = query.all()
    
    stats = {
        "在库": db.query(Product).filter(Product.tenant_id == tenant_id, Product.status == "在库").count(),
        "已定": db.query(Product).filter(Product.tenant_id == tenant_id, Product.status == "已定").count(),
        "借出": db.query(Product).filter(Product.tenant_id == tenant_id, Product.status == "借出").count(),
    }
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "stats": stats,
            "items": [
                {
                    "id": p.id,
                    "product_code": p.product_code,
                    "name": p.name,
                    "category": p.category,
                    "status": p.status,
                    "location": p.location
                }
                for p in items
            ]
        }
    }

@router.post("/inbound")
def inbound_product(product_id: int, db: Session = Depends(get_db)):
    tenant_id = 1
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.tenant_id == tenant_id
    ).first()
    
    if not product:
        return {"code": 40401, "message": "商品不存在"}
    
    product.status = "在库"
    db.commit()
    
    return {"code": 0, "message": "入库成功"}