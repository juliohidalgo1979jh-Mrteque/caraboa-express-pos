"""Copia de seguridad: descarga de todos los datos del negocio en un solo archivo (solo el dueño)."""

import base64
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable

from fastapi import Depends, FastAPI
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .inventory import now_utc
from .models import Base

# Se excluyen las claves de los usuarios: la copia no debe llevar secretos.
SKIP_TABLES = {"usuarios_app"}


def jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"_base64": base64.b64encode(bytes(value)).decode()}
    return value


def register_backup_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    @app.get("/api/backup", dependencies=[Depends(require_admin)])
    def backup(session: Session = Depends(get_db)) -> Response:
        tables: dict[str, list[dict[str, Any]]] = {}
        for table in Base.metadata.sorted_tables:
            if table.name in SKIP_TABLES:
                continue
            rows = session.execute(select(table)).mappings().all()
            tables[table.name] = [{key: jsonable(value) for key, value in row.items()} for row in rows]
        stamp = now_utc()
        payload = {"app": "caraboa-express-pos", "version": 1, "createdAt": stamp.isoformat() + "Z",
                   "counts": {name: len(rows) for name, rows in tables.items()}, "tables": tables}
        name = f"copia-caraboa-{stamp.strftime('%Y-%m-%d_%H%M')}.json"
        return Response(json.dumps(payload, ensure_ascii=False).encode(), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})
