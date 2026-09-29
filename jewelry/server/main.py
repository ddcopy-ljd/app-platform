from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from app.database import engine, Base
from app.middleware.auth import AuthMiddleware
from app.middleware.tenant import TenantMiddleware
from app.api import router as api_router

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

dist_path = os.path.join(os.path.dirname(__file__), "dist")
if os.path.exists(dist_path):
    app.mount("/apps/jewelry", StaticFiles(directory=dist_path, html=True), name="frontend")

@app.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/")
def root():
    index_path = os.path.join(os.path.dirname(__file__), "dist", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "懿珠宝管家 v1.0.0", "docs": "/docs"}