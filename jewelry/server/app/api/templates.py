from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import LabelTemplate, PrintLog, OperationLog
from pydantic import BaseModel
from typing import Optional, List
import uuid

router = APIRouter()

class TemplateCreate(BaseModel):
    name: str
    store_id: int = 0
    width: float
    height: float
    elements: Optional[list] = None

class PrintRequest(BaseModel):
    template_id: str
    printer_type: str
    product_ids: List[int]

@router.get("")
def get_templates(
    store_id: Optional[int] = Query(0),
    db: Session = Depends(get_db)
):
    tenant_id = 1
    templates = db.query(LabelTemplate).filter(
        LabelTemplate.tenant_id == tenant_id,
        (LabelTemplate.store_id == store_id) | (LabelTemplate.store_id == 0)
    ).all()
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "items": [
                {
                    "id": t.id,
                    "name": t.name,
                    "store_id": t.store_id,
                    "width": t.width,
                    "height": t.height,
                    "elements": t.elements,
                    "is_builtin": t.is_builtin,
                    "created_at": t.created_at.isoformat() if t.created_at else None
                }
                for t in templates
            ]
        }
    }

@router.post("")
def create_template(data: TemplateCreate, db: Session = Depends(get_db)):
    tenant_id = 1
    template_id = f"TPL{uuid.uuid4().hex[:8].upper()}"
    
    template = LabelTemplate(
        id=template_id,
        tenant_id=tenant_id,
        name=data.name,
        store_id=data.store_id,
        width=data.width,
        height=data.height,
        elements=data.elements or []
    )
    db.add(template)
    db.commit()
    
    return {"code": 0, "message": "success", "data": {"id": template_id}}

@router.post("/print")
def print_labels(data: PrintRequest, db: Session = Depends(get_db)):
    tenant_id = 1
    store_id = 1
    user_id = 1
    
    template = db.query(LabelTemplate).filter(
        LabelTemplate.id == data.template_id,
        LabelTemplate.tenant_id == tenant_id
    ).first()
    
    if not template:
        return {"code": 40401, "message": "模板不存在"}
    
    zpl_data = generate_zpl(data.product_ids, template)
    
    log = PrintLog(
        tenant_id=tenant_id,
        store_id=store_id,
        user_id=user_id,
        template_id=data.template_id,
        printer_type=data.printer_type,
        product_ids=data.product_ids,
        status="成功"
    )
    db.add(log)
    db.commit()
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "zpl": zpl_data,
            "count": len(data.product_ids)
        }
    }

def generate_zpl(product_ids: List[int], template: LabelTemplate) -> str:
    zpl_lines = []
    zpl_lines.append("^XA")
    
    for pid in product_ids:
        zpl_lines.append(f"^FO{int(template.width * 10)},{int(template.height * 10)}^A0N,30,30^FDProduct:{pid}^FS")
        zpl_lines.append(f"^FO{int(template.width * 10)},{int(template.height * 10) + 40}^BQN,2,4^FQA{pid}^FS")
    
    zpl_lines.append("^XZ")
    return "\n".join(zpl_lines)