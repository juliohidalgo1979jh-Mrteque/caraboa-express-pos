from datetime import datetime, timezone
from html import escape
from typing import Any, Callable

from fastapi import Depends, FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .models import PointOfSale, Sale, SaleDetail
from .reports import METHOD_LABELS, ars, to_local


class ClaimInput(BaseModel):
    after_id: int = Field(alias="afterId", ge=0)


def sale_details(session: Session, sale_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    details: dict[int, list[dict[str, Any]]] = {sale_id: [] for sale_id in sale_ids}
    if sale_ids:
        for sale_id, name, quantity, unit_price, subtotal in session.execute(
            select(SaleDetail.sale_id, SaleDetail.product_name, SaleDetail.quantity, SaleDetail.unit_price, SaleDetail.subtotal)
            .where(SaleDetail.sale_id.in_(sale_ids)).order_by(SaleDetail.id)
        ):
            details[sale_id].append({"name": name, "quantity": quantity, "unitPrice": float(unit_price), "subtotal": float(subtotal)})
    return details


def serialize_comandas(session: Session, sales: list[Sale]) -> list[dict[str, Any]]:
    point_names = {point.id: point.name for point in session.scalars(select(PointOfSale))}
    details = sale_details(session, [sale.id for sale in sales])
    return [{
        "id": sale.id,
        "orderCode": sale.order_code or f"#{sale.id}",
        "point": point_names.get(sale.point_id, "Sin punto"),
        "time": to_local(sale.created_at).strftime("%H:%M"),
        "paymentMethod": METHOD_LABELS.get(sale.payment_method, sale.payment_method),
        "total": float(sale.total),
        "items": details[sale.id],
        "printedAt": to_local(sale.kitchen_printed_at).strftime("%H:%M") if sale.kitchen_printed_at else None,
    } for sale in sales]


TICKET_STYLE = """
body { margin: 0; background: #f4f2eb; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #20231f; }
main { max-width: 360px; margin: 24px auto; padding: 22px 20px; background: #fffefa; border: 1px solid #e5e3dc; border-radius: 8px; }
h1 { margin: 0; font-size: 20px; text-align: center; } .muted { color: #8d8e86; font-size: 12px; text-align: center; }
.order { margin: 14px 0 4px; text-align: center; } .order small { display: block; color: #8d8e86; font-size: 10px; letter-spacing: 1px; }
.order strong { font-size: 34px; } hr { border: 0; border-top: 1px dashed #d9d7cf; margin: 14px 0; }
.row { display: flex; justify-content: space-between; gap: 12px; margin: 6px 0; font-size: 14px; }
.total { font-size: 20px; font-weight: 700; } .thanks { margin-top: 16px; text-align: center; font-weight: 600; }
"""


def ticket_page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
        f"<title>{escape(title)}</title><style>{TICKET_STYLE}</style></head><body><main>{body}</main></body></html>",
        headers={"Cache-Control": "no-store"},
    )


def register_kitchen_routes(app: FastAPI, get_db: Callable[..., Any]) -> None:
    @app.get("/api/comandas/last-id")
    def last_sale_id(session: Session = Depends(get_db)) -> dict[str, int]:
        """La estación arranca desde acá: solo imprime los pedidos que lleguen después de activarla."""
        return {"lastId": session.scalar(select(func.coalesce(func.max(Sale.id), 0))) or 0}

    @app.post("/api/comandas/claim")
    def claim_comandas(data: ClaimInput, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        """Entrega los pedidos nuevos sin imprimir y los marca, de a uno, para que dos estaciones nunca impriman el mismo."""
        candidates = session.scalars(
            select(Sale.id).where(Sale.id > data.after_id, Sale.kitchen_printed_at.is_(None)).order_by(Sale.id).limit(50)
        ).all()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        claimed = [
            sale_id for sale_id in candidates
            if session.execute(update(Sale).where(Sale.id == sale_id, Sale.kitchen_printed_at.is_(None)).values(kitchen_printed_at=now)).rowcount == 1
        ]
        session.commit()
        sales = list(session.scalars(select(Sale).where(Sale.id.in_(claimed)).order_by(Sale.id))) if claimed else []
        return serialize_comandas(session, sales)

    @app.get("/api/comandas/recent")
    def recent_comandas(limit: int = 30, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        sales = list(session.scalars(select(Sale).order_by(Sale.id.desc()).limit(min(max(limit, 1), 100))))
        return serialize_comandas(session, sales)

    @app.get("/ticket/{sale_uuid}")
    def public_ticket(sale_uuid: str, session: Session = Depends(get_db)) -> HTMLResponse:
        sale = session.scalar(select(Sale).where(Sale.uuid_local == sale_uuid)) if len(sale_uuid) <= 36 else None
        if sale is None:
            # El celular puede haber cobrado sin conexión: el ticket aparece cuando sincroniza.
            return ticket_page("Ticket no disponible", "<h1>Tequeños Club</h1><p class='muted'>Tu ticket todavía no está disponible. "
                               "Vuelve a abrir este enlace en unos minutos.</p>")
        point = session.get(PointOfSale, sale.point_id) if sale.point_id else None
        rows = "".join(
            f"<div class='row'><span>{item['quantity']} × {escape(item['name'])}</span><strong>{ars(item['subtotal'])}</strong></div>"
            for item in sale_details(session, [sale.id])[sale.id]
        )
        order = f"<div class='order'><small>PEDIDO</small><strong>{escape(sale.order_code)}</strong></div>" if sale.order_code else ""
        tip = f"<div class='row'><span>Propina</span><span>{ars(sale.tip)}</span></div>" if sale.tip else ""
        body = (
            f"<h1>Tequeños Club</h1><p class='muted'>{to_local(sale.created_at).strftime('%d/%m/%Y %H:%M')}"
            f"{' · ' + escape(point.name) if point else ''}</p>{order}<hr>{rows}<hr>"
            f"<div class='row'><span>Subtotal</span><span>{ars(sale.subtotal)}</span></div>{tip}"
            f"<div class='row total'><span>Total</span><span>{ars(sale.total)}</span></div>"
            f"<p class='muted'>Pago: {escape(METHOD_LABELS.get(sale.payment_method, sale.payment_method))}</p>"
            "<p class='thanks'>¡Gracias por comer rico!</p><p class='muted'>Documento no válido como factura.</p>"
        )
        return ticket_page(f"Ticket {sale.order_code or ''} · Tequeños Club", body)
