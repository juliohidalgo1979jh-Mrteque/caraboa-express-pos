"""Finanzas: saldo de cada cuenta (efectivo, banco/Pix, Mercado Pago), movimientos, arqueos y cierres de caja."""

import json
import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .inventory import LOCAL_TZ, now_utc, today_local
from .models import AccountAudit, AccountMovement, Expense, Purchase, PointOfSale, Sale, Setting, Shift, WorkerPayment

ACCOUNTS = ("CAJA", "BANCO", "MERCADOPAGO")
ACCOUNT_LABELS = {"CAJA": "Efectivo (caja)", "BANCO": "Banco / Pix", "MERCADOPAGO": "Mercado Pago"}
# A qué cuenta entra cada medio de cobro: la tarjeta se liquida en el banco.
SALE_ACCOUNT = {"EFECTIVO": "CAJA", "TARJETA": "BANCO", "QR": "BANCO", "TRANSFERENCIA": "BANCO", "MERCADO_PAGO": "MERCADOPAGO"}
ZERO = Decimal("0")

Account = Literal["CAJA", "BANCO", "MERCADOPAGO"]


class OpeningInput(BaseModel):
    start: date
    balances: dict[Account, Decimal]


class TransferInput(BaseModel):
    source: Account = Field(alias="from")
    target: Account = Field(alias="to")
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    moved_on: date | None = Field(default=None, alias="movedOn")
    note: str = Field(default="", max_length=200)


class FlowInput(BaseModel):
    account: Account
    kind: Literal["INGRESO", "RETIRO"]
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    moved_on: date | None = Field(default=None, alias="movedOn")
    note: str = Field(default="", max_length=200)


class AuditInput(BaseModel):
    account: Account
    counted: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    breakdown: dict[str, int] | None = None
    note: str = Field(default="", max_length=200)


