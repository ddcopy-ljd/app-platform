from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        
        if path.startswith("/api/jewelry") and not path.startswith("/health"):
            tenant_header = request.headers.get("X-Tenant-Id")
            
            if hasattr(request.state, "tenant_id") and request.state.tenant_id:
                request.state.current_tenant_id = request.state.tenant_id
            elif tenant_header:
                try:
                    request.state.current_tenant_id = int(tenant_header)
                except ValueError:
                    return JSONResponse(
                        status_code=400,
                        content={"code": 40001, "message": "租户 ID 格式错误"}
                    )
            else:
                return JSONResponse(
                    status_code=400,
                    content={"code": 40002, "message": "缺少租户信息"}
                )
        
        return await call_next(request)