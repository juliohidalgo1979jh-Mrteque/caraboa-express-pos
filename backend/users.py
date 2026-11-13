"""Usuarios con perfil (dueño, encargado, cajero), control de permisos y registro de acciones."""

import hashlib
import hmac
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .models import ActionLog, AppUser

ROLES = ("DUENO", "ENCARGADO", "CAJERO")
ROLE_LABELS = {"DUENO": "Dueño", "ENCARGADO": "Encargado", "CAJERO": "Cajero"}
# Lo que el encargado no puede tocar (salvo leer) y lo único que puede usar el cajero.
OWNER_ONLY_PATHS = ("/api/points", "/api/portal/settings", "/api/settings/heading", "/api/settings/pix", "/api/finance/opening", "/api/loyalty/config")
CASHIER_PATHS = ("/api/admin/verify", "/api/portal/orders", "/api/customers", "/api/coupons/validate", "/api/loyalty/rewards")
ACTION_LABELS = (
    ("/api/purchases", "compras"), ("/api/waste", "mermas"), ("/api/stock-items", "inventario"), ("/api/suppliers", "proveedores"),
    ("/api/equipment", "equipos"), ("/api/products", "la carta"), ("/api/expenses", "gastos"), ("/api/workers", "personal"),
    ("/api/worker-payments", "pagos al personal"), ("/api/finance", "finanzas"), ("/api/portal/orders", "pedidos online"),
    ("/api/portal", "portal de pedidos"), ("/api/points", "puntos de venta"), ("/api/settings", "ajustes"), ("/api/users", "usuarios"),
    ("/api/customers", "clientes"), ("/api/promo-codes", "códigos promocionales"), ("/api/loyalty", "fidelidad"), ("/api/shifts", "turnos"),
)
VERBS = {"POST": "Registró", "PUT": "Modificó", "DELETE": "Eliminó"}
MAX_FAILURES, FAILURE_WINDOW, CACHE_SECONDS = 10, 300, 60


@dataclass(frozen=True)
class Actor:
    name: str
    role: str
    user_id: int | None = None


def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(8)
    return f"{salt}${hashlib.pbkdf2_hmac('sha256', pin.encode(), salt.encode(), 20_000).hex()}"


def pin_matches(pin: str, stored: str) -> bool:
    salt, _, digest = stored.partition("$")
    return hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 20_000).hex(), digest)