def money(value: Decimal) -> float:
    return float(Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def to_utc_naive(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=LOCAL_TZ).astimezone(timezone.utc).replace(tzinfo=None)


def clean_breakdown(value: dict[str, int] | None) -> str | None:
    if not value:
        return None
    clean = {str(key): int(count) for key, count in value.items() if isinstance(count, int) and 0 < count <= 100000}
    return json.dumps(clean, separators=(",", ":"))[:600] if clean else None


def register_finance_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    admin = [Depends(require_admin)]

    def read_start(session: Session) -> date | None:
        setting = session.get(Setting, "finanzas.inicio")
        return date.fromisoformat(setting.value) if setting else None

    def balances(session: Session) -> dict[str, dict[str, Decimal]]:
        start = read_start(session)
        start_dt = to_utc_naive(start) if start else None
        result = {key: {"initial": ZERO, "sales": ZERO, "purchases": ZERO, "expenses": ZERO, "staff": ZERO, "movements": ZERO} for key in ACCOUNTS}

        sales = select(Sale.payment_method, func.coalesce(func.sum(Sale.total), 0)).group_by(Sale.payment_method)
        if start_dt:
            sales = sales.where(Sale.created_at >= start_dt)
        for method, total in session.execute(sales).all():
            result[SALE_ACCOUNT.get(method, "BANCO")]["sales"] += Decimal(total)

        def by_account(column_total: Any, account_col: Any, *conditions: Any) -> dict[str, Decimal]:
            query = select(account_col, func.coalesce(func.sum(column_total), 0)).where(*conditions).group_by(account_col)
            return {account: Decimal(total) for account, total in session.execute(query).all()}

        purchase_filters = [Purchase.purchased_on >= start] if start else []
        expense_filters = [Expense.is_deleted.is_(False)] + ([Expense.paid_on >= start] if start else [])
        staff_filters = [WorkerPayment.is_deleted.is_(False), WorkerPayment.paid_on.is_not(None)] + ([WorkerPayment.paid_on >= start] if start else [])
        for account, total in by_account(Purchase.total, Purchase.account, *purchase_filters).items():
            result.get(account, result["CAJA"])["purchases"] += total
        for account, total in by_account(Expense.amount, Expense.account, *expense_filters).items():
            result.get(account, result["CAJA"])["expenses"] += total
        for account, total in by_account(WorkerPayment.amount, WorkerPayment.account, *staff_filters).items():
            result.get(account or "CAJA", result["CAJA"])["staff"] += total

        for account, kind, total in session.execute(
            select(AccountMovement.account, AccountMovement.kind, func.coalesce(func.sum(AccountMovement.amount), 0)).group_by(AccountMovement.account, AccountMovement.kind)
        ).all():
            if account in result:
                result[account]["initial" if kind == "SALDO_INICIAL" else "movements"] += Decimal(total)
        return result

    def balance_of(parts: dict[str, Decimal]) -> Decimal:
        return parts["initial"] + parts["sales"] + parts["movements"] - parts["purchases"] - parts["expenses"] - parts["staff"]

    @app.get("/api/finance/accounts", dependencies=admin)
    def accounts(session: Session = Depends(get_db)) -> dict[str, Any]:
        start = read_start(session)
        data = balances(session)
        return {
            "start": start.isoformat() if start else None,
            "accounts": [{"key": key, "label": ACCOUNT_LABELS[key], "balance": money(balance_of(parts)),
                          **{name: money(value) for name, value in parts.items()}} for key, parts in data.items()],
            "total": money(sum((balance_of(parts) for parts in data.values()), ZERO)),
        }

    @app.put("/api/finance/opening", dependencies=admin)
    def set_opening(data: OpeningInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        session.merge(Setting(key="finanzas.inicio", value=data.start.isoformat()))
        old = session.scalars(select(AccountMovement).where(AccountMovement.kind == "SALDO_INICIAL")).all()
        for movement in old:
            session.delete(movement)
        for account in ACCOUNTS:
            session.add(AccountMovement(account=account, kind="SALDO_INICIAL", amount=data.balances.get(account, ZERO),
                                        note="Saldo inicial", moved_on=data.start, created_at=now_utc()))
        session.commit()
        return accounts(session)

    def serialize_movement(movement: AccountMovement) -> dict[str, Any]:
        return {"id": movement.id, "account": movement.account, "kind": movement.kind, "amount": money(movement.amount),
                "note": movement.note, "movedOn": movement.moved_on.isoformat(), "groupId": movement.group_id}

    @app.get("/api/finance/movements", dependencies=admin)
    def movements(limit: int = 100, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        rows = session.scalars(select(AccountMovement).where(AccountMovement.kind != "SALDO_INICIAL")
                               .order_by(AccountMovement.moved_on.desc(), AccountMovement.id.desc()).limit(min(max(limit, 1), 500)))
        return [serialize_movement(movement) for movement in rows]

    @app.post("/api/finance/transfers", status_code=201, dependencies=admin)
    def transfer(data: TransferInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        if data.source == data.target:
            raise HTTPException(status_code=422, detail="Elige dos cuentas distintas")
        day, group = data.moved_on or today_local(), str(uuid.uuid4())
        note = data.note.strip() or f"{ACCOUNT_LABELS[data.source]} → {ACCOUNT_LABELS[data.target]}"
        for account, sign in ((data.source, -1), (data.target, 1)):
            session.add(AccountMovement(account=account, kind="TRANSFERENCIA", amount=sign * data.amount, note=note,
                                        moved_on=day, group_id=group, created_at=now_utc()))
        session.commit()
        return accounts(session)

    @app.post("/api/finance/flows", status_code=201, dependencies=admin)
    def flow(data: FlowInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        session.add(AccountMovement(account=data.account, kind=data.kind, amount=data.amount if data.kind == "INGRESO" else -data.amount,
                                    note=data.note.strip(), moved_on=data.moved_on or today_local(), created_at=now_utc()))
        session.commit()
        return accounts(session)

    @app.get("/api/finance/audits", dependencies=admin)
    def list_audits(limit: int = 50, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        rows = session.scalars(select(AccountAudit).order_by(AccountAudit.id.desc()).limit(min(max(limit, 1), 200)))
        return [{"id": a.id, "account": a.account, "expected": money(a.expected), "counted": money(a.counted),
                 "difference": money(a.difference), "breakdown": json.loads(a.breakdown) if a.breakdown else None,
                 "note": a.note, "createdAt": a.created_at.isoformat() + "Z"} for a in rows]

    @app.post("/api/finance/audits", status_code=201, dependencies=admin)
    def audit(data: AuditInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        expected = balance_of(balances(session)[data.account])
        difference = data.counted - expected
        now = now_utc()
        session.add(AccountAudit(account=data.account, expected=expected, counted=data.counted, difference=difference,
                                 breakdown=clean_breakdown(data.breakdown), note=data.note.strip(), created_at=now))
        if difference != 0:
            # El saldo pasa a ser lo contado: la diferencia queda registrada como ajuste del arqueo.
            session.add(AccountMovement(account=data.account, kind="AJUSTE_ARQUEO", amount=difference,
                                        note=f"Arqueo: {'sobrante' if difference > 0 else 'faltante'}", moved_on=today_local(), created_at=now))
        session.commit()
        return {"expected": money(expected), "counted": money(data.counted), "difference": money(difference), "accounts": accounts(session)}

    # --- Cierres de caja (turnos) con el conteo por denominación ---
    @app.get("/api/finance/shifts", dependencies=admin)
    def shifts(limit: int = 30, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        rows = session.scalars(select(Shift).order_by(Shift.opened_at.desc()).limit(min(max(limit, 1), 200))).all()
        cash = dict(session.execute(select(Sale.shift_id, func.coalesce(func.sum(Sale.total), 0)).where(Sale.payment_method == "EFECTIVO").group_by(Sale.shift_id)).all())
        points = dict(session.execute(select(PointOfSale.id, PointOfSale.name)).all())
        out = []
        for shift in rows:
            expected = shift.opening_cash + Decimal(cash.get(shift.id, 0))
            out.append({
                "id": shift.id, "point": points.get(shift.point_id, "Sin punto"), "state": shift.state,
                "openedAt": shift.opened_at.isoformat() + "Z", "closedAt": shift.closed_at.isoformat() + "Z" if shift.closed_at else None,
                "openingCash": money(shift.opening_cash), "cashSales": money(Decimal(cash.get(shift.id, 0))), "expectedCash": money(expected),
                "closingCash": money(shift.closing_cash) if shift.closing_cash is not None else None,
                "difference": money(shift.closing_cash - expected) if shift.closing_cash is not None else None,
                "openingBreakdown": json.loads(shift.opening_detail) if shift.opening_detail else None,
                "closingBreakdown": json.loads(shift.closing_detail) if shift.closing_detail else None,
            })
        return out
