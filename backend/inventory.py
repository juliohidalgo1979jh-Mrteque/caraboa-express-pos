import math
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from zoneinfo import ZoneInfo

from .models import Equipment, Product, Purchase, PurchaseLine, RecipeLine, StockItem, StockLot, StockMovement, Supplier

UNITS = ("unid", "kg", "g", "l", "ml")
ACCOUNTS = ("CAJA", "BANCO", "MERCADOPAGO")
WASTE_REASONS = ("VENCIDO", "DANADO", "DERRAMADO", "PREPARACION", "OTRO")
EXPIRY_WARNING_DAYS = 7
LOCAL_TZ = ZoneInfo("America/Sao_Paulo")


def today_local() -> date:
    return datetime.now(LOCAL_TZ).date()
EQUIPMENT_STATUSES = ("OPERATIVO", "EN_REPARACION", "FUERA_DE_SERVICIO")


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def stripped(value: str) -> str:
    return value.strip()


class SupplierInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    tax_id: str = Field(default="", alias="taxId", max_length=20)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=100)
    address: str = Field(default="", max_length=150)
    notes: str = Field(default="", max_length=300)
    active: bool = True

    _strip = field_validator("name", "tax_id", "phone", "email", "address", "notes")(stripped)


class StockItemInput(BaseModel):
    kind: Literal["PRODUCTO", "INSUMO"]
    name: str = Field(min_length=1, max_length=100)
    unit: Literal[UNITS]  # type: ignore[valid-type]
    min_stock: Decimal = Field(default=Decimal("0"), alias="minStock", ge=0, max_digits=12, decimal_places=3)
    unit_cost: Decimal = Field(default=Decimal("0"), alias="unitCost", ge=0, max_digits=12, decimal_places=4)
    supplier_id: int | None = Field(default=None, alias="supplierId")
    initial_stock: Decimal | None = Field(default=None, alias="initialStock", ge=0, max_digits=12, decimal_places=3)
    active: bool = True

    _strip = field_validator("name")(stripped)


class MovementInput(BaseModel):
    item_id: int = Field(alias="itemId")
    kind: Literal["COMPRA", "AJUSTE"]
    # COMPRA: cantidad que entra. AJUSTE: stock contado (el sistema calcula la diferencia).
    quantity: Decimal = Field(ge=0, max_digits=12, decimal_places=3)
    unit_cost: Decimal | None = Field(default=None, alias="unitCost", ge=0, max_digits=12, decimal_places=4)
    supplier_id: int | None = Field(default=None, alias="supplierId")
    note: str = Field(default="", max_length=200)


class PurchaseLineInput(BaseModel):
    item_id: int = Field(alias="itemId")
    quantity: Decimal = Field(gt=0, max_digits=12, decimal_places=3)
    line_total: Decimal = Field(alias="lineTotal", ge=0, max_digits=12, decimal_places=2)
    expires_on: date | None = Field(default=None, alias="expiresOn")


class PurchaseInput(BaseModel):
    supplier_id: int | None = Field(default=None, alias="supplierId")
    document: str = Field(default="", max_length=60)
    account: Literal["CAJA", "BANCO", "MERCADOPAGO"] = "CAJA"
    purchased_on: date | None = Field(default=None, alias="purchasedOn")
    note: str = Field(default="", max_length=200)
    lines: list[PurchaseLineInput] = Field(min_length=1, max_length=60)


class WasteInput(BaseModel):
    item_id: int = Field(alias="itemId")
    quantity: Decimal = Field(gt=0, max_digits=12, decimal_places=3)
    reason: Literal["VENCIDO", "DANADO", "DERRAMADO", "PREPARACION", "OTRO"]
    note: str = Field(default="", max_length=200)


class RecipeLineInput(BaseModel):
    item_id: int = Field(alias="itemId")
    quantity: Decimal = Field(gt=0, max_digits=12, decimal_places=3)