class Auth:
    """Reconoce a quien entra por su clave: las dos claves de Render (dueño y encargado) o la de un usuario creado en la app."""

    def __init__(self, owner_pin: str, manager_pin: str, session_factory: Callable[[], Session]) -> None:
        self.owner_pin, self.manager_pin, self.session_factory = owner_pin, manager_pin, session_factory
        self.cache: dict[str, tuple[Actor, float]] = {}
        self.failures: dict[str, list[float]] = defaultdict(list)

    def forget(self) -> None:
        self.cache.clear()

    def has_users(self) -> bool:
        with self.session_factory() as session:
            return bool(session.scalar(select(func.count(AppUser.id))))

    def resolve(self, given: str) -> Actor | None:
        if self.owner_pin and secrets.compare_digest(given.encode(), self.owner_pin.encode()):
            return Actor("Administrador", "DUENO")
        if self.manager_pin and secrets.compare_digest(given.encode(), self.manager_pin.encode()):
            return Actor("Encargado", "ENCARGADO")
        if not given:
            return None
        key = hashlib.sha256(given.encode()).hexdigest()
        cached = self.cache.get(key)
        if cached and cached[1] > time.monotonic():
            return cached[0]
        with self.session_factory() as session:
            for user in session.scalars(select(AppUser).where(AppUser.is_active.is_(True))):
                if pin_matches(given, user.pin_hash):
                    actor = Actor(user.name, user.role, user.id)
                    self.cache[key] = (actor, time.monotonic() + CACHE_SECONDS)
                    return actor
        return None

    def pin_in_use(self, pin: str, except_id: int | None = None) -> bool:
        if (self.owner_pin and pin == self.owner_pin) or (self.manager_pin and pin == self.manager_pin):
            return True
        with self.session_factory() as session:
            return any(pin_matches(pin, user.pin_hash) for user in session.scalars(select(AppUser)) if user.id != except_id)

    @staticmethod
    def client_key(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for", "")
        return forwarded.split(",")[0].strip() or (request.client.host if request.client else "?")

    def require_admin(self, request: Request, x_admin_pin: str = Header(default="")) -> None:
        if not self.owner_pin and not self.has_users():
            request.state.actor = Actor("Sin clave", "DUENO")
            return
        client = self.client_key(request)
        now = time.monotonic()
        recent = [stamp for stamp in self.failures[client] if now - stamp < FAILURE_WINDOW]
        self.failures[client] = recent
        if len(recent) >= MAX_FAILURES:
            raise HTTPException(status_code=429, detail="Demasiados intentos con clave incorrecta. Espera unos minutos.")
        actor = self.resolve(x_admin_pin)
        if actor is None:
            self.failures[client].append(now)
            raise HTTPException(status_code=401, detail="PIN incorrecto")
        path, method = request.url.path, request.method
        if path.startswith("/api/users") and actor.role != "DUENO":
            raise HTTPException(status_code=403, detail="Solo el dueño puede gestionar usuarios")
        if actor.role == "ENCARGADO" and (method == "DELETE" or (path.startswith(OWNER_ONLY_PATHS) and method != "GET")):
            raise HTTPException(status_code=403, detail="Esta acción es solo para el administrador")
        if actor.role == "CAJERO" and (method == "DELETE" or not path.startswith(CASHIER_PATHS)):
            raise HTTPException(status_code=403, detail="Tu perfil de cajero no tiene acceso a esta sección")
        request.state.actor = actor
        if path == "/api/admin/verify":
            self.touch_login(actor)
        elif method != "GET":
            self.log(actor, method, path)

    def touch_login(self, actor: Actor) -> None:
        if actor.user_id is None:
            return
        with self.session_factory() as session:
            user = session.get(AppUser, actor.user_id)
            if user is not None:
                user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
                session.commit()

    def log(self, actor: Actor, method: str, path: str) -> None:
        with self.session_factory() as session:
            session.add(ActionLog(user_name=actor.name, role=actor.role, method=method, path=path[:160], created_at=datetime.now(timezone.utc).replace(tzinfo=None)))
            if session.scalar(select(func.count(ActionLog.id))) > 3000:
                oldest = session.scalars(select(ActionLog.id).order_by(ActionLog.id).limit(1000)).all()
                session.execute(delete(ActionLog).where(ActionLog.id.in_(oldest)))
            session.commit()


class UserInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    role: Literal["DUENO", "ENCARGADO", "CAJERO"]
    pin: str | None = Field(default=None, max_length=8)
    active: bool = True


def describe(method: str, path: str) -> str:
    label = next((text for prefix, text in ACTION_LABELS if path.startswith(prefix)), "el sistema")
    return f"{VERBS.get(method, method)} {label}"


def register_user_routes(app: FastAPI, get_db: Callable[..., Any], auth: Auth) -> None:
    owner = [Depends(auth.require_admin)]

    def serialize(user: AppUser) -> dict[str, Any]:
        return {"id": user.id, "name": user.name, "role": user.role, "roleLabel": ROLE_LABELS[user.role], "active": user.is_active,
                "lastLogin": user.last_login_at.isoformat() + "Z" if user.last_login_at else None}

    def check_pin(pin: str | None, except_id: int | None, required: bool) -> None:
        if pin is None or pin == "":
            if required:
                raise HTTPException(status_code=422, detail="Indica una clave de 4 a 8 números")
            return
        if not pin.isdigit() or not 4 <= len(pin) <= 8:
            raise HTTPException(status_code=422, detail="La clave debe tener de 4 a 8 números")
        if auth.pin_in_use(pin, except_id):
            raise HTTPException(status_code=409, detail="Esa clave ya la usa otra persona. Elige otra.")

    @app.get("/api/users", dependencies=owner)
    def list_users(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        return [serialize(user) for user in session.scalars(select(AppUser).order_by(AppUser.name))]

    @app.post("/api/users", status_code=201, dependencies=owner)
    def create_user(data: UserInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        check_pin(data.pin, None, True)
        user = AppUser(name=data.name.strip(), role=data.role, pin_hash=hash_pin(data.pin or ""), is_active=data.active,
                       created_at=datetime.now(timezone.utc).replace(tzinfo=None))
        session.add(user)
        session.commit()
        auth.forget()
        return serialize(user)

    @app.put("/api/users/{user_id}", dependencies=owner)
    def update_user(user_id: int, data: UserInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        user = session.get(AppUser, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        check_pin(data.pin, user_id, False)
        user.name, user.role, user.is_active = data.name.strip(), data.role, data.active
        if data.pin:
            user.pin_hash = hash_pin(data.pin)
        session.commit()
        auth.forget()
        return serialize(user)

    @app.delete("/api/users/{user_id}", dependencies=owner)
    def delete_user(user_id: int, session: Session = Depends(get_db)) -> dict[str, bool]:
        user = session.get(AppUser, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        session.delete(user)
        session.commit()
        auth.forget()
        return {"ok": True}

    @app.get("/api/users/activity", dependencies=owner)
    def activity(limit: int = 100, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        rows = session.scalars(select(ActionLog).order_by(ActionLog.id.desc()).limit(min(max(limit, 1), 500)))
        return [{"id": row.id, "user": row.user_name, "role": ROLE_LABELS.get(row.role, row.role), "action": describe(row.method, row.path),
                 "path": row.path, "createdAt": row.created_at.isoformat() + "Z"} for row in rows]
