"""Clientes (por WhatsApp), historial, preferencias y programa de fidelidad: cada N compras, un premio."""

import json
import secrets
import string
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from .models import Customer, LoyaltyReward, Sale, SaleDetail, Setting

CONFIG_KEY = "fidelidad"
DEFAULT_CONFIG = {"on": False, "every": 5, "kind": "DESCUENTO", "percent": 10, "giftId": None, "giftName": "", "min": 0}
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def digits_only(value: str) -> str:
    return "".join(ch for ch in str(value) if ch.isdigit())


def read_config(session: Session) -> dict[str, Any]:
    setting = session.get(Setting, CONFIG_KEY)
    config = dict(DEFAULT_CONFIG)
    if setting:
        try:
            config.update(json.loads(setting.value))
        except ValueError:
            pass
    return config


def find_or_create_customer(session: Session, phone: str, name: str = "", lang: str | None = None) -> Customer | None:
    """Devuelve el cliente de ese WhatsApp (lo crea si no existe). Sin teléfono válido no hay cliente."""
    digits = digits_only(phone)
    if len(digits) < 8:
        return None
    customer = session.scalar(select(Customer).where(Customer.phone_key == digits[-9:]))
    if customer is None:
        customer = Customer(name=name.strip()[:80], phone=digits[:20], phone_key=digits[-9:], lang=lang or "pt", created_at=now_naive())
        session.add(customer)
        session.flush()
    else:
        if name.strip() and not customer.name:
            customer.name = name.strip()[:80]
        if lang in ("es", "pt", "en"):
            customer.lang = lang
    return customer


def new_code(session: Session) -> str:
    while True:
        code = "FID-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        if session.scalar(select(LoyaltyReward.id).where(LoyaltyReward.code == code)) is None:
            return code


def credit_purchase(session: Session, customer: Customer, amount: Decimal, when: datetime) -> LoyaltyReward | None:
    """Suma una compra al cliente y, si completa el ciclo del programa, le genera el premio."""
    customer.orders_count += 1
    customer.total_spent += amount
    customer.last_order_at = when
    config = read_config(session)
    if not config["on"] or amount < Decimal(str(config["min"] or 0)):
        return None
    customer.progress += 1
    if customer.progress < int(config["every"]):
        return None
    customer.progress = 0
    customer.rewards_total += 1
    reward = LoyaltyReward(
        customer_id=customer.id, kind=config["kind"], code=new_code(session), created_at=now_naive(),
        percent=Decimal(str(config["percent"])) if config["kind"] == "DESCUENTO" else None,
        gift_name=str(config["giftName"])[:100] if config["kind"] == "REGALO" else "",
    )
    session.add(reward)
    session.flush()
    return reward


def serialize_reward(reward: LoyaltyReward) -> dict[str, Any]:
    return {"id": reward.id, "kind": reward.kind, "percent": float(reward.percent) if reward.percent is not None else None,
            "giftName": reward.gift_name, "code": reward.code, "status": reward.status,
            "createdAt": reward.created_at.isoformat() + "Z", "usedAt": reward.used_at.isoformat() + "Z" if reward.used_at else None}


class CustomerInput(BaseModel):
    name: str = Field(default="", max_length=80)
    phone: str = Field(min_length=8, max_length=25)
    preferences: str = Field(default="", max_length=300)


class CustomerUpdate(BaseModel):
    name: str = Field(default="", max_length=80)
    preferences: str = Field(default="", max_length=300)


class LoyaltyConfigInput(BaseModel):
    on: bool = False
    every: int = Field(default=5, ge=2, le=50)
    kind: Literal["DESCUENTO", "REGALO"] = "DESCUENTO"
    percent: Decimal = Field(default=Decimal("10"), gt=0, le=100, max_digits=5, decimal_places=2)
    giftId: int | None = None
    giftName: str = Field(default="", max_length=60)
    min: Decimal = Field(default=Decimal("0"), ge=0, max_digits=10, decimal_places=2)


