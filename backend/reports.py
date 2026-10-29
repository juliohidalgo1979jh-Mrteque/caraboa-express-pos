from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any, Callable
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Response
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import PointOfSale, Sale, SaleDetail, Shift, StockMovement

LOCAL_TZ = ZoneInfo("America/Sao_Paulo")
METHOD_LABELS = {"EFECTIVO": "Efectivo", "TARJETA": "Tarjeta", "QR": "Pix / QR", "TRANSFERENCIA": "Transferencia", "MERCADO_PAGO": "Mercado Pago"}
MONTHS = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre")
WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
ZERO = Decimal("0")


def ars(amount: Decimal | float) -> str:
    """R$ 1.234,56"""
    value = Decimal(amount)
    text = f"{abs(value):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return f"-R$ {text}" if value < 0 else f"R$ {text}"


def to_local(value: datetime) -> datetime:
    # Las fechas se guardan en UTC sin zona horaria.
    return value.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)


def local_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, LOCAL_TZ).astimezone(timezone.utc).replace(tzinfo=None)
    end = datetime.combine(day + timedelta(days=1), time.min, LOCAL_TZ).astimezone(timezone.utc).replace(tzinfo=None)
    return start, end


def long_date(day: date) -> str:
    return f"{WEEKDAYS[day.weekday()]} {day.day} de {MONTHS[day.month - 1]} de {day.year}"


