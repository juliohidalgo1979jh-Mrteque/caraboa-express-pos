"""Portal de pedidos para clientes: carta pública en es/pt/en, promociones y pedidos que llegan por WhatsApp."""

import re
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Category, OnlineOrder, OnlineOrderItem, Product, ProductText, Promotion, Setting
from .reports import LOCAL_TZ

LANGS = ("es", "pt", "en")
STATUSES = ("NUEVO", "CONFIRMADO", "LISTO", "ENTREGADO", "CANCELADO")
PROMO_KINDS = ("INFO", "PERCENT", "PERCENT_FIRST")
DEFAULT_NAME = "Caraboa Express"
MAX_ITEMS = 40
MAX_QUANTITY = 50
MAX_PENDING_PER_PHONE = 5  # pedidos NUEVO de un mismo teléfono en la última hora

CENT = Decimal("0.01")


class CartLine(BaseModel):
    productId: int
    quantity: int = Field(ge=1, le=MAX_QUANTITY)


class QuoteInput(BaseModel):
    phone: str = Field(default="", max_length=30)
    items: list[CartLine] = Field(max_length=MAX_ITEMS)


class OrderInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=1, max_length=30)
    fulfillment: Literal["ENTREGA", "RETIRO"]
    address: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=300)
    lang: Literal["es", "pt", "en"] = "es"
    items: list[CartLine] = Field(min_length=1, max_length=MAX_ITEMS)


class PortalSettingsInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    whatsapp: str = Field(default="", max_length=30)
    enabled: bool = True
    infoEs: str = Field(default="", max_length=200)
    infoPt: str = Field(default="", max_length=200)
    infoEn: str = Field(default="", max_length=200)


class PromotionInput(BaseModel):
    kind: Literal["INFO", "PERCENT", "PERCENT_FIRST"]
    percent: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=5, decimal_places=2)
    minTotal: Decimal = Field(default=Decimal("0"), ge=0, max_digits=10, decimal_places=2)
    validUntil: date | None = None
    active: bool = True
    titleEs: str = Field(min_length=1, max_length=80)
    titlePt: str = Field(default="", max_length=80)
    titleEn: str = Field(default="", max_length=80)
    textEs: str = Field(default="", max_length=200)
    textPt: str = Field(default="", max_length=200)
    textEn: str = Field(default="", max_length=200)


class LangText(BaseModel):
    name: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=300)


class ProductTextsInput(BaseModel):
    es: LangText = LangText()
    pt: LangText = LangText()
    en: LangText = LangText()


class StatusInput(BaseModel):
    status: Literal["NUEVO", "CONFIRMADO", "LISTO", "ENTREGADO", "CANCELADO"]


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value)


def valid_phone(value: str) -> str:
    digits = digits_only(value)
    if not 8 <= len(digits) <= 15:
        raise HTTPException(status_code=422, detail="Escribe un teléfono válido, con código de área")
    return digits


