from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import OperationLog
from typing import Optional

router = APIRouter()

@router.get("")
def get_logs(
    action: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    tenant_id = 1
    query = db.query(OperationLog).filter(OperationLog.tenant_id == tenant_id)
    
    if action:
        query = query.filter(OperationLog.action.contains(action))
    
    total = query.count()
    logs = query.order_by(OperationLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": log.id,
                    "action": log.action,
                    "target": log.target,
                    "detail": log.detail,
                    "created_at": log.created_at.isoformat() if log.created_at else None
                }
                for log in logs
            ]
        }
    }