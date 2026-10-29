# Tequeños Club POS

Punto de venta para food truck: carta táctil con fotos, pedidos, cobros por punto de venta (efectivo, tarjeta, QR, transferencia, Mercado Pago), propinas, arqueo de caja y tickets. Incluye inventario de productos e insumos con recetas y costos, proveedores, equipos y reportes PDF. Las ventas se guardan primero en el dispositivo (IndexedDB) y se sincronizan al recuperar conexión; la PWA abre sin conexión.

## Desarrollo local

Requisitos: Node.js 20+ y Python 3.11+.

```bash
npm install
npm run dev
```

En otra terminal, instala y ejecuta la API:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Abre <http://localhost:5173>. Vite reenvía `/api` al backend en `localhost:8000`. La API crea `foodtruck_erp.db` (SQLite) para desarrollo. Para PostgreSQL, configura `DATABASE_URL` con una URL `postgresql+psycopg://...` y aplica [schema.sql](schema.sql) antes de iniciar la API.

## Pruebas

```bash
npm run build
.venv/bin/python -m pytest -q
```

## Publicar en Render

`render.yaml` crea un único servicio web (la API de FastAPI sirve también el frontend compilado) y su base PostgreSQL `tequenos-club-db`:

1. En Render: **New → Blueprint** y elige este repositorio.
2. Render ejecuta `npm run build`, arranca `uvicorn` y conecta `DATABASE_URL` automáticamente.
3. Render genera `ADMIN_PIN` al azar. Cámbialo por un PIN propio en **Environment** del servicio.

## Editar la carta

En la pantalla **Carta** se agregan productos y se cambian nombre, categoría, precio, ícono, color y disponibilidad, además de los textos del encabezado del punto de venta. Guardar requiere conexión y el PIN de `ADMIN_PIN` (la app lo pide la primera vez y lo recuerda en ese dispositivo). Si `ADMIN_PIN` no está definido, como en desarrollo local, no se pide PIN.

Cada dispositivo descarga la carta al conectarse y la guarda para vender sin conexión. Las ventas registran el precio cobrado, aunque la carta cambie antes de sincronizar.

La API crea las tablas al iniciar si no existen. La base gratuita de Render caduca a los 30 días; para uso real cambia a un plan de pago.

## Módulos

| Sección | Qué hace |
| --- | --- |
| **Punto de venta** | Cobra con los medios de pago habilitados para el punto del dispositivo. Importes en pesos argentinos (`$ 1.250,50`). |
| **Comandas** | La laptop con la impresora térmica activa la estación e imprime sola (80 mm) la comanda de cada pedido nuevo de todos los puntos, sin repetir. Para imprimir sin diálogo, abrir Chrome con `--kiosk-printing`. |
| **Ticket digital** | Desde el ticket: enviarlo por WhatsApp o mostrar un QR que abre `/ticket/<id>`; también imprimirlo en 80 mm. |
| **Carta** | Productos con foto o ícono, precio, categoría y disponibilidad; textos del encabezado. |
| **Reportes** | Ventas por día (hora de Argentina), por turno y por punto, con PDF descargable. |
| **Inventario** | Productos (se compran listos) e insumos (se gastan al preparar): stock, mínimo, costo, compras y conteos. |
| **Recetas y costos** | Qué lleva cada ítem de la carta, costo sumado, % de ganancia y precio sugerido (redondeado a $10). Cada venta descuenta stock según la receta. |
| **Proveedores** y **Equipos** | Altas y edición; los equipos registran estado, valor y fecha de compra. |
| **Puntos de venta** | Cada laptop o celular elige su punto; turnos y ventas quedan identificados. |

Las secciones de administración piden el PIN de `ADMIN_PIN`.

## Límites del MVP

- La carta inicial de demostración (`backend/catalog.py`) se carga solo si la base no tiene productos.
- Los cobros se registran por medio de pago; la integración con terminales, Mercado Pago (cobro automático) y la impresión Bluetooth requieren configuración de hardware y proveedor.
- El costo de un artículo es el de su última compra. Los reportes y el descuento de stock incluyen solo las ventas ya sincronizadas.
- El backend sincroniza turnos y ventas idempotentemente. Catering y pagos combinados en una misma venta quedan para fases siguientes.