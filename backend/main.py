import base64
import binascii
import os
import secrets
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import MetaData, Table, create_engine, event, inspect, select, update
from sqlalchemy.orm import Session, sessionmaker

from .catalog import PRODUCTS, TONES, TRANSLATIONS
from .models import Base, Category, PointOfSale, Product, ProductImage, ProductText, Sale, Setting, Shift
from .inventory import deduct_stock_for_sale, register_inventory_routes
from .kitchen import register_kitchen_routes
from .points import PAYMENT_METHODS, register_point_routes, seed_points
from .portal import register_portal_routes
from .reports import local_day_bounds, register_report_routes

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "dist"


class ProductInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=50)
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    symbol: str = Field(default="◉", min_length=1, max_length=4)
    tone: Literal[TONES] = "cream"  # type: ignore[valid-type]
    active: bool = True


class ImageInput(BaseModel):
    data_url: str = Field(alias="dataUrl", max_length=3_000_000)


IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 2_000_000


class HeadingInput(BaseModel):
    tagline: str = Field(default="", max_length=60)
    label: str = Field(default="", max_length=60)
    title: str = Field(min_length=1, max_length=80)
    subtitle: str = Field(default="", max_length=160)


DEFAULT_HEADING = {
    "tagline": "CARABOA EXPRESS",
    "label": "CARTA DEL DÍA",
    "title": "¿Qué servimos?",
    "subtitle": "Toca un producto para sumarlo al pedido.",
}


class SyncRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: Literal["shift.open", "shift.close", "sale.create"]
    client_id: str = Field(alias="clientId", min_length=1, max_length=36)
    payload: dict[str, Any]


def as_datetime(value: Any, *, default: datetime | None = None) -> datetime:
    if value is None:
        if default is not None:
            return default
        raise HTTPException(status_code=422, detail="Falta una fecha requerida")
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail="Formato de fecha no válido") from error


def as_money(value: Any, field: str) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=f"{field} no es un importe válido") from error
    if not amount.is_finite() or amount < 0:
        raise HTTPException(status_code=422, detail=f"{field} debe ser un importe positivo o cero")
    return amount.quantize(Decimal("0.01"))


