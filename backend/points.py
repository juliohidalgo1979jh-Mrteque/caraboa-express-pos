import string
from datetime import date
from typing import Any, Callable

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import PointOfSale, Sale

PAYMENT_METHODS = ("EFECTIVO", "TARJETA", "QR", "TRANSFERENCIA", "MERCADO_PAGO")

# Todos los medios habilitados desde el inicio; cada negocio los ajusta en "Puntos de venta".
DEFAULT_POINTS = [
    {"name": "Laptop principal", "code": "A", "methods": list(PAYMENT_METHODS)},
    {"name": "Celular 1", "code": "B", "methods": list(PAYMENT_METHODS)},
]


class PointInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    # Letra con la que empiezan los números de pedido de este punto (A-001, B-001…). Vacía = la próxima libre.
    code: str = Field(default="", max_length=3)
    methods: list[str] = Field(min_length=1)
    active: bool = True

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("El nombre es obligatorio")
        return value.strip()

    @field_validator("code")
    @classmethod
    def valid_code(cls, value: str) -> str:
        value = value.strip().upper()
        if value and not value.isalnum():
            raise ValueError("La letra del punto solo puede tener letras o números")
        return value

    @field_validator("methods")
    @classmethod
    def known_methods(cls, value: list[str]) -> list[str]:
        if any(method not in PAYMENT_METHODS for method in value):
            raise ValueError("Medio de pago no válido")
        # Conserva el orden canónico y quita repetidos.
        return [method for method in PAYMENT_METHODS if method in value]


def serialize_point(point: PointOfSale) -> dict[str, Any]:
    return {"id": point.id, "name": point.name, "code": point.code or "", "methods": point.methods.split(","), "active": point.is_active}


CODE_CANDIDATES = list(string.ascii_uppercase) + [a + b for a in string.ascii_uppercase for b in string.ascii_uppercase]


def next_free_code(session: Session) -> str:
    used = {code for code in session.scalars(select(PointOfSale.code)) if code}
    return next((code for code in CODE_CANDIDATES if code not in used), "")


def seed_points(session: Session) -> None:
    if session.scalar(select(PointOfSale.id).limit(1)) is None:
        session.add_all(
            PointOfSale(name=item["name"], code=item["code"], methods=",".join(item["methods"])) for item in DEFAULT_POINTS
        )
        session.commit()
    # Puntos creados antes de que existieran las letras: se les asigna una en orden de creación.
    for point in session.scalars(select(PointOfSale).where((PointOfSale.code.is_(None)) | (PointOfSale.code == "")).order_by(PointOfSale.id)):
        point.code = next_free_code(session)
        session.flush()
    session.commit()


def register_point_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None], day_bounds: Callable[[date], tuple[Any, Any]]) -> None:
    def ensure_unique(session: Session, data: PointInput, point_id: int | None = None) -> None:
        clash = session.scalar(select(PointOfSale).where(PointOfSale.name == data.name))
        if clash is not None and clash.id != point_id:
            raise HTTPException(status_code=409, detail="Ya existe un punto de venta con ese nombre")
        clash = session.scalar(select(PointOfSale).where(PointOfSale.code == data.code)) if data.code else None
        if clash is not None and clash.id != point_id:
            raise HTTPException(status_code=409, detail=f"La letra {data.code} ya la usa {clash.name}")

    @app.get("/api/points")
    def list_points(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        return [serialize_point(point) for point in session.scalars(select(PointOfSale).order_by(PointOfSale.id))]

    @app.post("/api/points", status_code=201, dependencies=[Depends(require_admin)])
    def create_point(data: PointInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        ensure_unique(session, data)
        point = PointOfSale(name=data.name, code=data.code or next_free_code(session), methods=",".join(data.methods), is_active=data.active)
        session.add(point)
        session.commit()
        return serialize_point(point)

    @app.put("/api/points/{point_id}", dependencies=[Depends(require_admin)])
    def update_point(point_id: int, data: PointInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        point = session.get(PointOfSale, point_id)
        if point is None:
            raise HTTPException(status_code=404, detail="Punto de venta no encontrado")
        ensure_unique(session, data, point_id)
        point.name = data.name
        point.code = data.code or point.code or next_free_code(session)
        point.methods = ",".join(data.methods)
        point.is_active = data.active
        session.commit()
        return serialize_point(point)

    @app.get("/api/order-numbers")
    def last_order_numbers(day: str = Query(alias="date"), session: Session = Depends(get_db)) -> dict[str, int]:
        """Último número de pedido de cada punto en un día (hora de Argentina), para que un dispositivo que perdió sus datos no repita."""
        try:
            start, end = day_bounds(date.fromisoformat(day))
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Fecha no válida (usa AAAA-MM-DD)") from error
        rows = session.execute(
            select(Sale.point_id, func.max(Sale.order_number))
            .where(Sale.created_at >= start, Sale.created_at < end, Sale.point_id.is_not(None), Sale.order_number.is_not(None))
            .group_by(Sale.point_id)
        ).all()
        return {str(point_id): number for point_id, number in rows}