class RecipeInput(BaseModel):
    lines: list[RecipeLineInput]
    margin: Decimal | None = Field(default=None, ge=0, le=10000, max_digits=6, decimal_places=2)


class EquipmentInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(default="", max_length=50)
    brand: str = Field(default="", max_length=60)
    model: str = Field(default="", max_length=60)
    serial_number: str = Field(default="", alias="serialNumber", max_length=60)
    location: str = Field(default="", max_length=60)
    status: Literal[EQUIPMENT_STATUSES] = "OPERATIVO"  # type: ignore[valid-type]
    purchase_date: date | None = Field(default=None, alias="purchaseDate")
    value: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    notes: str = Field(default="", max_length=300)

    _strip = field_validator("name", "category", "brand", "model", "serial_number", "location", "notes")(stripped)


def serialize_supplier(supplier: Supplier, item_count: int = 0) -> dict[str, Any]:
    return {
        "id": supplier.id, "name": supplier.name, "taxId": supplier.tax_id, "phone": supplier.phone,
        "email": supplier.email, "address": supplier.address, "notes": supplier.notes, "active": supplier.is_active,
        "itemCount": item_count,
    }


def expiry_status(next_expiry: date | None) -> str | None:
    if next_expiry is None:
        return None
    days = (next_expiry - today_local()).days
    return "VENCIDO" if days < 0 else "POR_VENCER" if days <= EXPIRY_WARNING_DAYS else "OK"


def serialize_item(item: StockItem, supplier_name: str | None = None, used_in: list[str] | None = None,
                   next_expiry: date | None = None) -> dict[str, Any]:
    return {
        "nextExpiry": next_expiry.isoformat() if next_expiry else None,
        "expiryStatus": expiry_status(next_expiry),
        "id": item.id, "kind": item.kind, "name": item.name, "unit": item.unit,
        "stock": float(item.stock), "minStock": float(item.min_stock), "unitCost": float(item.unit_cost),
        "supplierId": item.supplier_id, "supplierName": supplier_name, "active": item.is_active,
        "low": item.min_stock > 0 and item.stock <= item.min_stock,
        "usedIn": used_in or [],
    }


def serialize_equipment(equipment: Equipment) -> dict[str, Any]:
    return {
        "id": equipment.id, "name": equipment.name, "category": equipment.category, "brand": equipment.brand,
        "model": equipment.model, "serialNumber": equipment.serial_number, "location": equipment.location,
        "status": equipment.status, "purchaseDate": equipment.purchase_date.isoformat() if equipment.purchase_date else None,
        "value": float(equipment.value) if equipment.value is not None else None, "notes": equipment.notes,
    }


def suggested_price(cost: Decimal, margin: Decimal | None) -> float | None:
    """Costo + % de ganancia, redondeado hacia arriba a los $10."""
    if margin is None or cost <= 0:
        return None
    return float(math.ceil(cost * (1 + margin / 100) / 10) * 10)


def recipe_summary(session: Session, product: Product) -> dict[str, Any]:
    rows = session.execute(
        select(RecipeLine, StockItem).join(StockItem, RecipeLine.item_id == StockItem.id)
        .where(RecipeLine.product_id == product.id).order_by(StockItem.kind.desc(), StockItem.name)
    ).all()
    lines = []
    cost = Decimal("0")
    for line, item in rows:
        line_cost = line.quantity * item.unit_cost
        cost += line_cost
        lines.append({
            "itemId": item.id, "name": item.name, "kind": item.kind, "unit": item.unit,
            "quantity": float(line.quantity), "unitCost": float(item.unit_cost), "lineCost": money(line_cost),
        })
    price = product.price
    return {
        "productId": product.id, "lines": lines, "cost": money(cost), "price": float(price),
        "margin": float(product.margin) if product.margin is not None else None,
        "suggestedPrice": suggested_price(cost, product.margin),
        "profit": money(price - cost) if lines else None,
        "profitPercent": round(float((price - cost) / cost * 100), 1) if lines and cost > 0 else None,
    }


