import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time

from fastapi import Header, HTTPException, Request

from .config import PLATFORM_DB, SESSION_TTL_SECONDS

_ITERATIONS = 240_000
_sessions: dict[str, dict] = {}
_lock = threading.Lock()
_db_ready = False


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


# ---------------------------------------------------------------- 会话持久化
# 会话同步落库到 platform.db：平台重启后内存会话丢失，可从库恢复，登录态不丢。
_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS platform_sessions ("
    "token TEXT PRIMARY KEY, user_json TEXT NOT NULL, expires REAL NOT NULL)"
)


def _ensure_db() -> None:
    global _db_ready
    if _db_ready:
        return
    with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
        conn.execute(_SCHEMA)
        conn.execute("DELETE FROM platform_sessions WHERE expires < ?", (time.time(),))
        conn.commit()
    _db_ready = True


def _persist(token: str, user: dict, expires: float) -> None:
    try:
        _ensure_db()
        with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO platform_sessions(token, user_json, expires) VALUES (?,?,?)",
                (token, json.dumps(user, ensure_ascii=False), expires))
            conn.commit()
    except sqlite3.Error:
        pass  # 持久化失败不影响内存会话可用


def _load(token: str) -> dict | None:
    try:
        _ensure_db()
        with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
            row = conn.execute(
                "SELECT user_json, expires FROM platform_sessions WHERE token = ?", (token,)).fetchone()
    except sqlite3.Error:
        return None
    if not row or row[1] < time.time():
        return None
    try:
        return json.loads(row[0])
    except ValueError:
        return None


def create_session(user: dict) -> str:
    token = secrets.token_urlsafe(32)
    expires = time.time() + SESSION_TTL_SECONDS
    with _lock:
        _sessions[token] = {"user": user, "expires": expires}
    _persist(token, user, expires)
    return token


def drop_session(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)
    try:
        _ensure_db()
        with sqlite3.connect(PLATFORM_DB, timeout=30) as conn:
            conn.execute("DELETE FROM platform_sessions WHERE token = ?", (token,))
            conn.commit()
    except sqlite3.Error:
        pass


SESSION_COOKIE = "platform_session"


def session_user(token: str) -> dict:
    with _lock:
        sess = _sessions.get(token)
        if sess:
            if sess["expires"] < time.time():
                _sessions.pop(token, None)
            else:
                sess["expires"] = time.time() + SESSION_TTL_SECONDS
                return sess["user"]
    user = _load(token)  # 内存没有（如平台重启过），从库恢复
    if user is None:
        raise HTTPException(status_code=401, detail="未登录或登录已过期，请先登录平台")
    with _lock:
        _sessions[token] = {"user": user, "expires": time.time() + SESSION_TTL_SECONDS}
    return user


def current_user(authorization: str = Header(default="")) -> dict:
    return session_user(authorization.removeprefix("Bearer ").strip())


def cookie_user(request: Request) -> dict:
    """浏览器直接打开的应用入口没有 Bearer 头，使用登录时下发的 HttpOnly Cookie。"""
    return session_user(request.cookies.get(SESSION_COOKIE, ""))
