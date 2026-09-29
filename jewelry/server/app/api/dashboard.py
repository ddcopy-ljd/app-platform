from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models import Product, Sale, Customer, Deposit
from datetime import datetime, date

router = APIRouter()

@router.get("")
def get_dashboard(db: Session = Depends(get_db)):
    tenant_id = 1
    
    total_products = db.query(Product).filter(
        Product.tenant_id == tenant_id,
        Product.status == "在库"
    ).count()
    
    inventory_cost = db.query(func.sum(Product.cost_price)).filter(
        Product.tenant_id == tenant_id,
        Product.status == "在库"
    ).scalar() or 0
    
    today = date.today()
    today_sales = db.query(func.sum(Sale.total_amount)).filter(
        Sale.tenant_id == tenant_id,
        func.date(Sale.created_at) == today
    ).scalar() or 0
    
    today_orders = db.query(func.count(Sale.id)).filter(
        Sale.tenant_id == tenant_id,
        func.date(Sale.created_at) == today
    ).scalar() or 0
    
    total_customers = db.query(Customer).filter(
        Customer.tenant_id == tenant_id
    ).count()
    
    unpaid_amount = db.query(func.sum(Deposit.balance)).filter(
        Deposit.tenant_id == tenant_id,
        Deposit.status == "已收定金"
    ).scalar() or 0
    
    recent_sales = db.query(Sale).filter(
        Sale.tenant_id == tenant_id
    ).order_by(Sale.created_at.desc()).limit(10).all()
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "total_products": total_products,
            "inventory_cost": inventory_cost,
            "today_sales": today_sales,
            "today_orders": today_orders,
            "total_customers": total_customers,
            "unpaid_amount": unpaid_amount,
            "recent_sales": [
                {
                    "id": s.id,
                    "order_no": s.order_no,
                    "total_amount": s.total_amount,
                    "paid_amount": s.paid_amount,
                    "created_at": s.created_at.isoformat() if s.created_at else None
                }
                for s in recent_sales
            ]
        }
    }