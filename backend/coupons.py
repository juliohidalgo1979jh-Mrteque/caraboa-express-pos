"""Códigos promocionales de un solo uso por persona (redes sociales) y canje de premios de fidelidad (FID-…)."""

import re
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import Customer, LoyaltyReward, PromoCode, PromoRedemption

CENT = Decimal("0.01")
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,19}$")


class CouponError(HTTPException):
    """Código que no se puede aplicar. `reason` permite al portal traducir el motivo."""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(status_code=422, detail=detail)
        self.reason = reason


def now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def digits_only(value: str) -> str:
    return "".join(ch for ch in str(value) if ch.isdigit())


def normalize_code(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def evaluate_code(session: Session, raw_code: str, phone: str, subtotal: Decimal) -> dict[str, Any]:
    """Comprueba un código para esa persona y devuelve el descuento. No lo consume."""
    code = normalize_code(raw_code)
    if not code:
        raise CouponError("EMPTY", "Escribe el código")
    digits = digits_only(phone)
    if len(digits) < 8:
        raise CouponError("PHONE", "Escribe primero el WhatsApp del cliente: cada persona puede usar un código una sola vez")
    phone_key = digits[-9:]

    if code.startswith("FID-"):
        reward = session.scalar(select(LoyaltyReward).where(LoyaltyReward.code == code))
        customer = session.get(Customer, reward.customer_id) if reward else None
        if reward is None or customer is None or customer.phone_key != phone_key:
            raise CouponError("INVALID", "Este código no existe o pertenece a otro cliente")
        if reward.status != "DISPONIBLE":
            raise CouponError("USED", "Este premio ya fue utilizado")
        if reward.kind == "DESCUENTO":
            percent = reward.percent or Decimal("0")
            discount = (subtotal * percent / 100).quantize(CENT, rounding=ROUND_HALF_UP)
            label = f"Premio de fidelidad {percent.normalize():f}%"
            gift = ""
        else:
            discount = Decimal("0")
            gift = reward.gift_name
            label = f"Premio de fidelidad: {gift}" if gift else "Premio de fidelidad"
        return {"type": "REWARD", "code": code, "label": label, "discount": min(discount, subtotal), "gift": gift,
                "codeId": None, "rewardId": reward.id, "customerId": customer.id, "phoneKey": phone_key}

    promo = session.scalar(select(PromoCode).where(PromoCode.code == code))
    if promo is None or not promo.is_active:
        raise CouponError("INVALID", "Este código no existe o ya no está activo")
    if promo.valid_until and promo.valid_until < now_naive().date():
        raise CouponError("EXPIRED", "Este código ya venció")
    if subtotal < promo.min_total:
        raise CouponError("MIN", f"Este código se usa en compras desde R$ {promo.min_total:.2f}".replace(".", ","))
    if promo.max_uses > 0:
        used = session.scalar(select(func.count(PromoRedemption.id)).where(PromoRedemption.code_id == promo.id)) or 0
        if used >= promo.max_uses:
            raise CouponError("EXHAUSTED", "Este código ya alcanzó su cantidad máxima de usos")
    already = session.scalar(select(PromoRedemption.id).where(PromoRedemption.code_id == promo.id, PromoRedemption.phone_key == phone_key))
    if already is not None:
        raise CouponError("USED", "Ya usaste este código: se puede una sola vez por persona")
    if promo.kind == "PERCENT":
        discount = (subtotal * promo.value / 100).quantize(CENT, rounding=ROUND_HALF_UP)
    else:
        discount = promo.value.quantize(CENT)
    customer = session.scalar(select(Customer).where(Customer.phone_key == phone_key))
    return {"type": "PROMO", "code": promo.code, "label": promo.label or promo.code, "discount": min(discount, subtotal), "gift": "",
            "codeId": promo.id, "rewardId": None, "customerId": customer.id if customer else None, "phoneKey": phone_key}


def redeem(session: Session, evaluation: dict[str, Any], *, order_id: int | None = None, sale_uuid: str | None = None) -> PromoRedemption:
    """Registra el uso (y marca el premio de fidelidad como usado). Lanza 409 si otra compra se adelantó."""
    when = now_naive()
    redemption = PromoRedemption(
        code_id=evaluation["codeId"], reward_id=evaluation["rewardId"], phone_key=evaluation["phoneKey"], customer_id=evaluation["customerId"],
        order_id=order_id, sale_uuid=sale_uuid, amount=evaluation["discount"], created_at=when,
    )
    try:
        with session.begin_nested():
            session.add(redemption)
            session.flush()
    except IntegrityError as error:
        raise CouponError("USED", "Ya usaste este código: se puede una sola vez por persona") from error
    if evaluation["rewardId"] is not None:
        reward = session.get(LoyaltyReward, evaluation["rewardId"])
        if reward is None or reward.status != "DISPONIBLE":
            raise CouponError("USED", "Este premio ya fue utilizado")
        reward.status = "USADO"
        reward.used_at = when
    return redemption


def release_order(session: Session, order_id: int) -> None:
    """Un pedido cancelado devuelve el código: la persona puede volver a usarlo."""
    for redemption in list(session.scalars(select(PromoRedemption).where(PromoRedemption.order_id == order_id))):
        if redemption.reward_id is not None:
            reward = session.get(LoyaltyReward, redemption.reward_id)
            if reward is not None:
                reward.status = "DISPONIBLE"
                reward.used_at = None
        session.delete(redemption)


class CodeInput(BaseModel):
    code: str = Field(min_length=3, max_length=20)
    label: str = Field(default="", max_length=80)
    kind: Literal["PERCENT", "AMOUNT"]
    value: float = Field(gt=0, le=10000)
    minTotal: float = Field(default=0, ge=0, le=100000)
    maxUses: int = Field(default=0, ge=0, le=100000)
    validUntil: date | None = None
    isActive: bool = True


class ValidateInput(BaseModel):
    code: str = Field(max_length=30)
    phone: str = Field(default="", max_length=30)
    subtotal: float = Field(ge=0, le=1000000)


def serialize_code(session: Session, promo: PromoCode) -> dict[str, Any]:
    used = session.scalar(select(func.count(PromoRedemption.id)).where(PromoRedemption.code_id == promo.id)) or 0
    return {
        "id": promo.id, "code": promo.code, "label": promo.label, "kind": promo.kind, "value": float(promo.value), "minTotal": float(promo.min_total),
        "maxUses": promo.max_uses, "validUntil": promo.valid_until.isoformat() if promo.valid_until else None, "isActive": promo.is_active,
        "uses": used, "createdAt": promo.created_at.isoformat(),
    }


def register_coupon_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    def clean(data: CodeInput) -> tuple[str, Decimal]:
        code = normalize_code(data.code)
        if not CODE_RE.match(code) or code.startswith("FID-"):
            raise HTTPException(status_code=422, detail="El código lleva 3 a 20 letras o números (sin espacios) y no puede empezar con FID-")
        value = Decimal(str(data.value)).quantize(CENT)
        if data.kind == "PERCENT" and value > 100:
            raise HTTPException(status_code=422, detail="El porcentaje no puede pasar de 100")
        return code, value

    @app.get("/api/promo-codes", dependencies=[Depends(require_admin)])
    def list_codes(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        codes = list(session.scalars(select(PromoCode).order_by(PromoCode.is_active.desc(), PromoCode.id.desc())))
        return [serialize_code(session, promo) for promo in codes]

    @app.post("/api/promo-codes", status_code=201, dependencies=[Depends(require_admin)])
    def create_code(data: CodeInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        code, value = clean(data)
        if session.scalar(select(PromoCode.id).where(PromoCode.code == code)) is not None:
            raise HTTPException(status_code=409, detail="Ya existe un código con ese nombre")
        promo = PromoCode(code=code, label=data.label.strip(), kind=data.kind, value=value, min_total=Decimal(str(data.minTotal)).quantize(CENT),
                          max_uses=data.maxUses, valid_until=data.validUntil, is_active=data.isActive, created_at=now_naive())
        session.add(promo)
        session.commit()
        return serialize_code(session, promo)

    @app.put("/api/promo-codes/{code_id}", dependencies=[Depends(require_admin)])
    def update_code(code_id: int, data: CodeInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        promo = session.get(PromoCode, code_id)
        if promo is None:
            raise HTTPException(status_code=404, detail="Código no encontrado")
        code, value = clean(data)
        other = session.scalar(select(PromoCode.id).where(PromoCode.code == code, PromoCode.id != promo.id))
        if other is not None:
            raise HTTPException(status_code=409, detail="Ya existe un código con ese nombre")
        uses = session.scalar(select(func.count(PromoRedemption.id)).where(PromoRedemption.code_id == promo.id)) or 0
        if uses and code != promo.code:
            raise HTTPException(status_code=409, detail="Este código ya se usó: no se puede cambiar su nombre. Desactívalo y crea otro")
        promo.code, promo.label, promo.kind, promo.value = code, data.label.strip(), data.kind, value
        promo.min_total = Decimal(str(data.minTotal)).quantize(CENT)
        promo.max_uses, promo.valid_until, promo.is_active = data.maxUses, data.validUntil, data.isActive
        session.commit()
        return serialize_code(session, promo)

    @app.delete("/api/promo-codes/{code_id}", dependencies=[Depends(require_admin)])
    def delete_code(code_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        promo = session.get(PromoCode, code_id)
        if promo is None:
            raise HTTPException(status_code=404, detail="Código no encontrado")
        uses = session.scalar(select(func.count(PromoRedemption.id)).where(PromoRedemption.code_id == promo.id)) or 0
        if uses:
            raise HTTPException(status_code=409, detail="Este código ya se usó: desactívalo en lugar de borrarlo")
        session.delete(promo)
        session.commit()
        return {"ok": True}

    @app.get("/api/promo-codes/{code_id}/uses", dependencies=[Depends(require_admin)])
    def code_uses(code_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        rows = session.execute(
            select(PromoRedemption, Customer.name).outerjoin(Customer, Customer.id == PromoRedemption.customer_id)
            .where(PromoRedemption.code_id == code_id).order_by(PromoRedemption.id.desc()).limit(200)
        ).all()
        return {"uses": [{"phone": r.phone_key, "name": name or "", "amount": float(r.amount), "createdAt": r.created_at.isoformat(),
                          "origin": "pedido online" if r.order_id else "caja"} for r, name in rows]}

    # La caja comprueba el código antes de cobrar (no lo consume: se consume al registrar la venta).
    @app.post("/api/coupons/validate", dependencies=[Depends(require_admin)])
    def validate_code(data: ValidateInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        evaluation = evaluate_code(session, data.code, data.phone, Decimal(str(data.subtotal)).quantize(CENT))
        return {"code": evaluation["code"], "label": evaluation["label"], "discount": float(evaluation["discount"]), "gift": evaluation["gift"], "type": evaluation["type"]}