def migrate_legacy_sqlite(engine: Any) -> None:
    column_specs = {
        "productos": {
            "categoria_id": "INTEGER REFERENCES categorias(id)",
            "nombre": "VARCHAR(100)",
            "precio_base": "NUMERIC(10, 2)",
            "es_activo": "BOOLEAN DEFAULT 1",
        },
        "turnos": {
            "uuid_local": "VARCHAR(36)",
            "monto_inicial": "NUMERIC(10, 2) DEFAULT 0",
            "monto_final_real": "NUMERIC(10, 2)",
            "fecha_apertura": "DATETIME",
            "fecha_cierre": "DATETIME",
            "estado": "VARCHAR(20) DEFAULT 'ABIERTO'",
        },
        "ventas": {
            "turno_id": "INTEGER REFERENCES turnos(id)",
            "propina": "NUMERIC(10, 2) DEFAULT 0",
            "metodo_pago": "VARCHAR(20)",
            "creado_en": "DATETIME",
        },
        "detalle_venta": {
            "venta_id": "INTEGER REFERENCES ventas(id)",
            "producto_id": "INTEGER REFERENCES productos(id)",
            "nombre_producto": "VARCHAR(100)",
            "cantidad": "INTEGER",
            "precio_unitario": "NUMERIC(10, 2)",
        },
    }

    with engine.begin() as connection:
        inspector = inspect(connection)
        for table_name, columns in column_specs.items():
            if not inspector.has_table(table_name):
                continue
            existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, definition in columns.items():
                if column_name not in existing_columns:
                    connection.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"
                    )
                    existing_columns.add(column_name)

        product_columns = {column["name"] for column in inspect(connection).get_columns("productos")}
        if "category" in product_columns:
            connection.exec_driver_sql(
                "INSERT INTO categorias (nombre) "
                "SELECT DISTINCT p.category FROM productos p "
                "WHERE p.category IS NOT NULL AND NOT EXISTS "
                "(SELECT 1 FROM categorias c WHERE c.nombre = p.category)"
            )
            connection.exec_driver_sql(
                "UPDATE productos SET categoria_id = "
                "(SELECT id FROM categorias WHERE nombre = productos.category) "
                "WHERE categoria_id IS NULL"
            )
        if "name" in product_columns:
            connection.exec_driver_sql("UPDATE productos SET nombre = name WHERE nombre IS NULL")
        if "price" in product_columns:
            connection.exec_driver_sql("UPDATE productos SET precio_base = price WHERE precio_base IS NULL")
        if "is_active" in product_columns:
            connection.exec_driver_sql("UPDATE productos SET es_activo = is_active WHERE es_activo IS NULL")

        shift_columns = {column["name"] for column in inspect(connection).get_columns("turnos")}
        shift_sources = {
            "uuid_local": ("local_id", "'legacy-shift-' || id"),
            "monto_inicial": ("opening_cash", "0"),
            "monto_final_real": ("closing_cash", "NULL"),
            "fecha_apertura": ("opened_at", "CURRENT_TIMESTAMP"),
            "fecha_cierre": ("closed_at", "NULL"),
            "estado": ("state", "'ABIERTO'"),
        }
        for target, (source, fallback) in shift_sources.items():
            if source in shift_columns:
                connection.exec_driver_sql(
                    f"UPDATE turnos SET {target} = {source} WHERE {target} IS NULL"
                )
            elif target == "uuid_local":
                connection.exec_driver_sql(
                    f"UPDATE turnos SET {target} = {fallback} WHERE {target} IS NULL"
                )
            else:
                connection.exec_driver_sql(
                    f"UPDATE turnos SET {target} = {fallback} WHERE {target} IS NULL"
                )

        sale_columns = {column["name"] for column in inspect(connection).get_columns("ventas")}
        for target, source in {
            "turno_id": "shift_id",
            "metodo_pago": "payment_method",
            "creado_en": "created_at",
        }.items():
            if source in sale_columns:
                connection.exec_driver_sql(
                    f"UPDATE ventas SET {target} = {source} WHERE {target} IS NULL"
                )

        detail_columns = {column["name"] for column in inspect(connection).get_columns("detalle_venta")}
        for target, source in {
            "venta_id": "sale_id",
            "producto_id": "product_id",
            "nombre_producto": "product_name",
            "cantidad": "quantity",
            "precio_unitario": "unit_price",
        }.items():
            if source in detail_columns:
                connection.exec_driver_sql(
                    f"UPDATE detalle_venta SET {target} = {source} WHERE {target} IS NULL"
                )

        connection.exec_driver_sql(
            "UPDATE detalle_venta SET nombre_producto = "
            "(SELECT nombre FROM productos WHERE productos.id = detalle_venta.producto_id) "
            "WHERE nombre_producto IS NULL"
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_turnos_uuid_local ON turnos(uuid_local)"
        )


def normalize_database_url(url: str) -> str:
    # Render y otros proveedores entregan postgres:// o postgresql://; SQLAlchemy necesita el driver psycopg.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


# Columnas agregadas después de la primera versión, para bases creadas antes (SQLite y PostgreSQL).
ADDED_COLUMNS = {
    "productos": {
        "simbolo": "VARCHAR(4) NOT NULL DEFAULT '◉'",
        "tono": "VARCHAR(20) NOT NULL DEFAULT 'cream'",
        "imagen_version": "INTEGER",
        "eliminado": "BOOLEAN NOT NULL DEFAULT FALSE",
        "margen": "NUMERIC(6, 2)",
    },
    "turnos": {"punto_id": "INTEGER REFERENCES puntos_venta(id)"},
    "proveedores": {"eliminado": "BOOLEAN NOT NULL DEFAULT FALSE"},
    "articulos_stock": {"eliminado": "BOOLEAN NOT NULL DEFAULT FALSE"},
    "ventas": {
        "punto_id": "INTEGER REFERENCES puntos_venta(id)",
        "numero_pedido": "INTEGER",
        "codigo_pedido": "VARCHAR(12)",
        "comanda_impresa_en": "TIMESTAMP",
    },
    "puntos_venta": {"codigo": "VARCHAR(3)"},
}


