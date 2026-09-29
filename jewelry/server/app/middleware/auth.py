from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from jose import JWTError, jwt
import os

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "jewelry-dev-secret-key")
ALGORITHM = "HS256"

FEATURE_MAP = {
    "/dashboard": "jewelry_dashboard",
    "/products": "jewelry_products",
    "/inventory": "jewelry_inventory",
    "/sales": "jewelry_sales",
    "/customers": "jewelry_customers",
    "/deposits": "jewelry_deposits",
    "/stocktakes": "jewelry_stocktaking",
    "/templates": "jewelry_label_print",
    "/print": "jewelry_label_print",
    "/logs": "jewelry_logs_basic",
}

SKIP_PATHS = ["/health", "/docs", "/openapi.json", "/favicon.ico"]

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        
        if path.startswith("/api/jewelry"):
            api_path = path.replace("/api/jewelry", "")
            
            if any(path.startswith(skip) for skip in SKIP_PATHS):
                return await call_next(request)
            
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return JSONResponse(
                    status_code=401,
                    content={"code": 40101, "message": "未登录或登录已过期"}
                )
            
            token = auth_header.replace("Bearer ", "")
            try:
                payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
                request.state.tenant_id = payload.get("tenant_id")
                request.state.user_id = payload.get("user_id")
                request.state.features = payload.get("features", [])
            except JWTError:
                return JSONResponse(
                    status_code=401,
                    content={"code": 40101, "message": "Token 无效或已过期"}
                )
            
            required_feature = None
            for prefix, feature in FEATURE_MAP.items():
                if api_path.startswith(prefix):
                    required_feature = feature
                    break
            
            if required_feature and required_feature not in request.state.features:
                return JSONResponse(
                    status_code=403,
                    content={
                        "code": 40301,
                        "message": "功能未订阅",
                        "data": {"requiredFeature": required_feature}
                    }
                )
        
        return await call_next(request)