def build_report(session: Session, sales: list[Sale], shifts: list[Shift]) -> dict[str, Any]:
    point_names = {point.id: point.name for point in session.scalars(select(PointOfSale))}
    sale_ids = [sale.id for sale in sales]

    by_point: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "total": ZERO})
    by_method: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "total": ZERO})
    cash_by_shift: dict[int, Decimal] = defaultdict(lambda: ZERO)
    total_by_shift: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for sale in sales:
        point = point_names.get(sale.point_id, "Sin punto")
        method = METHOD_LABELS.get(sale.payment_method, sale.payment_method)
        for bucket in (by_point[point], by_method[method]):
            bucket["count"] += 1
            bucket["total"] += sale.total
        total_by_shift[sale.shift_id] += sale.total
        if sale.payment_method == "EFECTIVO":
            cash_by_shift[sale.shift_id] += sale.total

    products: dict[str, dict[str, Any]] = defaultdict(lambda: {"quantity": 0, "total": ZERO})
    cost = ZERO
    if sale_ids:
        for name, quantity, subtotal in session.execute(
            select(SaleDetail.product_name, SaleDetail.quantity, SaleDetail.subtotal).where(SaleDetail.sale_id.in_(sale_ids))
        ):
            products[name]["quantity"] += quantity
            products[name]["total"] += subtotal
        # Costo de lo vendido con el costo de cada artículo al momento de la venta.
        cost = -(session.scalar(
            select(func.coalesce(func.sum(StockMovement.quantity * StockMovement.unit_cost), 0))
            .where(StockMovement.sale_id.in_(sale_ids), StockMovement.kind == "VENTA")
        ) or ZERO)

    total = sum((sale.total for sale in sales), ZERO)
    tips = sum((sale.tip for sale in sales), ZERO)
    shift_rows = []
    for shift in sorted(shifts, key=lambda item: item.opened_at):
        expected = shift.opening_cash + cash_by_shift[shift.id]
        shift_rows.append({
            "id": shift.id,
            "point": point_names.get(shift.point_id, "Sin punto"),
            "openedAt": to_local(shift.opened_at).strftime("%H:%M"),
            "closedAt": to_local(shift.closed_at).strftime("%H:%M") if shift.closed_at else None,
            "openingCash": float(shift.opening_cash),
            "cashSales": float(cash_by_shift[shift.id]),
            "expectedCash": float(expected),
            "closingCash": float(shift.closing_cash) if shift.closing_cash is not None else None,
            "difference": float(shift.closing_cash - expected) if shift.closing_cash is not None else None,
            "total": float(total_by_shift[shift.id]),
        })

    def rows(buckets: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(({"name": name, "count": value["count"], "total": float(value["total"])} for name, value in buckets.items()),
                      key=lambda row: -row["total"])

    return {
        "salesCount": len(sales),
        "total": float(total),
        "tips": float(tips),
        "averageTicket": float(total / len(sales)) if sales else 0.0,
        "cost": float(cost),
        "grossProfit": float(total - tips - cost) if cost else None,
        "byPoint": rows(by_point),
        "byMethod": rows(by_method),
        "products": sorted(({"name": name, "quantity": value["quantity"], "total": float(value["total"])} for name, value in products.items()),
                           key=lambda row: (-row["quantity"], row["name"])),
        "shifts": shift_rows,
        "sales": [{
            "order": sale.order_code or "—",
            "time": to_local(sale.created_at).strftime("%H:%M"),
            "point": point_names.get(sale.point_id, "Sin punto"),
            "method": METHOD_LABELS.get(sale.payment_method, sale.payment_method),
            "total": float(sale.total),
        } for sale in sorted(sales, key=lambda item: item.created_at)],
    }


def render_pdf(title: str, subtitle: str, report: dict[str, Any]) -> bytes:
    buffer = BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                                 title=title, author="Caraboa Express")
    styles = getSampleStyleSheet()
    orange = colors.HexColor("#df5b35")
    h1 = ParagraphStyle("h1", parent=styles["Title"], alignment=0, fontSize=18, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, textColor=orange, spaceBefore=10, spaceAfter=4)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#6b6d66"))
    right = ParagraphStyle("right", parent=small, alignment=TA_RIGHT)

    def table(header: list[str] | None, body: list[list[str]], widths: list[float], align_right_from: int = 1) -> Table:
        columns = len(widths)
        data = ([header] if header else []) + (body or [["Sin datos"] + [""] * (columns - 1)])
        first = 1 if header else 0
        result = Table(data, colWidths=[w * mm for w in widths], repeatRows=first)
        result.setStyle(TableStyle([
            *([("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
               ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#6b6d66")),
               ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#d9d7cf"))] if header else []),
            ("FONT", (0, first), (-1, -1), "Helvetica", 9),
            ("LINEBELOW", (0, first), (-1, -1), 0.3, colors.HexColor("#ecebe5")),
            ("ALIGN", (align_right_from, 0), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        return result

    story: list[Any] = [
        Paragraph("Caraboa Express", ParagraphStyle("brand", parent=small, textColor=orange, fontName="Helvetica-Bold")),
        Paragraph(title, h1), Paragraph(subtitle, small),
        Paragraph(f"Generado el {datetime.now(LOCAL_TZ).strftime('%d/%m/%Y %H:%M')} · Incluye las ventas ya sincronizadas con el servidor.", small),
        Spacer(1, 6 * mm),
    ]
    summary = [
        ["Ventas", str(report["salesCount"])],
        ["Total vendido", ars(report["total"])],
        ["Propinas (incluidas en el total)", ars(report["tips"])],
        ["Ticket promedio", ars(report["averageTicket"])],
    ]
    if report["grossProfit"] is not None:
        summary += [["Costo de mercadería (según recetas)", ars(report["cost"])], ["Ganancia bruta (sin propinas)", ars(report["grossProfit"])]]
    story += [Paragraph("Resumen", h2), table(None, summary, [120, 58])]

    story += [Paragraph("Por punto de venta", h2), table(["PUNTO", "VENTAS", "TOTAL"], [[r["name"], str(r["count"]), ars(r["total"])] for r in report["byPoint"]], [100, 30, 48])]
    story += [Paragraph("Por medio de pago", h2), table(["MEDIO", "VENTAS", "TOTAL"], [[r["name"], str(r["count"]), ars(r["total"])] for r in report["byMethod"]], [100, 30, 48])]

    def optional(value: float | None) -> str:
        return ars(value) if value is not None else "—"

    story += [Paragraph("Turnos y arqueo de caja", h2), table(
        ["PUNTO", "HORARIO", "INICIAL", "EFECTIVO", "ESPERADO", "CONTADO", "DIF.", "VENDIDO"],
        [[s["point"], f"{s['openedAt']}–{s['closedAt'] or 'abierto'}", ars(s["openingCash"]), ars(s["cashSales"]), ars(s["expectedCash"]),
          optional(s["closingCash"]), optional(s["difference"]), ars(s["total"])] for s in report["shifts"]],
        [30, 22, 21, 21, 21, 21, 19, 23], align_right_from=2)]
    story += [Paragraph("Productos vendidos", h2), table(["PRODUCTO", "CANTIDAD", "TOTAL"], [[r["name"], str(r["quantity"]), ars(r["total"])] for r in report["products"]], [100, 30, 48])]
    story += [Paragraph("Detalle de ventas", h2), table(["PEDIDO", "HORA", "PUNTO", "MEDIO DE PAGO", "TOTAL"], [[s["order"], s["time"], s["point"], s["method"], ars(s["total"])] for s in report["sales"]], [22, 16, 52, 46, 42], align_right_from=4)]
    story += [Spacer(1, 4 * mm), Paragraph("Documento interno, no válido como factura.", right)]
    document.build(story)
    return buffer.getvalue()


def register_report_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    admin = [Depends(require_admin)]

    def parse_day(value: str | None) -> date:
        if not value:
            return datetime.now(LOCAL_TZ).date()
        try:
            return date.fromisoformat(value)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Fecha no válida (usa AAAA-MM-DD)") from error

    def daily(session: Session, day: date, point_id: int | None) -> dict[str, Any]:
        start, end = local_day_bounds(day)
        sales_query = select(Sale).where(Sale.created_at >= start, Sale.created_at < end)
        shifts_query = select(Shift).where(Shift.opened_at >= start, Shift.opened_at < end)
        if point_id is not None:
            sales_query = sales_query.where(Sale.point_id == point_id)
            shifts_query = shifts_query.where(Shift.point_id == point_id)
        return build_report(session, list(session.scalars(sales_query)), list(session.scalars(shifts_query)))

    def point_label(session: Session, point_id: int | None) -> str:
        if point_id is None:
            return "Todos los puntos de venta"
        point = session.get(PointOfSale, point_id)
        if point is None:
            raise HTTPException(status_code=404, detail="Punto de venta no encontrado")
        return f"Punto de venta: {point.name}"

    def pdf_response(content: bytes, filename: str) -> Response:
        return Response(content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @app.get("/api/reports/daily", dependencies=admin)
    def daily_summary(date: str | None = None, point_id: int | None = None, session: Session = Depends(get_db)) -> dict[str, Any]:
        day = parse_day(date)
        point_label(session, point_id)
        return {"date": day.isoformat(), **daily(session, day, point_id)}

    @app.get("/api/reports/daily.pdf", dependencies=admin)
    def daily_pdf(date: str | None = None, point_id: int | None = None, session: Session = Depends(get_db)) -> Response:
        day = parse_day(date)
        subtitle = f"{long_date(day).capitalize()} · {point_label(session, point_id)}"
        content = render_pdf("Reporte de ventas del día", subtitle, daily(session, day, point_id))
        return pdf_response(content, f"ventas-{day.isoformat()}{f'-punto-{point_id}' if point_id else ''}.pdf")

    @app.get("/api/reports/shift/{shift_id}.pdf", dependencies=admin)
    def shift_pdf(shift_id: int, session: Session = Depends(get_db)) -> Response:
        shift = session.get(Shift, shift_id)
        if shift is None:
            raise HTTPException(status_code=404, detail="Turno no encontrado")
        report = build_report(session, list(session.scalars(select(Sale).where(Sale.shift_id == shift.id))), [shift])
        opened = to_local(shift.opened_at)
        closed = f"cerrado {to_local(shift.closed_at).strftime('%d/%m %H:%M')}" if shift.closed_at else "abierto"
        point = session.get(PointOfSale, shift.point_id) if shift.point_id else None
        subtitle = f"{point.name if point else 'Sin punto'} · abierto {opened.strftime('%d/%m/%Y %H:%M')} · {closed}"
        return pdf_response(render_pdf(f"Reporte del turno #{shift.id}", subtitle, report), f"turno-{shift.id}-{opened.date().isoformat()}.pdf")
