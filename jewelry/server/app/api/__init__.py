from fastapi import APIRouter
from app.api import dashboard, products, inventory, sales, customers, deposits, stocktakes, templates, logs

router = APIRouter()

router.include_router(dashboard.router, prefix="/dashboard", tags=["经营看板"])
router.include_router(products.router, prefix="/products", tags=["商品管理"])
router.include_router(inventory.router, prefix="/inventory", tags=["库存管理"])
router.include_router(sales.router, prefix="/sales", tags=["销售开单"])
router.include_router(customers.router, prefix="/customers", tags=["客户管理"])
router.include_router(deposits.router, prefix="/deposits", tags=["定金尾款"])
router.include_router(stocktakes.router, prefix="/stocktakes", tags=["库存盘点"])
router.include_router(templates.router, prefix="/templates", tags=["标签模板"])
router.include_router(logs.router, prefix="/logs", tags=["操作日志"])