def add_missing_columns(engine: Any) -> None:
    with engine.begin() as connection:
        inspector = inspect(connection)
        existing = {table: {column["name"] for column in inspector.get_columns(table)} for table in ADDED_COLUMNS}
        for table, columns in ADDED_COLUMNS.items():
            for column_name, definition in columns.items():
                if column_name not in existing[table]:
                    connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column_name} {definition}")
        if "simbolo" not in existing["productos"]:
            # Recupera el ícono y color del catálogo inicial para los productos que ya existían.
            for item in PRODUCTS:
                connection.execute(
                    update(Product.__table__)
                    .where(Product.__table__.c.id == item["id"], Product.__table__.c.nombre == item["name"])
                    .values(simbolo=item["symbol"], tono=item["tone"])
                )


def create_app(
    database_url: str | None = None,
    frontend_dist: Path | None = FRONTEND_DIST,
    admin_pin: str | None = None,
    manager_pin: str | None = None,
) -> FastAPI:
    pin = admin_pin if admin_pin is not None else os.getenv("ADMIN_PIN", "")
    # Clave del encargado: puede cargar y editar datos, pero no borrar ni tocar ajustes sensibles.
    mgr_pin = manager_pin if manager_pin is not None else os.getenv("MANAGER_PIN", "")
    url = normalize_database_url(database_url or os.getenv("DATABASE_URL") or "sqlite:///./foodtruck_erp.db")
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args)

    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection: Any, _: Any) -> None:
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    if url.startswith("sqlite"):
        migrate_legacy_sqlite(engine)
    add_missing_columns(engine)
    with session_factory() as session:
        if session.scalar(select(Product.id).limit(1)) is None:
            category_ids: dict[str, int] = {}
            for item in PRODUCTS:
                category_name = item["category"]
                category = session.scalar(select(Category).where(Category.name == category_name))
                if category is None:
                    category = Category(name=category_name)
                    session.add(category)
                    session.flush()
                category_ids[category_name] = category.id

            session.add_all(
                Product(
                    id=item["id"],
                    category_id=category_ids[item["category"]],
                    name=item["name"],
                    price=Decimal(str(item["price"])),
                    symbol=item["symbol"],
                    tone=item["tone"],
                )
                for item in PRODUCTS
            )
            session.add_all(
                ProductText(product_id=product_id, lang=lang, name=name, description=description)
                for product_id, langs in TRANSLATIONS.items()
                for lang, (name, description) in langs.items()
            )
            session.commit()
        seed_points(session)
    if engine.dialect.name == "postgresql":
        # El catálogo inicial usa ids explícitos; la secuencia debe continuar después de ellos.
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "SELECT setval(pg_get_serial_sequence('productos', 'id'), "
                "COALESCE((SELECT MAX(id) FROM productos), 1))"
            )

    app = FastAPI(title="Food Truck ERP - API", version="0.1.0")
    app.state.engine = engine
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-Admin-Pin"],
    )

    def get_db():
        with session_factory() as session:
            yield session

    owner_only_paths = ("/api/points", "/api/portal/settings", "/api/settings/heading")

    def require_admin(request: Request, x_admin_pin: str = Header(default="")) -> None:
        if not pin:
            return
        given = x_admin_pin.encode()
        if secrets.compare_digest(given, pin.encode()):
            return
        if mgr_pin and secrets.compare_digest(given, mgr_pin.encode()):
            if request.method == "DELETE" or request.url.path.startswith(owner_only_paths) and request.method != "GET":
                raise HTTPException(status_code=403, detail="Esta acción es solo para el administrador")
            return
        raise HTTPException(status_code=401, detail="PIN incorrecto")

    def find_or_create_category(session: Session, name: str) -> Category:
        category = session.scalar(select(Category).where(Category.name == name))
        if category is None:
            category = Category(name=name)
            session.add(category)
            session.flush()
        return category

    def serialize_product(product: Product, category_name: str) -> dict[str, Any]:
        return {
            "id": product.id,
            "name": product.name,
            "category": category_name,
            "price": float(product.price),
            "symbol": product.symbol,
            "tone": product.tone,
            "active": product.is_active,
            "image": f"/media/products/{product.id}?v={product.image_version}" if product.image_version else None,
        }

    def apply_product_input(session: Session, product: Product, data: ProductInput) -> str:
        category_name = data.category.strip()
        if not data.name.strip() or not category_name:
            raise HTTPException(status_code=422, detail="El nombre y la categoría son obligatorios")
        product.name = data.name.strip()
        product.category_id = find_or_create_category(session, category_name).id
        product.price = data.price.quantize(Decimal("0.01"))
        product.symbol = data.symbol.strip() or "◉"
        product.tone = data.tone
        product.is_active = data.active
        return category_name

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/products")
    def list_products(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        rows = session.execute(
            select(Product, Category.name)
            .join(Category, Product.category_id == Category.id)
            .where(Product.is_deleted.is_(False))
            .order_by(Category.id, Product.id)
        ).all()
        return [serialize_product(product, category_name) for product, category_name in rows]

    def read_heading(session: Session) -> dict[str, str]:
        stored = {
            setting.key.removeprefix("encabezado."): setting.value
            for setting in session.scalars(select(Setting).where(Setting.key.startswith("encabezado.")))
        }
        return {field: stored.get(field, default) for field, default in DEFAULT_HEADING.items()}

    def product_with_category(session: Session, product_id: int) -> tuple[Product, str]:
        row = session.execute(
            select(Product, Category.name).join(Category, Product.category_id == Category.id)
            .where(Product.id == product_id, Product.is_deleted.is_(False))
        ).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        return row[0], row[1]

    @app.put("/api/products/{product_id}/image", dependencies=[Depends(require_admin)])
    def upload_product_image(product_id: int, data: ImageInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        product, category_name = product_with_category(session, product_id)
        header, _, encoded = data.data_url.partition(",")
        mime = header.removeprefix("data:").removesuffix(";base64")
        if not header.endswith(";base64") or mime not in IMAGE_TYPES:
            raise HTTPException(status_code=422, detail="La imagen debe ser JPG, PNG o WEBP")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise HTTPException(status_code=422, detail="La imagen no es válida") from error
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=422, detail="La imagen es demasiado grande (máximo 2 MB)")
        session.merge(ProductImage(product_id=product.id, mime=mime, data=content))
        product.image_version = (product.image_version or 0) + 1
        session.commit()
        return serialize_product(product, category_name)

    @app.delete("/api/products/{product_id}/image", dependencies=[Depends(require_admin)])
    def delete_product_image(product_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        product, category_name = product_with_category(session, product_id)
        image = session.get(ProductImage, product.id)
        if image is not None:
            session.delete(image)
        product.image_version = None
        session.commit()
        return serialize_product(product, category_name)

    # Fuera de /api/ para que el service worker guarde las imágenes y se vean sin conexión.
    @app.get("/media/products/{product_id}")
    def product_image(product_id: int, session: Session = Depends(get_db)) -> Response:
        image = session.get(ProductImage, product_id)
        if image is None:
            raise HTTPException(status_code=404, detail="Imagen no encontrada")
        return Response(image.data, media_type=image.mime, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    register_point_routes(app, get_db, require_admin, local_day_bounds)
    register_inventory_routes(app, get_db, require_admin)
    register_report_routes(app, get_db, require_admin)
    register_kitchen_routes(app, get_db)
    register_portal_routes(app, get_db, require_admin)

    @app.get("/api/settings/heading")
    def get_heading(session: Session = Depends(get_db)) -> dict[str, str]:
        return read_heading(session)

    @app.put("/api/settings/heading", dependencies=[Depends(require_admin)])
    def update_heading(data: HeadingInput, session: Session = Depends(get_db)) -> dict[str, str]:
        if not data.title.strip():
            raise HTTPException(status_code=422, detail="El título es obligatorio")
        for field, value in data.model_dump().items():
            session.merge(Setting(key=f"encabezado.{field}", value=value.strip()))
        session.commit()
        return read_heading(session)

    @app.post("/api/admin/verify", dependencies=[Depends(require_admin)])
    def verify_admin() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/products", status_code=201, dependencies=[Depends(require_admin)])
    def create_product(data: ProductInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        product = Product()
        category_name = apply_product_input(session, product, data)
        session.add(product)
        session.commit()
        return serialize_product(product, category_name)

    @app.put("/api/products/{product_id}", dependencies=[Depends(require_admin)])
    def update_product(product_id: int, data: ProductInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        product, _ = product_with_category(session, product_id)
        category_name = apply_product_input(session, product, data)
        session.commit()
        return serialize_product(product, category_name)

    @app.delete("/api/products/{product_id}", dependencies=[Depends(require_admin)])
    def delete_product(product_id: int, session: Session = Depends(get_db)) -> dict[str, bool]:
        product, _ = product_with_category(session, product_id)
        # Se archiva en lugar de borrarlo: las ventas anteriores (y las que lleguen de dispositivos sin conexión) lo siguen referenciando.
        product.is_deleted = True
        product.is_active = False
        session.commit()
        return {"ok": True}

    @app.post("/api/sync")
    def sync(operation: SyncRequest, session: Session = Depends(get_db)) -> dict[str, Any]:
        payload = operation.payload

        if operation.type == "shift.open":
            existing = session.scalar(select(Shift).where(Shift.local_id == operation.client_id))
            if existing:
                return {"ok": True, "duplicate": True, "server_id": existing.id}
            opening_cash = as_money(payload.get("openingCash"), "Efectivo inicial")
            opened_at = as_datetime(payload.get("openedAt"))
            # Un punto borrado o desconocido no debe trabar la sincronización: el turno queda sin punto.
            point_id = payload.get("pointId")
            point = session.get(PointOfSale, point_id) if isinstance(point_id, int) else None
            shifts_table = Table("turnos", MetaData(), autoload_with=session.get_bind())
            shift_values = {
                "punto_id": point.id if point else None,
                "uuid_local": operation.client_id,
                "local_id": operation.client_id,
                "monto_inicial": opening_cash,
                "opening_cash": opening_cash,
                "fecha_apertura": opened_at,
                "opened_at": opened_at,
                "estado": "ABIERTO",
                "state": "ABIERTO",
            }
            result = session.execute(
                shifts_table.insert().values(
                    {key: value for key, value in shift_values.items() if key in shifts_table.c}
                )
            )
            session.commit()
            return {"ok": True, "duplicate": False, "server_id": result.inserted_primary_key[0]}

        if operation.type == "shift.close":
            shift = session.scalar(select(Shift).where(Shift.local_id == operation.client_id))
            if shift is None:
                raise HTTPException(status_code=409, detail="El turno todavía no está sincronizado")
            if shift.state == "CERRADO":
                return {"ok": True, "duplicate": True, "server_id": shift.id}
            closing_cash = as_money(payload.get("closingCash"), "Efectivo contado")
            closed_at = as_datetime(payload.get("closedAt"))
            shifts_table = Table("turnos", MetaData(), autoload_with=session.get_bind())
            closing_values = {
                "monto_final_real": closing_cash,
                "closing_cash": closing_cash,
                "fecha_cierre": closed_at,
                "closed_at": closed_at,
                "estado": "CERRADO",
                "state": "CERRADO",
            }
            session.execute(
                update(shifts_table)
                .where(shifts_table.c.id == shift.id)
                .values({key: value for key, value in closing_values.items() if key in shifts_table.c})
            )
            session.commit()
            return {"ok": True, "duplicate": False, "server_id": shift.id}

        existing_sale = session.scalar(select(Sale).where(Sale.uuid_local == operation.client_id))
        if existing_sale:
            return {"ok": True, "duplicate": True, "server_id": existing_sale.id}

        local_shift_id = payload.get("turno_local_id")
        shift = session.scalar(select(Shift).where(Shift.local_id == local_shift_id))
        if shift is None:
            raise HTTPException(status_code=409, detail="El turno todavía no está sincronizado")
        if shift.state != "ABIERTO":
            raise HTTPException(status_code=409, detail="No se aceptan ventas en un turno cerrado")
        items = payload.get("detalles")
        if not isinstance(items, list) or not items:
            raise HTTPException(status_code=422, detail="La venta debe incluir al menos un producto")

        detail_rows: list[dict[str, Any]] = []
        subtotal = Decimal("0.00")
        for item in items:
            if not isinstance(item, dict):
                raise HTTPException(status_code=422, detail="El detalle de venta no es válido")
            product_id = item.get("productId")
            product = session.get(Product, product_id) if isinstance(product_id, int) else None
            if product is None:
                raise HTTPException(status_code=422, detail="La venta contiene un producto no válido")
            try:
                quantity = int(item.get("quantity"))
            except (TypeError, ValueError) as error:
                raise HTTPException(status_code=422, detail="La cantidad no es válida") from error
            if quantity < 1:
                raise HTTPException(status_code=422, detail="La cantidad debe ser mayor a cero")
            unit_price = as_money(item.get("price"), "Precio unitario")
            line_total = (unit_price * quantity).quantize(Decimal("0.01"))
            subtotal += line_total
            charged_name = item.get("name")
            product_name = charged_name.strip()[:100] if isinstance(charged_name, str) and charged_name.strip() else product.name
            detail_rows.append(
                {
                    "producto_id": product.id,
                    "product_id": product.id,
                    "nombre_producto": product_name,
                    "product_name": product_name,
                    "cantidad": quantity,
                    "quantity": quantity,
                    "precio_unitario": unit_price,
                    "unit_price": unit_price,
                    "subtotal": line_total,
                }
            )

        try:
            method = str(payload.get("metodo_pago", ""))
            if method not in PAYMENT_METHODS:
                raise HTTPException(status_code=422, detail="Método de pago no válido")
            tip = as_money(payload.get("propina", 0), "Propina")
            total = subtotal + tip
            if as_money(payload.get("subtotal"), "Subtotal") != subtotal:
                raise HTTPException(status_code=409, detail="El subtotal de la venta no coincide con sus artículos")
            if as_money(payload.get("total"), "Total") != total:
                raise HTTPException(status_code=409, detail="El total de la venta no coincide con su subtotal y propina")
            created_at = as_datetime(payload.get("creado_en"))
            # Número de pedido que mostró el dispositivo (A-001…); ventas de versiones anteriores no lo traen.
            order_number = payload.get("numero_pedido") if isinstance(payload.get("numero_pedido"), int) and payload["numero_pedido"] > 0 else None
            order_code = str(payload["codigo_pedido"])[:12] if order_number and payload.get("codigo_pedido") else None
            sales_table = Table("ventas", MetaData(), autoload_with=session.get_bind())
            sale_values = {
                "uuid_local": operation.client_id,
                "turno_id": shift.id,
                "shift_id": shift.id,
                "subtotal": subtotal,
                "descuento": Decimal("0.00"),
                "tip": tip,
                "propina": tip,
                "total": total,
                "metodo_pago": method,
                "payment_method": method,
                "es_offline": False,
                "punto_id": shift.point_id,
                "numero_pedido": order_number,
                "codigo_pedido": order_code,
                "creado_en": created_at,
                "created_at": created_at,
            }
            sale_result = session.execute(
                sales_table.insert().values(
                    {key: value for key, value in sale_values.items() if key in sales_table.c}
                )
            )
            sale_id = sale_result.inserted_primary_key[0]
            details_table = Table("detalle_venta", MetaData(), autoload_with=session.get_bind())
            for detail in detail_rows:
                detail["venta_id"] = sale_id
                detail["sale_id"] = sale_id
                session.execute(
                    details_table.insert().values(
                        {key: value for key, value in detail.items() if key in details_table.c}
                    )
                )
            deduct_stock_for_sale(
                session, sale_id, [(detail["producto_id"], detail["cantidad"]) for detail in detail_rows], created_at
            )
            session.commit()
        except Exception:
            session.rollback()
            raise

        return {"ok": True, "duplicate": False, "server_id": sale_id}

    # Portal de pedidos para clientes: una página aparte, ligera, en /pedir (es el enlace que se comparte por WhatsApp).
    if frontend_dist is not None and (frontend_dist / "portal.html").is_file():
        @app.get("/pedir", include_in_schema=False)
        def portal_page(request: Request) -> HTMLResponse:
            html = (frontend_dist / "portal.html").read_text(encoding="utf-8")
            # Las vistas previas de WhatsApp necesitan la dirección completa de la imagen.
            return HTMLResponse(html.replace("%BASE%", str(request.base_url).rstrip("/")))

    # En producción la API también sirve el frontend compilado (npm run build), en el mismo dominio.
    if frontend_dist is not None and (frontend_dist / "index.html").is_file():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    return app


app = create_app()