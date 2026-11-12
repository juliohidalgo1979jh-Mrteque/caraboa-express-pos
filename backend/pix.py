"""Datos de cobro por Pix del negocio: clave Pix y/o enlace de pago que se envía al cliente por WhatsApp."""

import re
from typing import Callable, Any, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Setting

KEY_TYPES = ("NONE", "CPF_CNPJ", "CELULAR", "EMAIL", "ALEATORIA")
DEFAULTS = {"keyType": "NONE", "key": "", "name": "", "city": "", "link": ""}


class PixInput(BaseModel):
    keyType: Literal["NONE", "CPF_CNPJ", "CELULAR", "EMAIL", "ALEATORIA"] = "NONE"
    key: str = Field(default="", max_length=77)
    name: str = Field(default="", max_length=25)
    city: str = Field(default="", max_length=15)
    link: str = Field(default="", max_length=200)


def read_pix(session: Session) -> dict[str, str]:
    stored = {
        s.key.removeprefix("pix."): s.value
        for s in session.scalars(select(Setting).where(Setting.key.startswith("pix.")))
    }
    return {field: stored.get(field, default) for field, default in DEFAULTS.items()}


def register_pix_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    @app.get("/api/settings/pix")
    def get_pix(session: Session = Depends(get_db)) -> dict[str, str]:
        return read_pix(session)

    @app.put("/api/settings/pix", dependencies=[Depends(require_admin)])
    def put_pix(data: PixInput, session: Session = Depends(get_db)) -> dict[str, str]:
        key = data.key.strip()
        link = data.link.strip()
        if link and not re.match(r"^https?://\S+$", link):
            raise HTTPException(status_code=422, detail="El enlace de pago debe empezar con http:// o https://")
        if data.keyType != "NONE":
            if not key:
                raise HTTPException(status_code=422, detail="Escribe la clave Pix")
            if not data.name.strip() or not data.city.strip():
                raise HTTPException(status_code=422, detail="Para generar el QR hace falta el nombre del beneficiario y la ciudad")
            digits = re.sub(r"\D", "", key)
            if data.keyType == "CPF_CNPJ" and len(digits) not in (11, 14):
                raise HTTPException(status_code=422, detail="El CPF tiene 11 dígitos y el CNPJ 14")
            if data.keyType == "CELULAR" and not 10 <= len(digits) <= 13:
                raise HTTPException(status_code=422, detail="El celular debe incluir DDD (ej. 48 98810-2993)")
            if data.keyType == "EMAIL" and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", key):
                raise HTTPException(status_code=422, detail="El correo no es válido")
        values = {"keyType": data.keyType, "key": key, "name": data.name.strip(), "city": data.city.strip(), "link": link}
        for field, value in values.items():
            session.merge(Setting(key=f"pix.{field}", value=value))
        session.commit()
        return read_pix(session)
