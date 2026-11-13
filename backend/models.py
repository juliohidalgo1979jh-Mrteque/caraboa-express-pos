from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Category(Base):
    __tablename__ = "categorias"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column("nombre", String(50), nullable=False, unique=True)


class Product(Base):
    __tablename__ = "productos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column("categoria_id", ForeignKey("categorias.id"))
    name: Mapped[str] = mapped_column("nombre", String(100), nullable=False)
    price: Mapped[Decimal] = mapped_column("precio_base", Numeric(10, 2), nullable=False)
    is_active: Mapped[bool] = mapped_column("es_activo", Boolean, default=True, nullable=False)
    symbol: Mapped[str] = mapped_column("simbolo", String(4), default="◉", nullable=False)
    tone: Mapped[str] = mapped_column("tono", String(20), default="cream", nullable=False)
    image_version: Mapped[int | None] = mapped_column("imagen_version", Integer)
    margin: Mapped[Decimal | None] = mapped_column("margen", Numeric(6, 2))
    # Los productos eliminados se archivan: desaparecen de la carta pero conservan el historial de ventas.
    is_deleted: Mapped[bool] = mapped_column("eliminado", Boolean, default=False, nullable=False)


class ProductImage(Base):
    __tablename__ = "producto_imagenes"

    product_id: Mapped[int] = mapped_column("producto_id", ForeignKey("productos.id", ondelete="CASCADE"), primary_key=True)
    mime: Mapped[str] = mapped_column(String(30), nullable=False)
    data: Mapped[bytes] = mapped_column("datos", LargeBinary, nullable=False)


