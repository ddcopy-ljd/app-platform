from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.middleware.auth import AuthMiddleware
from app.middleware.tenant import TenantMiddleware
from app.api import router as api_router
from app.database import engine, Base

Base.metadata.create_all(bind=engine)

app = FastAPI(title="懿珠宝管家", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(AuthMiddleware)
app.add_middleware(TenantMiddleware)

app.include_router(api_router, prefix="/api/jewelry")

@app.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}