def money(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


def today_local() -> date:
    return datetime.now(LOCAL_TZ).date()


def get_setting(session: Session, key: str, default: str = "") -> str:
    setting = session.get(Setting, f"portal.{key}")
    return setting.value if setting is not None else default


def read_settings(session: Session) -> dict[str, Any]:
    return {
        "name": get_setting(session, "name", DEFAULT_NAME),
        "whatsapp": get_setting(session, "whatsapp", ""),
        "enabled": get_setting(session, "enabled", "1") == "1",
        "infoEs": get_setting(session, "info.es"),
        "infoPt": get_setting(session, "info.pt"),
        "infoEn": get_setting(session, "info.en"),
    }


def serialize_promotion(promo: Promotion) -> dict[str, Any]:
    return {
        "id": promo.id,
        "kind": promo.kind,
        "percent": float(promo.percent),
        "minTotal": float(promo.min_total),
        "validUntil": promo.valid_until.isoformat() if promo.valid_until else None,
        "active": promo.is_active,
        "titleEs": promo.title_es,
        "titlePt": promo.title_pt,
        "titleEn": promo.title_en,
        "textEs": promo.text_es,
        "textPt": promo.text_pt,
        "textEn": promo.text_en,
    }


def public_promotion(promo: Promotion) -> dict[str, Any]:
    """Textos en los tres idiomas; si falta una traducción se usa el español."""
    return {
        "id": promo.id,
        "kind": promo.kind,
        "percent": float(promo.percent),
        "minTotal": float(promo.min_total),
        "validUntil": promo.valid_until.isoformat() if promo.valid_until else None,
        "title": {"es": promo.title_es, "pt": promo.title_pt or promo.title_es, "en": promo.title_en or promo.title_es},
        "text": {"es": promo.text_es, "pt": promo.text_pt or promo.text_es, "en": promo.text_en or promo.text_es},
    }


def live_promotions(session: Session) -> list[Promotion]:
    today = today_local()
    return [
        promo
        for promo in session.scalars(select(Promotion).where(Promotion.is_active.is_(True)).order_by(Promotion.id))
        if promo.valid_until is None or promo.valid_until >= today
    ]


def is_first_order(session: Session, phone_digits: str) -> bool:
    prior = session.scalar(
        select(func.count(OnlineOrder.id)).where(OnlineOrder.phone_key == phone_digits[-9:], OnlineOrder.status != "CANCELADO")
    )
    return not prior


def price_cart(session: Session, items: list[CartLine], phone: str) -> dict[str, Any]:
    """Calcula el pedido en el servidor: los precios y descuentos nunca los decide el navegador."""
    merged: dict[int, int] = {}
    for line in items:
        merged[line.productId] = min(MAX_QUANTITY, merged.get(line.productId, 0) + line.quantity)
    if not merged:
        raise HTTPException(status_code=422, detail="El pedido está vacío")
    products = {
        product.id: product
        for product in session.scalars(select(Product).where(Product.id.in_(merged), Product.is_deleted.is_(False), Product.is_active.is_(True)))
    }
    lines = []
    subtotal = Decimal("0")
    for product_id, quantity in merged.items():
        product = products.get(product_id)
        if product is None:
            raise HTTPException(status_code=422, detail="Un producto del pedido ya no está disponible")
        line_total = (product.price * quantity).quantize(CENT)
        subtotal += line_total
        lines.append({"productId": product.id, "name": product.name, "quantity": quantity, "unitPrice": money(product.price), "subtotal": money(line_total)})

    digits = digits_only(phone)
    known_phone = len(digits) >= 8
    first = is_first_order(session, digits) if known_phone else None
    best: Promotion | None = None
    best_amount = Decimal("0")
    for promo in live_promotions(session):
        if promo.kind == "INFO" or subtotal < promo.min_total or promo.percent <= 0:
            continue
        if promo.kind == "PERCENT_FIRST" and not (known_phone and first):
            continue
        amount = (subtotal * promo.percent / 100).quantize(CENT, rounding=ROUND_HALF_UP)
        if amount > best_amount:
            best, best_amount = promo, amount
    total = subtotal - best_amount
    return {
        "lines": lines,
        "subtotal": money(subtotal),
        "discount": money(best_amount),
        "promotion": public_promotion(best) if best is not None else None,
        "total": money(total),
        "firstOrder": first,
    }


def serialize_order(order: OnlineOrder, items: list[OnlineOrderItem]) -> dict[str, Any]:
    return {
        "id": order.id,
        "code": order.code,
        "name": order.customer_name,
        "phone": order.phone,
        "fulfillment": order.fulfillment,
        "address": order.address,
        "notes": order.notes,
        "lang": order.lang,
        "subtotal": float(order.subtotal),
        "discount": float(order.discount),
        "promotion": order.promo_title,
        "total": float(order.total),
        "status": order.status,
        "createdAt": order.created_at.replace(tzinfo=timezone.utc).isoformat(),
        "items": [{"name": item.name, "quantity": item.quantity, "unitPrice": float(item.unit_price), "subtotal": float(item.subtotal)} for item in items],
    }


def register_portal_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    # ---------- Público (lo usan los clientes) ----------

    @app.get("/api/portal")
    def portal_data(session: Session = Depends(get_db)) -> dict[str, Any]:
        settings = read_settings(session)
        texts: dict[int, dict[str, ProductText]] = {}
        for text in session.scalars(select(ProductText)):
            texts.setdefault(text.product_id, {})[text.lang] = text
        rows = session.execute(
            select(Product, Category.name)
            .join(Category, Product.category_id == Category.id)
            .where(Product.is_deleted.is_(False), Product.is_active.is_(True))
            .order_by(Category.id, Product.id)
        ).all()
        products = []
        for product, category_name in rows:
            by_lang = texts.get(product.id, {})
            es_description = by_lang["es"].description if "es" in by_lang else ""
            products.append({
                "id": product.id,
                "category": category_name,
                "price": float(product.price),
                "symbol": product.symbol,
                "tone": product.tone,
                "image": f"/media/products/{product.id}?v={product.image_version}" if product.image_version else None,
                "name": {
                    "es": product.name,
                    "pt": (by_lang["pt"].name if "pt" in by_lang else "") or product.name,
                    "en": (by_lang["en"].name if "en" in by_lang else "") or product.name,
                },
                "description": {
                    "es": es_description,
                    "pt": (by_lang["pt"].description if "pt" in by_lang else "") or es_description,
                    "en": (by_lang["en"].description if "en" in by_lang else "") or es_description,
                },
            })
        return {
            "name": settings["name"],
            "enabled": settings["enabled"],
            "whatsapp": digits_only(settings["whatsapp"]),
            "info": {"es": settings["infoEs"], "pt": settings["infoPt"] or settings["infoEs"], "en": settings["infoEn"] or settings["infoEs"]},
            "products": products,
            "promotions": [public_promotion(promo) for promo in live_promotions(session)],
        }

    @app.post("/api/portal/quote")
    def portal_quote(data: QuoteInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        return price_cart(session, data.items, data.phone)

    @app.post("/api/portal/orders", status_code=201)
    def portal_create_order(data: OrderInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        if get_setting(session, "enabled", "1") != "1":
            raise HTTPException(status_code=409, detail="El local no está recibiendo pedidos en este momento")
        name = data.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Escribe tu nombre")
        digits = valid_phone(data.phone)
        address = data.address.strip()
        if data.fulfillment == "ENTREGA" and len(address) < 5:
            raise HTTPException(status_code=422, detail="Escribe la dirección de entrega")
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
        recent = session.scalar(
            select(func.count(OnlineOrder.id)).where(OnlineOrder.phone_key == digits[-9:], OnlineOrder.status == "NUEVO", OnlineOrder.created_at >= since)
        )
        if (recent or 0) >= MAX_PENDING_PER_PHONE:
            raise HTTPException(status_code=429, detail="Ya enviaste varios pedidos. Espera la confirmación del local")

        priced = price_cart(session, data.items, digits)
        order = OnlineOrder(
            customer_name=name,
            phone=digits,
            phone_key=digits[-9:],
            fulfillment=data.fulfillment,
            address=address if data.fulfillment == "ENTREGA" else "",
            notes=data.notes.strip(),
            lang=data.lang,
            subtotal=Decimal(str(priced["subtotal"])),
            discount=Decimal(str(priced["discount"])),
            promo_title=priced["promotion"]["title"]["es"] if priced["promotion"] else "",
            total=Decimal(str(priced["total"])),
            status="NUEVO",
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        session.add(order)
        session.flush()
        order.code = f"W-{order.id:04d}"
        items = [
            OnlineOrderItem(
                order_id=order.id,
                product_id=line["productId"],
                name=line["name"],
                quantity=line["quantity"],
                unit_price=Decimal(str(line["unitPrice"])),
                subtotal=Decimal(str(line["subtotal"])),
            )
            for line in priced["lines"]
        ]
        session.add_all(items)
        session.commit()
        return {**serialize_order(order, items), "promotionTitles": priced["promotion"]["title"] if priced["promotion"] else None}

    # ---------- Administración (PIN) ----------

    @app.get("/api/portal/settings", dependencies=[Depends(require_admin)])
    def get_portal_settings(session: Session = Depends(get_db)) -> dict[str, Any]:
        return read_settings(session)

    @app.put("/api/portal/settings", dependencies=[Depends(require_admin)])
    def put_portal_settings(data: PortalSettingsInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        whatsapp = digits_only(data.whatsapp)
        if whatsapp and not 8 <= len(whatsapp) <= 15:
            raise HTTPException(status_code=422, detail="El WhatsApp debe incluir código de país y área (ej. 5548988102993)")
        values = {
            "name": data.name.strip(),
            "whatsapp": whatsapp,
            "enabled": "1" if data.enabled else "0",
            "info.es": data.infoEs.strip(),
            "info.pt": data.infoPt.strip(),
            "info.en": data.infoEn.strip(),
        }
        for key, value in values.items():
            session.merge(Setting(key=f"portal.{key}", value=value))
        session.commit()
        return read_settings(session)

    @app.get("/api/portal/promotions", dependencies=[Depends(require_admin)])
    def list_promotions(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        return [serialize_promotion(promo) for promo in session.scalars(select(Promotion).order_by(Promotion.id))]

    def apply_promotion(promo: Promotion, data: PromotionInput) -> None:
        if data.kind != "INFO" and data.percent <= 0:
            raise HTTPException(status_code=422, detail="Indica el porcentaje de descuento (mayor que 0)")
        promo.kind = data.kind
        promo.percent = data.percent if data.kind != "INFO" else Decimal("0")
        promo.min_total = data.minTotal
        promo.valid_until = data.validUntil
        promo.is_active = data.active
        promo.title_es, promo.title_pt, promo.title_en = data.titleEs.strip(), data.titlePt.strip(), data.titleEn.strip()
        promo.text_es, promo.text_pt, promo.text_en = data.textEs.strip(), data.textPt.strip(), data.textEn.strip()

    @app.post("/api/portal/promotions", status_code=201, dependencies=[Depends(require_admin)])
    def create_promotion(data: PromotionInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        promo = Promotion()
        apply_promotion(promo, data)
        session.add(promo)
        session.commit()
        return serialize_promotion(promo)

    @app.put("/api/portal/promotions/{promo_id}", dependencies=[Depends(require_admin)])
    def update_promotion(promo_id: int, data: PromotionInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        promo = session.get(Promotion, promo_id)
        if promo is None:
            raise HTTPException(status_code=404, detail="Promoción no encontrada")
        apply_promotion(promo, data)
        session.commit()
        return serialize_promotion(promo)

    @app.delete("/api/portal/promotions/{promo_id}", dependencies=[Depends(require_admin)])
    def delete_promotion(promo_id: int, session: Session = Depends(get_db)) -> dict[str, bool]:
        promo = session.get(Promotion, promo_id)
        if promo is None:
            raise HTTPException(status_code=404, detail="Promoción no encontrada")
        session.delete(promo)
        session.commit()
        return {"ok": True}

    @app.get("/api/portal/texts", dependencies=[Depends(require_admin)])
    def list_texts(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        texts: dict[int, dict[str, ProductText]] = {}
        for text in session.scalars(select(ProductText)):
            texts.setdefault(text.product_id, {})[text.lang] = text
        rows = session.execute(
            select(Product, Category.name).join(Category, Product.category_id == Category.id).where(Product.is_deleted.is_(False)).order_by(Category.id, Product.id)
        ).all()
        result = []
        for product, category_name in rows:
            by_lang = texts.get(product.id, {})
            entry: dict[str, Any] = {"productId": product.id, "category": category_name}
            for lang in LANGS:
                text = by_lang.get(lang)
                entry[lang] = {
                    "name": product.name if lang == "es" else (text.name if text else ""),
                    "description": text.description if text else "",
                }
            result.append(entry)
        return result

    @app.put("/api/portal/texts/{product_id}", dependencies=[Depends(require_admin)])
    def put_texts(product_id: int, data: ProductTextsInput, session: Session = Depends(get_db)) -> dict[str, bool]:
        product = session.get(Product, product_id)
        if product is None or product.is_deleted:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        for lang in LANGS:
            text: LangText = getattr(data, lang)
            # El nombre en español es el del producto (se edita en Carta); aquí solo se guarda su descripción.
            session.merge(ProductText(product_id=product_id, lang=lang, name="" if lang == "es" else text.name.strip(), description=text.description.strip()))
        session.commit()
        return {"ok": True}

    @app.get("/api/portal/orders", dependencies=[Depends(require_admin)])
    def list_orders(scope: Literal["active", "all"] = Query(default="active"), session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        query = select(OnlineOrder).order_by(OnlineOrder.id.desc()).limit(150)
        if scope == "active":
            query = query.where(OnlineOrder.status.in_(("NUEVO", "CONFIRMADO", "LISTO")))
        orders = list(session.scalars(query))
        items: dict[int, list[OnlineOrderItem]] = {order.id: [] for order in orders}
        if orders:
            for item in session.scalars(select(OnlineOrderItem).where(OnlineOrderItem.order_id.in_(items)).order_by(OnlineOrderItem.id)):
                items[item.order_id].append(item)
        return [serialize_order(order, items[order.id]) for order in orders]

    @app.put("/api/portal/orders/{order_id}", dependencies=[Depends(require_admin)])
    def set_order_status(order_id: int, data: StatusInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        order = session.get(OnlineOrder, order_id)
        if order is None:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
        order.status = data.status
        session.commit()
        items = list(session.scalars(select(OnlineOrderItem).where(OnlineOrderItem.order_id == order.id).order_by(OnlineOrderItem.id)))
        return serialize_order(order, items)