class PointOfSale(Base):
    __tablename__ = "puntos_venta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column("nombre", String(60), nullable=False, unique=True)
    code: Mapped[str | None] = mapped_column("codigo", String(3))
    methods: Mapped[str] = mapped_column("medios_pago", String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column("es_activo", Boolean, default=True, nullable=False)


class Shift(Base):
    __tablename__ = "turnos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    local_id: Mapped[str] = mapped_column("uuid_local", String(36), unique=True, nullable=False)
    opening_cash: Mapped[Decimal] = mapped_column("monto_inicial", Numeric(10, 2), nullable=False)
    closing_cash: Mapped[Decimal | None] = mapped_column("monto_final_real", Numeric(10, 2))
    opened_at: Mapped[datetime] = mapped_column("fecha_apertura", DateTime, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column("fecha_cierre", DateTime)
    state: Mapped[str] = mapped_column("estado", String(20), default="ABIERTO", nullable=False)
    point_id: Mapped[int | None] = mapped_column("punto_id", ForeignKey("puntos_venta.id"))
    # Conteo de billetes y monedas (JSON {"denominación": cantidad}) al abrir y al cerrar la caja.
    opening_detail: Mapped[str | None] = mapped_column("desglose_apertura", String(600))
    closing_detail: Mapped[str | None] = mapped_column("desglose_cierre", String(600))


class Setting(Base):
    __tablename__ = "ajustes"

    key: Mapped[str] = mapped_column("clave", String(50), primary_key=True)
    value: Mapped[str] = mapped_column("valor", String(200), nullable=False)


class Sale(Base):
    __tablename__ = "ventas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    uuid_local: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    shift_id: Mapped[int] = mapped_column("turno_id", ForeignKey("turnos.id"), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    tip: Mapped[Decimal] = mapped_column("propina", Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    delivery_fee: Mapped[Decimal] = mapped_column("envio", Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    discount: Mapped[Decimal] = mapped_column("descuento", Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    promo_code: Mapped[str] = mapped_column("codigo_promo", String(20), nullable=False, default="")
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    customer_id: Mapped[int | None] = mapped_column("cliente_id", Integer)
    payment_method: Mapped[str] = mapped_column("metodo_pago", String(20), nullable=False)
    point_id: Mapped[int | None] = mapped_column("punto_id", ForeignKey("puntos_venta.id"))
    order_number: Mapped[int | None] = mapped_column("numero_pedido", Integer)
    order_code: Mapped[str | None] = mapped_column("codigo_pedido", String(12))
    kitchen_printed_at: Mapped[datetime | None] = mapped_column("comanda_impresa_en", DateTime)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class SaleDetail(Base):
    __tablename__ = "detalle_venta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sale_id: Mapped[int] = mapped_column("venta_id", ForeignKey("ventas.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("productos.id"), nullable=False)
    product_name: Mapped[str] = mapped_column("nombre_producto", String(100), nullable=False)
    quantity: Mapped[int] = mapped_column("cantidad", Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column("precio_unitario", Numeric(10, 2), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)


class Supplier(Base):
    __tablename__ = "proveedores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column("nombre", String(100), nullable=False)
    tax_id: Mapped[str] = mapped_column("cuit", String(20), default="", nullable=False)
    phone: Mapped[str] = mapped_column("telefono", String(40), default="", nullable=False)
    email: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    address: Mapped[str] = mapped_column("direccion", String(150), default="", nullable=False)
    notes: Mapped[str] = mapped_column("notas", String(300), default="", nullable=False)
    is_active: Mapped[bool] = mapped_column("es_activo", Boolean, default=True, nullable=False)
    # Eliminado = archivado: deja de aparecer pero el historial de compras y movimientos lo sigue nombrando.
    is_deleted: Mapped[bool] = mapped_column("eliminado", Boolean, default=False, nullable=False)


class StockItem(Base):
    """Producto comprado listo (PRODUCTO) o insumo que se consume al preparar (INSUMO)."""

    __tablename__ = "articulos_stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column("tipo", String(10), nullable=False)
    name: Mapped[str] = mapped_column("nombre", String(100), nullable=False)
    unit: Mapped[str] = mapped_column("unidad", String(10), nullable=False)
    stock: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0"), nullable=False)
    min_stock: Mapped[Decimal] = mapped_column("stock_minimo", Numeric(12, 3), default=Decimal("0"), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column("costo_unitario", Numeric(12, 4), default=Decimal("0"), nullable=False)
    supplier_id: Mapped[int | None] = mapped_column("proveedor_id", ForeignKey("proveedores.id"))
    is_active: Mapped[bool] = mapped_column("es_activo", Boolean, default=True, nullable=False)
    # Eliminado = archivado: deja de aparecer pero el historial de compras y movimientos lo sigue nombrando.
    is_deleted: Mapped[bool] = mapped_column("eliminado", Boolean, default=False, nullable=False)


class RecipeLine(Base):
    """Cuánto de cada artículo lleva una unidad de un producto de la carta."""

    __tablename__ = "recetas_carta"
    __table_args__ = (UniqueConstraint("producto_id", "articulo_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column("producto_id", ForeignKey("productos.id", ondelete="CASCADE"), nullable=False)
    item_id: Mapped[int] = mapped_column("articulo_id", ForeignKey("articulos_stock.id"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column("cantidad", Numeric(12, 3), nullable=False)


class StockMovement(Base):
    __tablename__ = "movimientos_stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column("articulo_id", ForeignKey("articulos_stock.id"), nullable=False)
    kind: Mapped[str] = mapped_column("tipo", String(10), nullable=False)
    quantity: Mapped[Decimal] = mapped_column("cantidad", Numeric(12, 3), nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column("costo_unitario", Numeric(12, 4))
    supplier_id: Mapped[int | None] = mapped_column("proveedor_id", ForeignKey("proveedores.id"))
    sale_id: Mapped[int | None] = mapped_column("venta_id", ForeignKey("ventas.id", ondelete="SET NULL"))
    purchase_id: Mapped[int | None] = mapped_column("compra_id", Integer)
    # Para mermas: VENCIDO, DANADO, DERRAMADO, PREPARACION u OTRO.
    reason: Mapped[str | None] = mapped_column("motivo", String(20))
    note: Mapped[str] = mapped_column("nota", String(200), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class Purchase(Base):
    """Una compra (factura o ticket) con varios artículos; su total es la suma de sus líneas."""

    __tablename__ = "compras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int | None] = mapped_column("proveedor_id", ForeignKey("proveedores.id"))
    document: Mapped[str] = mapped_column("documento", String(60), default="", nullable=False)
    # Cuenta de donde salió el dinero: CAJA (efectivo), BANCO o MERCADOPAGO.
    account: Mapped[str] = mapped_column("cuenta", String(12), default="CAJA", nullable=False)
    purchased_on: Mapped[date] = mapped_column("fecha", Date, nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    note: Mapped[str] = mapped_column("nota", String(200), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class PurchaseLine(Base):
    __tablename__ = "compras_lineas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    purchase_id: Mapped[int] = mapped_column("compra_id", ForeignKey("compras.id", ondelete="CASCADE"), nullable=False)
    item_id: Mapped[int] = mapped_column("articulo_id", ForeignKey("articulos_stock.id"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column("cantidad", Numeric(12, 3), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column("costo_unitario", Numeric(12, 4), nullable=False)
    line_total: Mapped[Decimal] = mapped_column("total_linea", Numeric(12, 2), nullable=False)
    expires_on: Mapped[date | None] = mapped_column("vence", Date)


class StockLot(Base):
    """Lote con fecha de vencimiento: lo que queda de una compra. Se consume primero el que vence antes."""

    __tablename__ = "lotes_stock"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column("articulo_id", ForeignKey("articulos_stock.id"), nullable=False)
    purchase_line_id: Mapped[int | None] = mapped_column("compra_linea_id", Integer)
    quantity: Mapped[Decimal] = mapped_column("cantidad", Numeric(12, 3), nullable=False)
    expires_on: Mapped[date] = mapped_column("vence", Date, nullable=False)


class Equipment(Base):
    __tablename__ = "equipos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column("nombre", String(100), nullable=False)
    category: Mapped[str] = mapped_column("categoria", String(50), default="", nullable=False)
    brand: Mapped[str] = mapped_column("marca", String(60), default="", nullable=False)
    model: Mapped[str] = mapped_column("modelo", String(60), default="", nullable=False)
    serial_number: Mapped[str] = mapped_column("numero_serie", String(60), default="", nullable=False)
    location: Mapped[str] = mapped_column("ubicacion", String(60), default="", nullable=False)
    status: Mapped[str] = mapped_column("estado", String(20), default="OPERATIVO", nullable=False)
    purchase_date: Mapped[date | None] = mapped_column("fecha_compra", Date)
    value: Mapped[Decimal | None] = mapped_column("valor", Numeric(12, 2))
    notes: Mapped[str] = mapped_column("notas", String(300), default="", nullable=False)


class ProductText(Base):
    """Nombre y descripción de un producto en un idioma del portal (es, pt, en). El nombre en español vive en Product."""

    __tablename__ = "producto_textos"

    product_id: Mapped[int] = mapped_column("producto_id", ForeignKey("productos.id", ondelete="CASCADE"), primary_key=True)
    lang: Mapped[str] = mapped_column("idioma", String(2), primary_key=True)
    name: Mapped[str] = mapped_column("nombre", String(100), default="", nullable=False)
    description: Mapped[str] = mapped_column("descripcion", String(300), default="", nullable=False)


class Promotion(Base):
    """INFO = solo se muestra; PERCENT = % de descuento automático; PERCENT_FIRST = % solo en el primer pedido del cliente."""

    __tablename__ = "promociones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column("tipo", String(20), nullable=False)
    percent: Mapped[Decimal] = mapped_column("porcentaje", Numeric(5, 2), default=Decimal("0"), nullable=False)
    min_total: Mapped[Decimal] = mapped_column("minimo", Numeric(10, 2), default=Decimal("0"), nullable=False)
    valid_until: Mapped[date | None] = mapped_column("vence", Date)
    is_active: Mapped[bool] = mapped_column("es_activa", Boolean, default=True, nullable=False)
    title_es: Mapped[str] = mapped_column("titulo_es", String(80), default="", nullable=False)
    title_pt: Mapped[str] = mapped_column("titulo_pt", String(80), default="", nullable=False)
    title_en: Mapped[str] = mapped_column("titulo_en", String(80), default="", nullable=False)
    text_es: Mapped[str] = mapped_column("texto_es", String(200), default="", nullable=False)
    text_pt: Mapped[str] = mapped_column("texto_pt", String(200), default="", nullable=False)
    text_en: Mapped[str] = mapped_column("texto_en", String(200), default="", nullable=False)


class OnlineOrder(Base):
    __tablename__ = "pedidos_online"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column("codigo", String(12), default="", nullable=False)
    customer_name: Mapped[str] = mapped_column("cliente", String(80), nullable=False)
    phone: Mapped[str] = mapped_column("telefono", String(20), nullable=False)
    phone_key: Mapped[str] = mapped_column("telefono_clave", String(9), nullable=False, index=True)
    fulfillment: Mapped[str] = mapped_column("entrega", String(10), nullable=False)
    address: Mapped[str] = mapped_column("direccion", String(200), default="", nullable=False)
    notes: Mapped[str] = mapped_column("notas", String(300), default="", nullable=False)
    lang: Mapped[str] = mapped_column("idioma", String(2), default="es", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    discount: Mapped[Decimal] = mapped_column("descuento", Numeric(10, 2), default=Decimal("0"), nullable=False)
    promo_title: Mapped[str] = mapped_column("promocion", String(80), default="", nullable=False)
    promo_code: Mapped[str] = mapped_column("codigo_promo", String(20), default="", nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[str] = mapped_column("estado", String(12), default="NUEVO", nullable=False)
    stock_deducted: Mapped[bool] = mapped_column("stock_descontado", Boolean, default=False, nullable=False)
    delivery_fee: Mapped[Decimal | None] = mapped_column("envio", Numeric(10, 2))  # None = a confirmar
    payment_method: Mapped[str | None] = mapped_column("metodo_pago", String(20))
    sale_id: Mapped[int | None] = mapped_column("venta_id", Integer)
    paid_at: Mapped[datetime | None] = mapped_column("pagado_en", DateTime)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class OnlineOrderItem(Base):
    __tablename__ = "pedidos_online_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column("pedido_id", ForeignKey("pedidos_online.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("productos.id"), nullable=False)
    name: Mapped[str] = mapped_column("nombre", String(100), nullable=False)
    quantity: Mapped[int] = mapped_column("cantidad", Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column("precio_unitario", Numeric(10, 2), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)


class Expense(Base):
    """Gasto del local: FIJO (alquiler, luz, internet) o VARIABLE (mantenimiento, bolsas, reparaciones)."""

    __tablename__ = "gastos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column("tipo", String(10), nullable=False)
    category: Mapped[str] = mapped_column("categoria", String(40), nullable=False)
    description: Mapped[str] = mapped_column("descripcion", String(120), default="", nullable=False)
    amount: Mapped[Decimal] = mapped_column("monto", Numeric(12, 2), nullable=False)
    paid_on: Mapped[date] = mapped_column("fecha", Date, nullable=False)
    account: Mapped[str] = mapped_column("cuenta", String(12), default="CAJA", nullable=False)
    is_deleted: Mapped[bool] = mapped_column("eliminado", Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class Worker(Base):
    """Persona que trabaja por día o por hora."""

    __tablename__ = "personal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column("nombre", String(100), nullable=False)
    pay_type: Mapped[str] = mapped_column("tipo_pago", String(5), nullable=False)  # DIA | HORA
    rate: Mapped[Decimal] = mapped_column("tarifa", Numeric(10, 2), nullable=False)
    phone: Mapped[str] = mapped_column("telefono", String(40), default="", nullable=False)
    is_active: Mapped[bool] = mapped_column("es_activo", Boolean, default=True, nullable=False)
    is_deleted: Mapped[bool] = mapped_column("eliminado", Boolean, default=False, nullable=False)


class WorkerPayment(Base):
    """Trabajo realizado (días u horas) y su pago. Sin fecha de pago = pendiente."""

    __tablename__ = "pagos_personal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    worker_id: Mapped[int] = mapped_column("persona_id", ForeignKey("personal.id"), nullable=False)
    worked_on: Mapped[date] = mapped_column("fecha_trabajo", Date, nullable=False)
    units: Mapped[Decimal] = mapped_column("cantidad", Numeric(6, 2), nullable=False)
    rate: Mapped[Decimal] = mapped_column("tarifa", Numeric(10, 2), nullable=False)
    amount: Mapped[Decimal] = mapped_column("monto", Numeric(12, 2), nullable=False)
    paid_on: Mapped[date | None] = mapped_column("fecha_pago", Date)
    account: Mapped[str | None] = mapped_column("cuenta", String(12))
    note: Mapped[str] = mapped_column("nota", String(200), default="", nullable=False)
    is_deleted: Mapped[bool] = mapped_column("eliminado", Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class AccountMovement(Base):
    """Movimiento manual de dinero entre cuentas o hacia/desde afuera, y ajustes de arqueo. Monto con signo."""

    __tablename__ = "movimientos_cuenta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account: Mapped[str] = mapped_column("cuenta", String(12), nullable=False)
    # SALDO_INICIAL, TRANSFERENCIA, INGRESO, RETIRO, AJUSTE_ARQUEO
    kind: Mapped[str] = mapped_column("tipo", String(20), nullable=False)
    amount: Mapped[Decimal] = mapped_column("monto", Numeric(12, 2), nullable=False)
    note: Mapped[str] = mapped_column("nota", String(200), default="", nullable=False)
    moved_on: Mapped[date] = mapped_column("fecha", Date, nullable=False)
    group_id: Mapped[str | None] = mapped_column("grupo", String(36))
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class AccountAudit(Base):
    """Arqueo: lo contado de verdad contra lo que el sistema esperaba en una cuenta."""

    __tablename__ = "arqueos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account: Mapped[str] = mapped_column("cuenta", String(12), nullable=False)
    expected: Mapped[Decimal] = mapped_column("esperado", Numeric(12, 2), nullable=False)
    counted: Mapped[Decimal] = mapped_column("contado", Numeric(12, 2), nullable=False)
    difference: Mapped[Decimal] = mapped_column("diferencia", Numeric(12, 2), nullable=False)
    breakdown: Mapped[str | None] = mapped_column("desglose", String(600))
    note: Mapped[str] = mapped_column("nota", String(200), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class AppUser(Base):
    """Persona con nombre, perfil (DUENO, ENCARGADO, CAJERO) y clave propia para entrar a la administración."""

    __tablename__ = "usuarios_app"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column("nombre", String(60), nullable=False)
    role: Mapped[str] = mapped_column("perfil", String(12), nullable=False)
    pin_hash: Mapped[str] = mapped_column("clave_hash", String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column("activo", Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column("ultimo_ingreso", DateTime)


class ActionLog(Base):
    """Quién hizo qué: cada cambio hecho desde la administración queda registrado con el nombre de la persona."""

    __tablename__ = "registro_acciones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_name: Mapped[str] = mapped_column("usuario", String(60), nullable=False)
    role: Mapped[str] = mapped_column("perfil", String(12), nullable=False)
    method: Mapped[str] = mapped_column("metodo", String(8), nullable=False)
    path: Mapped[str] = mapped_column("ruta", String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False, index=True)


class Customer(Base):
    """Cliente identificado por su WhatsApp: historial de compras, preferencias y avance del programa de fidelidad."""

    __tablename__ = "clientes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column("nombre", String(80), default="", nullable=False)
    phone: Mapped[str] = mapped_column("telefono", String(20), nullable=False)
    phone_key: Mapped[str] = mapped_column("telefono_clave", String(9), nullable=False, unique=True, index=True)
    lang: Mapped[str] = mapped_column("idioma", String(2), default="pt", nullable=False)
    preferences: Mapped[str] = mapped_column("preferencias", String(300), default="", nullable=False)
    orders_count: Mapped[int] = mapped_column("compras", Integer, default=0, nullable=False)
    total_spent: Mapped[Decimal] = mapped_column("total_gastado", Numeric(12, 2), default=Decimal("0"), nullable=False)
    progress: Mapped[int] = mapped_column("avance_fidelidad", Integer, default=0, nullable=False)
    rewards_total: Mapped[int] = mapped_column("premios_ganados", Integer, default=0, nullable=False)
    last_order_at: Mapped[datetime | None] = mapped_column("ultima_compra", DateTime)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class LoyaltyReward(Base):
    """Premio ganado por completar N compras: cupón de descuento o producto de regalo, con un código de un solo uso."""

    __tablename__ = "premios_fidelidad"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column("cliente_id", ForeignKey("clientes.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column("tipo", String(10), nullable=False)  # DESCUENTO o REGALO
    percent: Mapped[Decimal | None] = mapped_column("porcentaje", Numeric(5, 2))
    gift_name: Mapped[str] = mapped_column("regalo", String(100), default="", nullable=False)
    code: Mapped[str] = mapped_column("codigo", String(12), nullable=False, unique=True)
    status: Mapped[str] = mapped_column("estado", String(12), default="DISPONIBLE", nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column("usado_en", DateTime)


class PromoCode(Base):
    """Código promocional (redes sociales, campañas): cada persona (por WhatsApp) puede usarlo una sola vez."""

    __tablename__ = "codigos_promo"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column("codigo", String(20), nullable=False, unique=True)
    label: Mapped[str] = mapped_column("nombre", String(80), default="", nullable=False)
    kind: Mapped[str] = mapped_column("tipo", String(10), nullable=False)  # PERCENT o AMOUNT
    value: Mapped[Decimal] = mapped_column("valor", Numeric(10, 2), nullable=False)
    min_total: Mapped[Decimal] = mapped_column("minimo", Numeric(10, 2), default=Decimal("0"), nullable=False)
    max_uses: Mapped[int] = mapped_column("usos_maximos", Integer, default=0, nullable=False)  # 0 = sin límite
    valid_until: Mapped[date | None] = mapped_column("vence", Date)
    is_active: Mapped[bool] = mapped_column("activo", Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)


class PromoRedemption(Base):
    """Uso de un código (o de un premio de fidelidad) por una persona. Es único por código y WhatsApp."""

    __tablename__ = "canjes_promo"
    __table_args__ = (UniqueConstraint("codigo_id", "telefono_clave", name="uq_canje_codigo_telefono"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code_id: Mapped[int | None] = mapped_column("codigo_id", ForeignKey("codigos_promo.id"))
    reward_id: Mapped[int | None] = mapped_column("premio_id", ForeignKey("premios_fidelidad.id"))
    phone_key: Mapped[str] = mapped_column("telefono_clave", String(9), nullable=False, index=True)
    customer_id: Mapped[int | None] = mapped_column("cliente_id", Integer)
    order_id: Mapped[int | None] = mapped_column("pedido_id", Integer)
    sale_uuid: Mapped[str | None] = mapped_column("venta_uuid", String(40))
    amount: Mapped[Decimal] = mapped_column("monto", Numeric(10, 2), default=Decimal("0"), nullable=False)
    created_at: Mapped[datetime] = mapped_column("creado_en", DateTime, nullable=False)
