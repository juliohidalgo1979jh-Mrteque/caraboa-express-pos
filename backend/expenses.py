"""Gastos fijos y variables del local y pago al personal por día u hora."""

import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .inventory import now_utc, today_local
from .models import Expense, Purchase, Worker, WorkerPayment

Account = Literal["CAJA", "BANCO", "MERCADOPAGO"]


class ExpenseInput(BaseModel):
    kind: Literal["FIJO", "VARIABLE"]
    category: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=120)
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    paid_on: date | None = Field(default=None, alias="paidOn")
    account: Account = "CAJA"

    _strip = field_validator("category", "description")(lambda value: value.strip())


class WorkerInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    pay_type: Literal["DIA", "HORA"] = Field(alias="payType")
    rate: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    phone: str = Field(default="", max_length=40)
    active: bool = True

    _strip = field_validator("name", "phone")(lambda value: value.strip())


class WorkInput(BaseModel):
    worker_id: int = Field(alias="workerId")
    worked_on: date | None = Field(default=None, alias="workedOn")
    units: Decimal = Field(gt=0, le=744, max_digits=6, decimal_places=2)
    rate: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    paid: bool = False
    account: Account = "CAJA"
    note: str = Field(default="", max_length=200)


class PayInput(BaseModel):
    account: Account = "CAJA"
    paid_on: date | None = Field(default=None, alias="paidOn")


def month_range(month: str | None) -> tuple[date, date]:
    """Primer día del mes (incluido) y del siguiente (excluido); sin dato = el mes actual."""
    if month:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
            raise HTTPException(status_code=422, detail="El mes debe ser AAAA-MM")
        year, number = int(month[:4]), int(month[5:])
    else:
        today = today_local()
        year, number = today.year, today.month
    start = date(year, number, 1)
    return start, date(year + (number == 12), number % 12 + 1, 1)


