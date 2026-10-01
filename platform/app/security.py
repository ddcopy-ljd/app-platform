import hashlib
import hmac
import secrets
import threading
import time

from fastapi import Header, HTTPException, Request

from .config import SESSION_TTL_SECONDS

_ITERATIONS = 240_000
_sessions: dict[str, dict] = {}
_lock = threading.Lock()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(calc.hex(), digest)
    except ValueError:
        return False


def create_session(user: dict) -> str:
    token = secrets.token_urlsafe(32)
    with _lock:
        _sessions[token] = {"user": user, "expires": time.time() + SESSION_TTL_SECONDS}
    return token


def drop_session(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)


SESSION_COOKIE = "platform_session"


def session_user(token: str) -> dict:
    with _lock:
        sess = _sessions.get(token)
        if not sess or sess["expires"] < time.time():
            _sessions.pop(token, None)
            raise HTTPException(status_code=401, detail="未登录或登录已过期，请先登录平台")
        sess["expires"] = time.time() + SESSION_TTL_SECONDS
        return sess["user"]


def current_user(authorization: str = Header(default="")) -> dict:
    return session_user(authorization.removeprefix("Bearer ").strip())


def cookie_user(request: Request) -> dict:
    """浏览器直接打开的应用入口没有 Bearer 头，使用登录时下发的 HttpOnly Cookie。"""
    return session_user(request.cookies.get(SESSION_COOKIE, ""))