def register_customer_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    admin = [Depends(require_admin)]

    def serialize(customer: Customer, available: int, every: int) -> dict[str, Any]:
        return {
            "id": customer.id, "name": customer.name, "phone": customer.phone, "lang": customer.lang, "preferences": customer.preferences,
            "orders": customer.orders_count, "totalSpent": float(customer.total_spent), "progress": customer.progress, "every": every,
            "rewardsTotal": customer.rewards_total, "rewardsAvailable": available,
            "lastOrderAt": customer.last_order_at.isoformat() + "Z" if customer.last_order_at else None,
        }

    def available_by_customer(session: Session) -> dict[int, int]:
        rows = session.execute(select(LoyaltyReward.customer_id, func.count(LoyaltyReward.id)).where(LoyaltyReward.status == "DISPONIBLE").group_by(LoyaltyReward.customer_id)).all()
        return {customer_id: count for customer_id, count in rows}

    @app.get("/api/customers", dependencies=admin)
    def list_customers(q: str = Query(default="", max_length=40), session: Session = Depends(get_db)) -> dict[str, Any]:
        every = int(read_config(session)["every"])
        query = select(Customer).order_by(Customer.last_order_at.desc().nullslast(), Customer.id.desc()).limit(500)
        if q.strip():
            term = f"%{q.strip()}%"
            query = query.where(or_(Customer.name.ilike(term), Customer.phone.like(f"%{digits_only(q)}%" if digits_only(q) else "%\u0000%")))
        available = available_by_customer(session)
        customers = list(session.scalars(query))
        return {"customers": [serialize(c, available.get(c.id, 0), every) for c in customers],
                "total": session.scalar(select(func.count(Customer.id))) or 0, "withReward": len(available)}

    @app.get("/api/customers/lookup", dependencies=admin)
    def lookup(phone: str = Query(max_length=25), session: Session = Depends(get_db)) -> dict[str, Any] | None:
        digits = digits_only(phone)
        if len(digits) < 8:
            return None
        customer = session.scalar(select(Customer).where(Customer.phone_key == digits[-9:]))
        if customer is None:
            return None
        available = session.scalars(select(LoyaltyReward).where(LoyaltyReward.customer_id == customer.id, LoyaltyReward.status == "DISPONIBLE")).all()
        return {**serialize(customer, len(available), int(read_config(session)["every"])), "rewards": [serialize_reward(r) for r in available]}

    @app.post("/api/customers", status_code=201, dependencies=admin)
    def create_customer(data: CustomerInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        customer = find_or_create_customer(session, data.phone, data.name)
        if customer is None:
            raise HTTPException(status_code=422, detail="Escribe un WhatsApp válido, con código de área")
        customer.preferences = data.preferences.strip()
        session.commit()
        return serialize(customer, 0, int(read_config(session)["every"]))

    @app.get("/api/customers/{customer_id}", dependencies=admin)
    def customer_detail(customer_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        customer = session.get(Customer, customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        rewards = session.scalars(select(LoyaltyReward).where(LoyaltyReward.customer_id == customer_id).order_by(LoyaltyReward.id.desc())).all()
        top = session.execute(
            select(SaleDetail.product_name, func.sum(SaleDetail.quantity).label("qty")).join(Sale, Sale.id == SaleDetail.sale_id)
            .where(Sale.customer_id == customer_id).group_by(SaleDetail.product_name).order_by(func.sum(SaleDetail.quantity).desc()).limit(5)
        ).all()
        sales = session.scalars(select(Sale).where(Sale.customer_id == customer_id).order_by(Sale.id.desc()).limit(10)).all()
        config = read_config(session)
        return {
            **serialize(customer, sum(1 for r in rewards if r.status == "DISPONIBLE"), int(config["every"])),
            "loyaltyOn": bool(config["on"]),
            "rewards": [serialize_reward(r) for r in rewards],
            "topProducts": [{"name": name, "quantity": int(qty)} for name, qty in top],
            "recent": [{"id": s.id, "createdAt": s.created_at.isoformat() + "Z", "total": float(s.total), "paymentMethod": s.payment_method, "orderCode": s.order_code} for s in sales],
        }

    @app.put("/api/customers/{customer_id}", dependencies=admin)
    def update_customer(customer_id: int, data: CustomerUpdate, session: Session = Depends(get_db)) -> dict[str, Any]:
        customer = session.get(Customer, customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        customer.name, customer.preferences = data.name.strip(), data.preferences.strip()
        session.commit()
        return serialize(customer, 0, int(read_config(session)["every"]))

    @app.delete("/api/customers/{customer_id}", dependencies=admin)
    def delete_customer(customer_id: int, session: Session = Depends(get_db)) -> dict[str, bool]:
        customer = session.get(Customer, customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="Cliente no encontrado")
        for reward in session.scalars(select(LoyaltyReward).where(LoyaltyReward.customer_id == customer_id)):
            session.delete(reward)
        session.execute(update(Sale).where(Sale.customer_id == customer_id).values(customer_id=None))
        session.delete(customer)
        session.commit()
        return {"ok": True}

    @app.get("/api/loyalty/config", dependencies=admin)
    def get_config(session: Session = Depends(get_db)) -> dict[str, Any]:
        return read_config(session)

    @app.put("/api/loyalty/config", dependencies=admin)
    def put_config(data: LoyaltyConfigInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        if data.on and data.kind == "REGALO" and not data.giftName.strip():
            raise HTTPException(status_code=422, detail="Elige el producto de regalo")
        config = {"on": data.on, "every": data.every, "kind": data.kind, "percent": float(data.percent), "giftId": data.giftId,
                  "giftName": data.giftName.strip(), "min": float(data.min)}
        session.merge(Setting(key=CONFIG_KEY, value=json.dumps(config, separators=(",", ":"), ensure_ascii=False)))
        session.commit()
        return config

    @app.post("/api/loyalty/rewards/{reward_id}/use", dependencies=admin)
    def use_reward(reward_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        reward = session.get(LoyaltyReward, reward_id)
        if reward is None:
            raise HTTPException(status_code=404, detail="Premio no encontrado")
        if reward.status != "DISPONIBLE":
            raise HTTPException(status_code=409, detail="Este premio ya fue usado")
        reward.status, reward.used_at = "USADO", now_naive()
        session.commit()
        return serialize_reward(reward)