def money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def register_expense_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    admin = [Depends(require_admin)]

    def serialize_expense(expense: Expense) -> dict[str, Any]:
        return {"id": expense.id, "kind": expense.kind, "category": expense.category, "description": expense.description,
                "amount": money(expense.amount), "paidOn": expense.paid_on.isoformat(), "account": expense.account}

    def serialize_worker(worker: Worker) -> dict[str, Any]:
        return {"id": worker.id, "name": worker.name, "payType": worker.pay_type, "rate": money(worker.rate),
                "phone": worker.phone, "active": worker.is_active}

    def serialize_payment(payment: WorkerPayment, worker: Worker) -> dict[str, Any]:
        return {"id": payment.id, "workerId": worker.id, "workerName": worker.name, "payType": worker.pay_type,
                "workedOn": payment.worked_on.isoformat(), "units": float(payment.units), "rate": money(payment.rate),
                "amount": money(payment.amount), "paidOn": payment.paid_on.isoformat() if payment.paid_on else None,
                "account": payment.account, "note": payment.note, "pending": payment.paid_on is None}

    def get_worker(session: Session, worker_id: int) -> Worker:
        worker = session.get(Worker, worker_id)
        if worker is None or worker.is_deleted:
            raise HTTPException(status_code=404, detail="Persona no encontrada")
        return worker

    # --- Gastos ---
    @app.get("/api/expenses", dependencies=admin)
    def list_expenses(month: str | None = None, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        start, end = month_range(month)
        rows = session.scalars(select(Expense).where(Expense.is_deleted.is_(False), Expense.paid_on >= start, Expense.paid_on < end)
                               .order_by(Expense.paid_on.desc(), Expense.id.desc()))
        return [serialize_expense(expense) for expense in rows]

    @app.post("/api/expenses", status_code=201, dependencies=admin)
    def create_expense(data: ExpenseInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        expense = Expense(kind=data.kind, category=data.category, description=data.description, amount=data.amount,
                          paid_on=data.paid_on or today_local(), account=data.account, created_at=now_utc())
        session.add(expense)
        session.commit()
        return serialize_expense(expense)

    @app.delete("/api/expenses/{expense_id}", dependencies=admin)
    def delete_expense(expense_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        expense = session.get(Expense, expense_id)
        if expense is None or expense.is_deleted:
            raise HTTPException(status_code=404, detail="Gasto no encontrado")
        expense.is_deleted = True
        session.commit()
        return {"ok": True}

    # --- Personal ---
    @app.get("/api/workers", dependencies=admin)
    def list_workers(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        return [serialize_worker(worker) for worker in session.scalars(select(Worker).where(Worker.is_deleted.is_(False)).order_by(Worker.name))]

    @app.post("/api/workers", status_code=201, dependencies=admin)
    def create_worker(data: WorkerInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        worker = Worker(name=data.name, pay_type=data.pay_type, rate=data.rate, phone=data.phone, is_active=data.active)
        session.add(worker)
        session.commit()
        return serialize_worker(worker)

    @app.put("/api/workers/{worker_id}", dependencies=admin)
    def update_worker(worker_id: int, data: WorkerInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        worker = get_worker(session, worker_id)
        worker.name, worker.pay_type, worker.rate, worker.phone, worker.is_active = data.name, data.pay_type, data.rate, data.phone, data.active
        session.commit()
        return serialize_worker(worker)

    @app.delete("/api/workers/{worker_id}", dependencies=admin)
    def delete_worker(worker_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        worker = get_worker(session, worker_id)
        worker.is_deleted = True
        worker.is_active = False
        session.commit()
        return {"ok": True}

    # --- Trabajo y pagos del personal ---
    @app.get("/api/worker-payments", dependencies=admin)
    def list_payments(month: str | None = None, pending: bool = False, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        start, end = month_range(month)
        query = (select(WorkerPayment, Worker).join(Worker, WorkerPayment.worker_id == Worker.id)
                 .where(WorkerPayment.is_deleted.is_(False)).order_by(WorkerPayment.worked_on.desc(), WorkerPayment.id.desc()))
        if pending:
            query = query.where(WorkerPayment.paid_on.is_(None))
        else:
            query = query.where(WorkerPayment.worked_on >= start, WorkerPayment.worked_on < end)
        return [serialize_payment(payment, worker) for payment, worker in session.execute(query).all()]

    @app.post("/api/worker-payments", status_code=201, dependencies=admin)
    def create_payment(data: WorkInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        worker = get_worker(session, data.worker_id)
        rate = data.rate if data.rate is not None else worker.rate
        amount = (data.units * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        today = today_local()
        payment = WorkerPayment(worker_id=worker.id, worked_on=data.worked_on or today, units=data.units, rate=rate, amount=amount,
                                paid_on=today if data.paid else None, account=data.account if data.paid else None,
                                note=data.note.strip(), created_at=now_utc())
        session.add(payment)
        session.commit()
        return serialize_payment(payment, worker)

    @app.put("/api/worker-payments/{payment_id}/pay", dependencies=admin)
    def pay(payment_id: int, data: PayInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        payment = session.get(WorkerPayment, payment_id)
        if payment is None or payment.is_deleted:
            raise HTTPException(status_code=404, detail="Registro no encontrado")
        payment.paid_on, payment.account = data.paid_on or today_local(), data.account
        session.commit()
        return serialize_payment(payment, session.get(Worker, payment.worker_id))

    @app.delete("/api/worker-payments/{payment_id}", dependencies=admin)
    def delete_payment(payment_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        payment = session.get(WorkerPayment, payment_id)
        if payment is None or payment.is_deleted:
            raise HTTPException(status_code=404, detail="Registro no encontrado")
        payment.is_deleted = True
        session.commit()
        return {"ok": True}

    # --- Resumen del mes ---
    @app.get("/api/expenses/summary", dependencies=admin)
    def summary(month: str | None = None, session: Session = Depends(get_db)) -> dict[str, Any]:
        start, end = month_range(month)
        zero = Decimal("0")
        by_kind = dict(session.execute(select(Expense.kind, func.coalesce(func.sum(Expense.amount), 0))
                                       .where(Expense.is_deleted.is_(False), Expense.paid_on >= start, Expense.paid_on < end)
                                       .group_by(Expense.kind)).all())
        staff_paid = session.scalar(select(func.coalesce(func.sum(WorkerPayment.amount), 0)).where(
            WorkerPayment.is_deleted.is_(False), WorkerPayment.paid_on >= start, WorkerPayment.paid_on < end)) or zero
        staff_pending = session.scalar(select(func.coalesce(func.sum(WorkerPayment.amount), 0)).where(
            WorkerPayment.is_deleted.is_(False), WorkerPayment.paid_on.is_(None))) or zero
        purchases = session.scalar(select(func.coalesce(func.sum(Purchase.total), 0)).where(
            Purchase.purchased_on >= start, Purchase.purchased_on < end)) or zero
        fixed, variable = Decimal(by_kind.get("FIJO", zero)), Decimal(by_kind.get("VARIABLE", zero))
        return {"month": start.strftime("%Y-%m"), "fixed": money(fixed), "variable": money(variable),
                "staffPaid": money(Decimal(staff_paid)), "staffPending": money(Decimal(staff_pending)),
                "purchases": money(Decimal(purchases)),
                "total": money(fixed + variable + Decimal(staff_paid) + Decimal(purchases))}