def consume_lots(session: Session, item_id: int, quantity: Decimal) -> None:
    """Descuenta de los lotes con vencimiento, primero el que vence antes."""
    remaining = quantity
    for lot in session.scalars(select(StockLot).where(StockLot.item_id == item_id, StockLot.quantity > 0)
                               .order_by(StockLot.expires_on, StockLot.id)):
        if remaining <= 0:
            break
        take = min(lot.quantity, remaining)
        lot.quantity -= take
        remaining -= take


def deduct_stock_for_sale(session: Session, sale_id: int, items: list[tuple[int, int]], when: datetime) -> None:
    """Descuenta del inventario lo que lleva cada producto vendido según su receta (el stock puede quedar negativo)."""
    for product_id, quantity in items:
        for line, item in session.execute(
            select(RecipeLine, StockItem).join(StockItem, RecipeLine.item_id == StockItem.id).where(RecipeLine.product_id == product_id)
        ).all():
            used = line.quantity * quantity
            item.stock -= used
            consume_lots(session, item.id, used)
            session.add(StockMovement(
                item_id=item.id, kind="VENTA", quantity=-used, unit_cost=item.unit_cost, sale_id=sale_id, created_at=when,
            ))


def register_inventory_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    admin = [Depends(require_admin)]

    def get_or_404(session: Session, model: Any, object_id: int, label: str) -> Any:
        instance = session.get(model, object_id)
        if instance is None or getattr(instance, "is_deleted", False):
            raise HTTPException(status_code=404, detail=f"{label} no encontrado")
        return instance

    def get_menu_product(session: Session, product_id: int) -> Product:
        product = session.get(Product, product_id)
        if product is None or product.is_deleted:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        return product

    def check_supplier(session: Session, supplier_id: int | None) -> None:
        if supplier_id is not None:
            get_or_404(session, Supplier, supplier_id, "Proveedor")

    # --- Proveedores ---
    @app.get("/api/suppliers", dependencies=admin)
    def list_suppliers(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        counts = dict(session.execute(
            select(StockItem.supplier_id, func.count()).where(StockItem.is_deleted.is_(False)).group_by(StockItem.supplier_id)
        ).all())
        suppliers = session.scalars(select(Supplier).where(Supplier.is_deleted.is_(False)).order_by(Supplier.name))
        return [serialize_supplier(s, counts.get(s.id, 0)) for s in suppliers]

    @app.post("/api/suppliers", status_code=201, dependencies=admin)
    def create_supplier(data: SupplierInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        supplier = Supplier(name=data.name, tax_id=data.tax_id, phone=data.phone, email=data.email,
                            address=data.address, notes=data.notes, is_active=data.active)
        session.add(supplier)
        session.commit()
        return serialize_supplier(supplier)

    @app.put("/api/suppliers/{supplier_id}", dependencies=admin)
    def update_supplier(supplier_id: int, data: SupplierInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        supplier = get_or_404(session, Supplier, supplier_id, "Proveedor")
        supplier.name, supplier.tax_id, supplier.phone = data.name, data.tax_id, data.phone
        supplier.email, supplier.address, supplier.notes, supplier.is_active = data.email, data.address, data.notes, data.active
        session.commit()
        return serialize_supplier(supplier)

    @app.delete("/api/suppliers/{supplier_id}", dependencies=admin)
    def delete_supplier(supplier_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        supplier = get_or_404(session, Supplier, supplier_id, "Proveedor")
        supplier.is_deleted = True
        supplier.is_active = False
        # Los artículos que lo tenían como proveedor habitual quedan sin proveedor; las compras pasadas lo conservan.
        updated = session.execute(update(StockItem).where(StockItem.supplier_id == supplier.id).values(supplier_id=None)).rowcount
        session.commit()
        return {"ok": True, "itemsUpdated": updated}

    # --- Artículos (productos e insumos) ---
    def recipes_using(session: Session, item_id: int | None = None) -> dict[int, list[str]]:
        query = (select(RecipeLine.item_id, Product.name).join(Product, RecipeLine.product_id == Product.id)
                 .where(Product.is_deleted.is_(False)).order_by(Product.name))
        if item_id is not None:
            query = query.where(RecipeLine.item_id == item_id)
        used: dict[int, list[str]] = {}
        for line_item_id, product_name in session.execute(query).all():
            used.setdefault(line_item_id, []).append(product_name)
        return used

    def next_expiries(session: Session) -> dict[int, date]:
        return {item_id: expires for item_id, expires in session.execute(
            select(StockLot.item_id, func.min(StockLot.expires_on)).where(StockLot.quantity > 0).group_by(StockLot.item_id)
        ).all()}

    def item_with_supplier(session: Session, item: StockItem) -> dict[str, Any]:
        supplier = session.get(Supplier, item.supplier_id) if item.supplier_id else None
        return serialize_item(item, supplier.name if supplier else None, recipes_using(session, item.id).get(item.id),
                              next_expiries(session).get(item.id))

    @app.get("/api/stock-items", dependencies=admin)
    def list_items(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        rows = session.execute(
            select(StockItem, Supplier.name).outerjoin(Supplier, StockItem.supplier_id == Supplier.id)
            .where(StockItem.is_deleted.is_(False)).order_by(StockItem.name)
        ).all()
        used = recipes_using(session)
        expiries = next_expiries(session)
        return [serialize_item(item, supplier_name, used.get(item.id), expiries.get(item.id)) for item, supplier_name in rows]

    @app.post("/api/stock-items", status_code=201, dependencies=admin)
    def create_item(data: StockItemInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        check_supplier(session, data.supplier_id)
        item = StockItem(kind=data.kind, name=data.name, unit=data.unit, min_stock=data.min_stock,
                         unit_cost=data.unit_cost, supplier_id=data.supplier_id, is_active=data.active,
                         stock=data.initial_stock or Decimal("0"))
        session.add(item)
        session.flush()
        if data.initial_stock:
            session.add(StockMovement(item_id=item.id, kind="AJUSTE", quantity=data.initial_stock,
                                      unit_cost=data.unit_cost, note="Stock inicial", created_at=now_utc()))
        session.commit()
        return item_with_supplier(session, item)

    @app.put("/api/stock-items/{item_id}", dependencies=admin)
    def update_item(item_id: int, data: StockItemInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        item = get_or_404(session, StockItem, item_id, "Artículo")
        check_supplier(session, data.supplier_id)
        # El stock solo cambia con compras, ajustes y ventas, para que quede registrado.
        item.kind, item.name, item.unit = data.kind, data.name, data.unit
        item.min_stock, item.unit_cost, item.supplier_id, item.is_active = data.min_stock, data.unit_cost, data.supplier_id, data.active
        session.commit()
        return item_with_supplier(session, item)

    @app.delete("/api/stock-items/{item_id}", dependencies=admin)
    def delete_item(item_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        item = get_or_404(session, StockItem, item_id, "Artículo")
        removed_from = recipes_using(session, item.id).get(item.id, [])
        # Se quita de las recetas para que las próximas ventas no lo descuenten; sus movimientos quedan en el historial.
        session.execute(delete(RecipeLine).where(RecipeLine.item_id == item.id))
        item.is_deleted = True
        item.is_active = False
        session.commit()
        return {"ok": True, "removedFromRecipes": removed_from}

    # --- Movimientos: compras y ajustes (las ventas se registran solas) ---
    @app.get("/api/stock-movements", dependencies=admin)
    def list_movements(item_id: int | None = None, limit: int = 200, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        query = (select(StockMovement, StockItem.name, StockItem.unit, Supplier.name)
                 .join(StockItem, StockMovement.item_id == StockItem.id)
                 .outerjoin(Supplier, StockMovement.supplier_id == Supplier.id)
                 .order_by(StockMovement.id.desc()).limit(min(max(limit, 1), 1000)))
        if item_id is not None:
            query = query.where(StockMovement.item_id == item_id)
        return [{
            "id": m.id, "itemId": m.item_id, "itemName": item_name, "unit": unit, "kind": m.kind,
            "quantity": float(m.quantity), "unitCost": float(m.unit_cost) if m.unit_cost is not None else None,
            "supplierName": supplier_name, "saleId": m.sale_id, "purchaseId": m.purchase_id, "reason": m.reason, "note": m.note, "createdAt": m.created_at.isoformat() + "Z",
        } for m, item_name, unit, supplier_name in session.execute(query).all()]

    @app.post("/api/stock-movements", status_code=201, dependencies=admin)
    def create_movement(data: MovementInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        item = get_or_404(session, StockItem, data.item_id, "Artículo")
        check_supplier(session, data.supplier_id)
        if data.kind == "COMPRA":
            if data.quantity <= 0:
                raise HTTPException(status_code=422, detail="La cantidad comprada debe ser mayor a cero")
            change = data.quantity
            if data.unit_cost is not None:
                item.unit_cost = data.unit_cost  # El costo pasa a ser el de la última compra.
            if data.supplier_id is not None:
                item.supplier_id = data.supplier_id
        else:
            change = data.quantity - item.stock
            if change < 0:
                consume_lots(session, item.id, -change)
        item.stock += change
        session.add(StockMovement(
            item_id=item.id, kind=data.kind, quantity=change,
            unit_cost=data.unit_cost if data.kind == "COMPRA" else item.unit_cost,
            supplier_id=data.supplier_id if data.kind == "COMPRA" else None,
            note=data.note.strip(), created_at=now_utc(),
        ))
        session.commit()
        return item_with_supplier(session, item)

    # --- Compras con varios artículos ---
    def serialize_purchase(session: Session, purchase: Purchase) -> dict[str, Any]:
        supplier = session.get(Supplier, purchase.supplier_id) if purchase.supplier_id else None
        lines = session.execute(
            select(PurchaseLine, StockItem.name, StockItem.unit).join(StockItem, PurchaseLine.item_id == StockItem.id)
            .where(PurchaseLine.purchase_id == purchase.id).order_by(PurchaseLine.id)
        ).all()
        return {
            "id": purchase.id, "supplierId": purchase.supplier_id, "supplierName": supplier.name if supplier else None,
            "document": purchase.document, "account": purchase.account, "purchasedOn": purchase.purchased_on.isoformat(),
            "total": money(purchase.total), "note": purchase.note,
            "lines": [{
                "itemId": line.item_id, "itemName": name, "unit": unit, "quantity": float(line.quantity),
                "unitCost": float(line.unit_cost), "lineTotal": money(line.line_total),
                "expiresOn": line.expires_on.isoformat() if line.expires_on else None,
            } for line, name, unit in lines],
        }

    @app.get("/api/purchases", dependencies=admin)
    def list_purchases(limit: int = 100, session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        rows = session.scalars(select(Purchase).order_by(Purchase.purchased_on.desc(), Purchase.id.desc()).limit(min(max(limit, 1), 500)))
        return [serialize_purchase(session, purchase) for purchase in rows]

    @app.post("/api/purchases", status_code=201, dependencies=admin)
    def create_purchase(data: PurchaseInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        check_supplier(session, data.supplier_id)
        today = today_local()
        when = now_utc()
        purchase = Purchase(supplier_id=data.supplier_id, document=data.document.strip(), account=data.account,
                            purchased_on=data.purchased_on or today, total=Decimal("0"), note=data.note.strip(), created_at=when)
        session.add(purchase)
        session.flush()
        total = Decimal("0")
        for line in data.lines:
            item = get_or_404(session, StockItem, line.item_id, "Artículo")
            unit_cost = (line.line_total / line.quantity).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            row = PurchaseLine(purchase_id=purchase.id, item_id=item.id, quantity=line.quantity, unit_cost=unit_cost,
                               line_total=line.line_total, expires_on=line.expires_on)
            session.add(row)
            session.flush()
            item.stock += line.quantity
            item.unit_cost = unit_cost  # El costo pasa a ser el de la última compra.
            if data.supplier_id is not None:
                item.supplier_id = data.supplier_id
            if line.expires_on:
                session.add(StockLot(item_id=item.id, purchase_line_id=row.id, quantity=line.quantity, expires_on=line.expires_on))
            session.add(StockMovement(item_id=item.id, kind="COMPRA", quantity=line.quantity, unit_cost=unit_cost,
                                      supplier_id=data.supplier_id, purchase_id=purchase.id,
                                      note=data.document.strip()[:200], created_at=when))
            total += line.line_total
        purchase.total = total
        session.commit()
        return serialize_purchase(session, purchase)

    # --- Mermas: productos dañados, vencidos o perdidos ---
    @app.post("/api/stock-waste", status_code=201, dependencies=admin)
    def create_waste(data: WasteInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        item = get_or_404(session, StockItem, data.item_id, "Artículo")
        item.stock -= data.quantity
        consume_lots(session, item.id, data.quantity)
        session.add(StockMovement(item_id=item.id, kind="MERMA", quantity=-data.quantity, unit_cost=item.unit_cost,
                                  reason=data.reason, note=data.note.strip(), created_at=now_utc()))
        session.commit()
        return item_with_supplier(session, item)

    # --- Recetas y costos de la carta ---
    @app.get("/api/menu-costs", dependencies=admin)
    def menu_costs(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        products = session.scalars(select(Product).where(Product.is_deleted.is_(False)).order_by(Product.id))
        return [recipe_summary(session, product) for product in products]

    @app.get("/api/products/{product_id}/recipe", dependencies=admin)
    def get_recipe(product_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        return recipe_summary(session, get_menu_product(session, product_id))

    @app.put("/api/products/{product_id}/recipe", dependencies=admin)
    def update_recipe(product_id: int, data: RecipeInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        product = get_menu_product(session, product_id)
        item_ids = [line.item_id for line in data.lines]
        if len(set(item_ids)) != len(item_ids):
            raise HTTPException(status_code=422, detail="Un artículo aparece dos veces en la receta")
        for item_id in item_ids:
            get_or_404(session, StockItem, item_id, "Artículo")
        session.execute(delete(RecipeLine).where(RecipeLine.product_id == product.id))
        session.add_all(RecipeLine(product_id=product.id, item_id=line.item_id, quantity=line.quantity) for line in data.lines)
        product.margin = data.margin
        session.commit()
        return recipe_summary(session, product)

    # --- Equipos ---
    @app.get("/api/equipment", dependencies=admin)
    def list_equipment(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        return [serialize_equipment(e) for e in session.scalars(select(Equipment).order_by(Equipment.name))]

    def apply_equipment(equipment: Equipment, data: EquipmentInput) -> None:
        equipment.name, equipment.category, equipment.brand, equipment.model = data.name, data.category, data.brand, data.model
        equipment.serial_number, equipment.location, equipment.status = data.serial_number, data.location, data.status
        equipment.purchase_date, equipment.value, equipment.notes = data.purchase_date, data.value, data.notes

    @app.post("/api/equipment", status_code=201, dependencies=admin)
    def create_equipment(data: EquipmentInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        equipment = Equipment()
        apply_equipment(equipment, data)
        session.add(equipment)
        session.commit()
        return serialize_equipment(equipment)

    @app.put("/api/equipment/{equipment_id}", dependencies=admin)
    def update_equipment(equipment_id: int, data: EquipmentInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        equipment = get_or_404(session, Equipment, equipment_id, "Equipo")
        apply_equipment(equipment, data)
        session.commit()
        return serialize_equipment(equipment)
