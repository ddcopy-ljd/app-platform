from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Stocktake, StocktakeItem, Product, OperationLog
from pydantic import BaseModel
from typing import Optional, List
import uuid
from datetime import datetime

router = APIRouter()

class StocktakeCreate(BaseModel):
    store_id: int
    type: str
    scope: Optional[str] = None
    method: str
    remark: Optional[str] = None

class CollectData(BaseModel):
    identifiers: List[str]
    collected_by: str

class ApproveData(BaseModel):
    approved_by: int

@router.get("")
def get_stocktakes(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    tenant_id = 1
    query = db.query(Stocktake).filter(Stocktake.tenant_id == tenant_id)
    
    if status:
        query = query.filter(Stocktake.status == status)
    
    total = query.count()
    stocktakes = query.order_by(Stocktake.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
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
                    "store_id": s.store_id,
                    "type": s.type,
                    "scope": s.scope,
                    "method": s.method,
                    "status": s.status,
                    "total_items": s.total_items,
                    "checked_items": s.checked_items,
                    "diff_count": s.diff_count,
                    "diff_amount": s.diff_amount,
                    "created_at": s.created_at.isoformat() if s.created_at else None
                }
                for s in stocktakes
            ]
        }
    }

@router.post("")
def create_stocktake(data: StocktakeCreate, db: Session = Depends(get_db)):
    tenant_id = 1
    stocktake_id = f"ST{datetime.now().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:4].upper()}"
    
    stocktake = Stocktake(
        id=stocktake_id,
        tenant_id=tenant_id,
        store_id=data.store_id,
        type=data.type,
        scope=data.scope,
        method=data.method,
        status="盘点中",
        created_by=1,
        remark=data.remark
    )
    db.add(stocktake)
    db.commit()
    
    if data.scope == "全盘":
        products = db.query(Product).filter(
            Product.tenant_id == tenant_id,
            Product.store_id == data.store_id,
            Product.status == "在库"
        ).all()
        
        for p in products:
            item = StocktakeItem(
                tenant_id=tenant_id,
                stocktake_id=stocktake_id,
                product_id=p.id,
                product_code=p.product_code,
                product_name=p.name,
                book_status=p.status,
                book_store_id=p.store_id,
                book_location=p.location
            )
            db.add(item)
        
        stocktake.total_items = len(products)
        db.commit()
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=data.store_id,
        user_id=1,
        action="创建盘点单",
        target=f"盘点单:{stocktake_id}",
        detail={"type": data.type, "scope": data.scope}
    )
    db.add(log)
    db.commit()
    
    return {"code": 0, "message": "success", "data": {"id": stocktake_id}}

@router.post("/{stocktake_id}/collect")
def collect_items(stocktake_id: str, data: CollectData, db: Session = Depends(get_db)):
    tenant_id = 1
    
    stocktake = db.query(Stocktake).filter(
        Stocktake.id == stocktake_id,
        Stocktake.tenant_id == tenant_id
    ).first()
    
    if not stocktake:
        return {"code": 40401, "message": "盘点单不存在"}
    
    if stocktake.status != "盘点中":
        return {"code": 40001, "message": "盘点单状态不允许采集"}
    
    book_items = db.query(StocktakeItem).filter(
        StocktakeItem.stocktake_id == stocktake_id,
        StocktakeItem.tenant_id == tenant_id
    ).all()
    
    book_map = {item.product_code: item for item in book_items}
    collected_codes = set()
    
    for identifier in data.identifiers:
        product = db.query(Product).filter(
            (Product.product_code == identifier) | (Product.epc == identifier),
            Product.tenant_id == tenant_id
        ).first()
        
        if product:
            collected_codes.add(product.product_code)
            
            if product.product_code in book_map:
                item = book_map[product.product_code]
                item.actual_status = product.status
                item.actual_store_id = product.store_id
                item.actual_location = product.location
                item.actual_qty = 1
                item.collected_by = data.collected_by
                item.identifier = identifier
                item.checked_at = datetime.now()
            else:
                new_item = StocktakeItem(
                    tenant_id=tenant_id,
                    stocktake_id=stocktake_id,
                    product_id=product.id,
                    product_code=product.product_code,
                    product_name=product.name,
                    book_status="无",
                    actual_status=product.status,
                    actual_store_id=product.store_id,
                    actual_location=product.location,
                    actual_qty=1,
                    diff_type="盘盈",
                    collected_by=data.collected_by,
                    identifier=identifier,
                    checked_at=datetime.now()
                )
                db.add(new_item)
    
    for code, item in book_map.items():
        if code not in collected_codes:
            item.diff_type = "盘亏"
    
    diff_items = db.query(StocktakeItem).filter(
        StocktakeItem.stocktake_id == stocktake_id,
        StocktakeItem.tenant_id == tenant_id,
        StocktakeItem.diff_type != None
    ).count()
    
    stocktake.checked_items = len(collected_codes)
    stocktake.diff_count = diff_items
    stocktake.status = "待审核"
    stocktake.submitted_at = datetime.now()
    db.commit()
    
    return {"code": 0, "message": "success", "data": {"checked": len(collected_codes), "diff": diff_items}}

@router.post("/{stocktake_id}/approve")
def approve_stocktake(stocktake_id: str, data: ApproveData, db: Session = Depends(get_db)):
    tenant_id = 1
    
    stocktake = db.query(Stocktake).filter(
        Stocktake.id == stocktake_id,
        Stocktake.tenant_id == tenant_id
    ).first()
    
    if not stocktake:
        return {"code": 40401, "message": "盘点单不存在"}
    
    if stocktake.status != "待审核":
        return {"code": 40001, "message": "盘点单状态不允许审核"}
    
    items = db.query(StocktakeItem).filter(
        StocktakeItem.stocktake_id == stocktake_id,
        StocktakeItem.tenant_id == tenant_id
    ).all()
    
    for item in items:
        if item.diff_type == "盘亏":
            product = db.query(Product).filter(
                Product.id == item.product_id,
                Product.tenant_id == tenant_id
            ).first()
            if product:
                product.status = "盘亏"
        elif item.diff_type == "盘盈":
            pass
    
    stocktake.status = "已完成"
    stocktake.approved_by = data.approved_by
    stocktake.approved_at = datetime.now()
    db.commit()
    
    log = OperationLog(
        tenant_id=tenant_id,
        store_id=stocktake.store_id,
        user_id=data.approved_by,
        action="审核盘点单",
        target=f"盘点单:{stocktake_id}",
        detail={"diff_count": stocktake.diff_count}
    )
    db.add(log)
    db.commit()
    
    return {"code": 0, "message": "success"}