import sqlite3
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.main import create_app


def test_offline_sync_is_idempotent_and_closes_shift(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}")
    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}

        shift_id = "shift-local-1"
        opened_at = datetime.now(timezone.utc).isoformat()
        open_operation = {
            "type": "shift.open",
            "clientId": shift_id,
            "payload": {"id": shift_id, "openingCash": 100, "openedAt": opened_at},
        }
        assert client.post("/api/sync", json=open_operation).status_code == 200
        assert client.post("/api/sync", json=open_operation).json()["duplicate"] is True

        sale_operation = {
            "type": "sale.create",
            "clientId": "sale-local-1",
            "payload": {
                "turno_local_id": shift_id,
                "subtotal": 19,
                "propina": 2,
                "total": 21,
                "metodo_pago": "EFECTIVO",
                "creado_en": datetime.now(timezone.utc).isoformat(),
                "detalles": [
                    {"productId": 1, "name": "Arepa Pabellón", "quantity": 2, "price": 9.5, "subtotal": 19}
                ],
            },
        }
        sale_response = client.post("/api/sync", json=sale_operation)
        assert sale_response.status_code == 200
        assert sale_response.json()["duplicate"] is False
        assert client.post("/api/sync", json=sale_operation).json()["duplicate"] is True

        close_operation = {
            "type": "shift.close",
            "clientId": shift_id,
            "payload": {"id": shift_id, "closingCash": 121, "closedAt": datetime.now(timezone.utc).isoformat()},
        }
        assert client.post("/api/sync", json=close_operation).status_code == 200
        assert client.post("/api/sync", json=close_operation).json()["duplicate"] is True


def test_sale_requires_an_open_synchronized_shift(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}")
    with TestClient(app) as client:
        response = client.post(
            "/api/sync",
            json={
                "type": "sale.create",
                "clientId": "sale-local-2",
                "payload": {
                    "turno_local_id": "missing-shift",
                    "total": 9.5,
                    "metodo_pago": "EFECTIVO",
                    "creado_en": datetime.now(timezone.utc).isoformat(),
                    "detalles": [{"productId": 1, "quantity": 1, "price": 9.5}],
                },
            },
        )
        assert response.status_code == 409


def test_sale_rejects_a_total_that_does_not_match_its_items(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}")
    with TestClient(app) as client:
        shift_id = "shift-local-3"
        client.post(
            "/api/sync",
            json={
                "type": "shift.open",
                "clientId": shift_id,
                "payload": {"openingCash": 0, "openedAt": datetime.now(timezone.utc).isoformat()},
            },
        )
        response = client.post(
            "/api/sync",
            json={
                "type": "sale.create",
                "clientId": "sale-local-3",
                "payload": {
                    "turno_local_id": shift_id,
                    "subtotal": 9.5,
                    "propina": 0,
                    "total": 10,
                    "metodo_pago": "EFECTIVO",
                    "creado_en": datetime.now(timezone.utc).isoformat(),
                    "detalles": [{"productId": 1, "quantity": 1, "price": 9.5}],
                },
            },
        )
        assert response.status_code == 409


def test_legacy_sqlite_schema_is_migrated_without_losing_catalog(tmp_path):
    database_path = tmp_path / "legacy.db"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE categorias (id INTEGER PRIMARY KEY, nombre VARCHAR(50) NOT NULL);
            CREATE TABLE productos (
                id INTEGER PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                category VARCHAR(50) NOT NULL,
                price NUMERIC(10, 2) NOT NULL,
                is_active BOOLEAN NOT NULL
            );
            CREATE TABLE turnos (
                id INTEGER PRIMARY KEY,
                local_id VARCHAR(36) NOT NULL UNIQUE,
                opening_cash NUMERIC(10, 2) NOT NULL,
                closing_cash NUMERIC(10, 2),
                opened_at DATETIME NOT NULL,
                closed_at DATETIME,
                state VARCHAR(20) NOT NULL
            );
            CREATE TABLE ventas (
                id INTEGER PRIMARY KEY,
                uuid_local VARCHAR(36) NOT NULL UNIQUE,
                shift_id INTEGER NOT NULL,
                subtotal NUMERIC(10, 2) NOT NULL,
                total NUMERIC(10, 2) NOT NULL,
                payment_method VARCHAR(20) NOT NULL,
                created_at DATETIME NOT NULL
            );
            CREATE TABLE detalle_venta (
                id INTEGER PRIMARY KEY,
                sale_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                product_name VARCHAR(100) NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price NUMERIC(10, 2) NOT NULL,
                subtotal NUMERIC(10, 2) NOT NULL
            );
            INSERT INTO productos VALUES (1, 'Arepa Pabellón', 'Arepas', 9.50, 1);
            INSERT INTO turnos VALUES (1, 'legacy-shift-1', 100, NULL, '2026-10-27 08:00:00', NULL, 'ABIERTO');
            """
        )

    app = create_app(f"sqlite:///{database_path}")
    with sqlite3.connect(database_path) as connection:
        product = connection.execute(
            "SELECT nombre, precio_base, categoria_id FROM productos WHERE id = 1"
        ).fetchone()
        assert product == ("Arepa Pabellón", 9.5, 1)
        shift_uuid = connection.execute("SELECT uuid_local FROM turnos WHERE id = 1").fetchone()[0]
        assert shift_uuid == "legacy-shift-1"

    with TestClient(app) as client:
        response = client.post(
            "/api/sync",
            json={
                "type": "shift.open",
                "clientId": "legacy-shift-1",
                "payload": {"openingCash": 100, "openedAt": "2026-10-27T08:00:00"},
            },
        )
        assert response.status_code == 200
        assert response.json()["duplicate"] is True

        new_shift_id = "new-shift-after-migration"
        create_response = client.post(
            "/api/sync",
            json={
                "type": "shift.open",
                "clientId": new_shift_id,
                "payload": {"openingCash": 50, "openedAt": "2026-10-27T09:00:00"},
            },
        )
        assert create_response.status_code == 200
        assert create_response.json()["duplicate"] is False
        with sqlite3.connect(database_path) as connection:
            legacy_id, current_id = connection.execute(
                "SELECT local_id, uuid_local FROM turnos WHERE id = ?",
                (create_response.json()["server_id"],),
            ).fetchone()
        assert legacy_id == current_id == new_shift_id

        sale_response = client.post(
            "/api/sync",
            json={
                "type": "sale.create",
                "clientId": "sale-after-migration",
                "payload": {
                    "turno_local_id": new_shift_id,
                    "subtotal": 9.5,
                    "propina": 1,
                    "total": 10.5,
                    "metodo_pago": "EFECTIVO",
                    "creado_en": datetime.now(timezone.utc).isoformat(),
                    "detalles": [{"productId": 1, "quantity": 1, "price": 9.5}],
                },
            },
        )
        assert sale_response.status_code == 200
        close_response = client.post(
            "/api/sync",
            json={
                "type": "shift.close",
                "clientId": new_shift_id,
                "payload": {"closingCash": 60.5, "closedAt": datetime.now(timezone.utc).isoformat()},
            },
        )
        assert close_response.status_code == 200
        with sqlite3.connect(database_path) as connection:
            closed_state = connection.execute(
                "SELECT state, estado FROM turnos WHERE id = ?",
                (create_response.json()["server_id"],),
            ).fetchone()
            sale_names = connection.execute(
                "SELECT product_name, nombre_producto FROM detalle_venta"
            ).fetchone()
        assert closed_state == ("CERRADO", "CERRADO")
        assert sale_names == ("Arepa Pabellón", "Arepa Pabellón")

def test_database_url_uses_psycopg_driver():
    from backend.main import normalize_database_url

    assert normalize_database_url("postgres://u:p@host/db") == "postgresql+psycopg://u:p@host/db"
    assert normalize_database_url("postgresql://u:p@host/db") == "postgresql+psycopg://u:p@host/db"
    assert normalize_database_url("postgresql+psycopg://u:p@host/db") == "postgresql+psycopg://u:p@host/db"
    assert normalize_database_url("sqlite:///./x.db") == "sqlite:///./x.db"


def test_serves_built_frontend_alongside_api(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<title>Tequeños Club</title>", encoding="utf-8")
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", frontend_dist=dist)
    with TestClient(app) as client:
        assert "Tequeños Club" in client.get("/").text
        assert client.get("/api/health").json() == {"status": "ok"}


def test_menu_is_editable_with_admin_pin(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    with TestClient(app) as client:
        menu = client.get("/api/products").json()
        assert len(menu) == 10
        assert menu[0] == {
            "id": 1, "name": "Pizza Margarita 25 cm", "category": "Pizzas", "price": 25,
            "symbol": "◉", "tone": "coral", "active": True, "image": None,
        }

        new_product = {"name": "Tequeños de guayaba", "category": "Tequeños", "price": 7.25, "symbol": "▰", "tone": "pink"}
        assert client.post("/api/products", json=new_product).status_code == 401
        assert client.post("/api/products", json=new_product, headers={"X-Admin-Pin": "0000"}).status_code == 401
        assert client.post("/api/admin/verify", headers={"X-Admin-Pin": "1234"}).status_code == 200

        created = client.post("/api/products", json=new_product, headers={"X-Admin-Pin": "1234"})
        assert created.status_code == 201
        assert created.json()["id"] == 11
        assert created.json()["category"] == "Tequeños"

        edited = {**new_product, "name": "Tequeños de guayaba (6)", "price": 8, "active": False}
        response = client.put("/api/products/11", json=edited, headers={"X-Admin-Pin": "1234"})
        assert response.status_code == 200
        assert response.json()["price"] == 8.0
        assert response.json()["active"] is False
        assert client.get("/api/products").json()[-1]["name"] == "Tequeños de guayaba (6)"

        assert client.put("/api/products/999", json=edited, headers={"X-Admin-Pin": "1234"}).status_code == 404
        invalid = {**new_product, "price": -1}
        assert client.post("/api/products", json=invalid, headers={"X-Admin-Pin": "1234"}).status_code == 422
        invalid_tone = {**new_product, "tone": "neon"}
        assert client.post("/api/products", json=invalid_tone, headers={"X-Admin-Pin": "1234"}).status_code == 422


def test_offline_sale_keeps_charged_price_after_menu_change(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="")
    with TestClient(app) as client:
        shift_id = "shift-local-price"
        client.post("/api/sync", json={
            "type": "shift.open", "clientId": shift_id,
            "payload": {"openingCash": 0, "openedAt": datetime.now(timezone.utc).isoformat()},
        })
        product = client.get("/api/products").json()[0]
        client.put("/api/products/1", json={**product, "price": 11, "active": False})

        response = client.post("/api/sync", json={
            "type": "sale.create", "clientId": "sale-local-price",
            "payload": {
                "turno_local_id": shift_id, "subtotal": 9.5, "propina": 0, "total": 9.5,
                "metodo_pago": "TARJETA", "creado_en": datetime.now(timezone.utc).isoformat(),
                "detalles": [{"productId": 1, "name": "Arepa Pabellón", "quantity": 1, "price": 9.5}],
            },
        })
        assert response.status_code == 200


def test_pos_heading_is_editable_with_admin_pin(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    with TestClient(app) as client:
        assert client.get("/api/settings/heading").json() == {
            "tagline": "CARABOA EXPRESS",
            "label": "CARTA DEL DÍA",
            "title": "¿Qué servimos?",
            "subtitle": "Toca un producto para sumarlo al pedido.",
        }
        heading = {"tagline": "VIERNES DE TEQUEÑOS", "label": "", "title": "¿Qué te provoca?", "subtitle": " Recién fritos. "}
        assert client.put("/api/settings/heading", json=heading).status_code == 401
        response = client.put("/api/settings/heading", json=heading, headers={"X-Admin-Pin": "1234"})
        assert response.status_code == 200
        assert response.json()["subtitle"] == "Recién fritos."
        assert client.get("/api/settings/heading").json()["tagline"] == "VIERNES DE TEQUEÑOS"
        blank_title = {**heading, "title": "  "}
        assert client.put("/api/settings/heading", json=blank_title, headers={"X-Admin-Pin": "1234"}).status_code == 422


def test_product_image_upload_serve_and_delete(tmp_path):
    import base64

    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    data_url = "data:image/png;base64," + base64.b64encode(png).decode()
    pin = {"X-Admin-Pin": "1234"}
    with TestClient(app) as client:
        assert client.get("/api/products").json()[0]["image"] is None
        assert client.put("/api/products/1/image", json={"dataUrl": data_url}).status_code == 401
        response = client.put("/api/products/1/image", json={"dataUrl": data_url}, headers=pin)
        assert response.status_code == 200
        image_url = response.json()["image"]
        assert image_url == "/media/products/1?v=1"
        served = client.get(image_url)
        assert served.status_code == 200 and served.content == png and served.headers["content-type"] == "image/png"

        assert client.put("/api/products/1/image", json={"dataUrl": data_url}, headers=pin).json()["image"].endswith("v=2")
        bad = client.put("/api/products/1/image", json={"dataUrl": "data:text/plain;base64,aGk="}, headers=pin)
        assert bad.status_code == 422
        assert client.put("/api/products/999/image", json={"dataUrl": data_url}, headers=pin).status_code == 404

        assert client.delete("/api/products/1/image", headers=pin).json()["image"] is None
        assert client.get("/media/products/1").status_code == 404


def test_points_of_sale_and_sales_per_point(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    pin = {"X-Admin-Pin": "1234"}
    with TestClient(app) as client:
        points = client.get("/api/points").json()
        assert [point["name"] for point in points] == ["Laptop principal", "Celular 1"]
        assert points[0]["methods"] == ["EFECTIVO", "TARJETA", "QR", "TRANSFERENCIA", "MERCADO_PAGO"]

        new_point = {"name": "Celular 2", "methods": ["MERCADO_PAGO", "TRANSFERENCIA", "MERCADO_PAGO"]}
        assert client.post("/api/points", json=new_point).status_code == 401
        created = client.post("/api/points", json=new_point, headers=pin)
        assert created.status_code == 201
        assert created.json()["methods"] == ["TRANSFERENCIA", "MERCADO_PAGO"]
        assert client.post("/api/points", json=new_point, headers=pin).status_code == 409
        assert client.post("/api/points", json={"name": "X", "methods": ["CHEQUE"]}, headers=pin).status_code == 422
        renamed = client.put(f"/api/points/{created.json()['id']}", json={**new_point, "name": "Celular de Ana"}, headers=pin)
        assert renamed.json()["name"] == "Celular de Ana"

        point_id = created.json()["id"]
        now = datetime.now(timezone.utc).isoformat()
        client.post("/api/sync", json={"type": "shift.open", "clientId": "shift-p", "payload": {"openingCash": 0, "openedAt": now, "pointId": point_id}})
        sale = client.post("/api/sync", json={"type": "sale.create", "clientId": "sale-p", "payload": {
            "turno_local_id": "shift-p", "subtotal": 9.5, "propina": 0, "total": 9.5, "metodo_pago": "MERCADO_PAGO",
            "creado_en": now, "detalles": [{"productId": 1, "name": "Arepa Pabellón", "quantity": 1, "price": 9.5}],
        }})
        assert sale.status_code == 200
        # Un punto inexistente no traba la sincronización.
        assert client.post("/api/sync", json={"type": "shift.open", "clientId": "shift-x", "payload": {"openingCash": 0, "openedAt": now, "pointId": 999}}).status_code == 200

    with sqlite3.connect(tmp_path / "test.db") as connection:
        assert connection.execute("SELECT punto_id FROM turnos WHERE uuid_local = 'shift-p'").fetchone() == (point_id,)
        assert connection.execute("SELECT punto_id FROM turnos WHERE uuid_local = 'shift-x'").fetchone() == (None,)
        assert connection.execute("SELECT punto_id, metodo_pago FROM ventas").fetchone() == (point_id, "MERCADO_PAGO")


def test_inventory_recipes_costs_and_stock_deduction(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    pin = {"X-Admin-Pin": "1234"}
    with TestClient(app) as client:
        assert client.get("/api/stock-items").status_code == 401
        assert client.get("/api/suppliers").status_code == 401

        fabrica = client.post("/api/suppliers", json={"name": "Fábrica Mr Tequeño", "taxId": "30-1234", "phone": "11 5555"}, headers=pin).json()
        assert fabrica["name"] == "Fábrica Mr Tequeño"

        tequenos = client.post("/api/stock-items", json={
            "kind": "PRODUCTO", "name": "Tequeño congelado", "unit": "unid", "minStock": 50,
            "unitCost": 100, "supplierId": fabrica["id"], "initialStock": 200,
        }, headers=pin).json()
        assert tequenos["stock"] == 200 and tequenos["supplierName"] == "Fábrica Mr Tequeño" and tequenos["low"] is False
        caja = client.post("/api/stock-items", json={"kind": "INSUMO", "name": "Caja chica", "unit": "unid", "unitCost": 80}, headers=pin).json()
        salsa = client.post("/api/stock-items", json={"kind": "INSUMO", "name": "Salsa de ajo", "unit": "l", "unitCost": 4000}, headers=pin).json()
        assert client.post("/api/stock-items", json={"kind": "OTRO", "name": "x", "unit": "unid"}, headers=pin).status_code == 422

        # Compra: suma stock y actualiza el costo al de la última compra.
        bought = client.post("/api/stock-movements", json={"itemId": caja["id"], "kind": "COMPRA", "quantity": 100, "unitCost": 90, "supplierId": fabrica["id"]}, headers=pin).json()
        assert bought["stock"] == 100 and bought["unitCost"] == 90
        client.post("/api/stock-movements", json={"itemId": salsa["id"], "kind": "COMPRA", "quantity": 2}, headers=pin)
        assert client.post("/api/stock-movements", json={"itemId": caja["id"], "kind": "COMPRA", "quantity": 0}, headers=pin).status_code == 422

        # Receta de "Tequeños (10 unidades)" (producto 5): 5 tequeños + 1 caja + 0,03 l de salsa.
        recipe = client.put("/api/products/10/recipe", json={"margin": 60, "lines": [
            {"itemId": tequenos["id"], "quantity": 5},
            {"itemId": caja["id"], "quantity": 1},
            {"itemId": salsa["id"], "quantity": 0.03},
        ]}, headers=pin).json()
        assert recipe["cost"] == 710.0  # 500 + 90 + 120
        assert recipe["suggestedPrice"] == 1140.0  # 710 × 1,6 = 1136 → redondeado a $10
        dup = client.put("/api/products/10/recipe", json={"lines": [{"itemId": caja["id"], "quantity": 1}, {"itemId": caja["id"], "quantity": 2}]}, headers=pin)
        assert dup.status_code == 422
        costs = {row["productId"]: row for row in client.get("/api/menu-costs", headers=pin).json()}
        assert costs[10]["cost"] == 710.0 and costs[1]["lines"] == []

        # Una venta de 2 unidades descuenta 10 tequeños, 2 cajas y 0,06 l de salsa.
        now = datetime.now(timezone.utc).isoformat()
        client.post("/api/sync", json={"type": "shift.open", "clientId": "s-inv", "payload": {"openingCash": 0, "openedAt": now}})
        sale = {"type": "sale.create", "clientId": "v-inv", "payload": {
            "turno_local_id": "s-inv", "subtotal": 13, "propina": 0, "total": 13, "metodo_pago": "EFECTIVO", "creado_en": now,
            "detalles": [{"productId": 10, "name": "Tequeños (10 unidades)", "quantity": 2, "price": 6.5}],
        }}
        assert client.post("/api/sync", json=sale).status_code == 200
        assert client.post("/api/sync", json=sale).json()["duplicate"] is True  # no descuenta dos veces
        stock = {item["id"]: item for item in client.get("/api/stock-items", headers=pin).json()}
        assert stock[tequenos["id"]]["stock"] == 190
        assert stock[caja["id"]]["stock"] == 98
        assert stock[salsa["id"]]["stock"] == 1.94

        # Ajuste por conteo: se registra la diferencia.
        adjusted = client.post("/api/stock-movements", json={"itemId": tequenos["id"], "kind": "AJUSTE", "quantity": 40, "note": "Conteo"}, headers=pin).json()
        assert adjusted["stock"] == 40 and adjusted["low"] is True
        movements = client.get(f"/api/stock-movements?item_id={tequenos['id']}", headers=pin).json()
        assert [(m["kind"], m["quantity"]) for m in movements] == [("AJUSTE", -150.0), ("VENTA", -10.0), ("AJUSTE", 200.0)]

        # Equipos.
        equipment = client.post("/api/equipment", json={
            "name": "Freidora industrial", "category": "Cocina", "brand": "Morelli", "status": "OPERATIVO",
            "purchaseDate": "2025-03-10", "value": 850000,
        }, headers=pin).json()
        assert equipment["purchaseDate"] == "2025-03-10" and equipment["value"] == 850000
        updated = client.put(f"/api/equipment/{equipment['id']}", json={**equipment, "status": "EN_REPARACION"}, headers=pin).json()
        assert updated["status"] == "EN_REPARACION"
        assert client.post("/api/equipment", json={"name": "X", "status": "ROTO"}, headers=pin).status_code == 422


def test_daily_and_shift_reports_by_point(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    pin = {"X-Admin-Pin": "1234"}
    with TestClient(app) as client:
        laptop, phone = client.get("/api/points").json()
        item = client.post("/api/stock-items", json={"kind": "PRODUCTO", "name": "Tequeño", "unit": "unid", "unitCost": 100, "initialStock": 100}, headers=pin).json()
        client.put("/api/products/10/recipe", json={"lines": [{"itemId": item["id"], "quantity": 5}]}, headers=pin)

        def sync(kind, client_id, payload):
            assert client.post("/api/sync", json={"type": kind, "clientId": client_id, "payload": payload}).status_code == 200

        # 27/10 en Santa Catarina (UTC-3): 13:00 local = 16:00 UTC.
        sync("shift.open", "t-laptop", {"openingCash": 1000, "openedAt": "2026-10-27T16:00:00Z", "pointId": laptop["id"]})
        sync("shift.open", "t-phone", {"openingCash": 0, "openedAt": "2026-10-27T16:05:00Z", "pointId": phone["id"]})
        sale = lambda shift, method, qty, when, tip=0: {
            "turno_local_id": shift, "subtotal": 6.5 * qty, "propina": tip, "total": 6.5 * qty + tip, "metodo_pago": method, "creado_en": when,
            "detalles": [{"productId": 10, "name": "Tequeños (10 unidades)", "quantity": qty, "price": 6.5}],
        }
        sync("sale.create", "v1", sale("t-laptop", "EFECTIVO", 2, "2026-10-27T17:00:00Z", tip=1))
        sync("sale.create", "v2", sale("t-phone", "MERCADO_PAGO", 1, "2026-10-27T18:00:00Z"))
        sync("sale.create", "v3", sale("t-phone", "TRANSFERENCIA", 1, "2026-10-28T02:30:00Z"))  # 23:30 del 27 en Argentina
        sync("sale.create", "v4", sale("t-phone", "TRANSFERENCIA", 1, "2026-10-28T03:30:00Z"))  # 00:30 del 28
        sync("shift.close", "t-laptop", {"closingCash": 1010, "closedAt": "2026-10-27T23:00:00Z"})

        assert client.get("/api/reports/daily?date=2026-10-27").status_code == 401
        report = client.get("/api/reports/daily?date=2026-10-27", headers=pin).json()
        assert report["salesCount"] == 3
        assert report["total"] == 27.0 and report["tips"] == 1.0
        assert report["cost"] == 2000.0  # 4 porciones × 5 tequeños × $100
        assert {row["name"]: row["total"] for row in report["byPoint"]} == {"Laptop principal": 14.0, "Celular 1": 13.0}
        assert {row["name"]: row["count"] for row in report["byMethod"]} == {"Efectivo": 1, "Mercado Pago": 1, "Transferencia": 1}
        assert report["products"] == [{"name": "Tequeños (10 unidades)", "quantity": 4, "total": 26.0}]
        laptop_shift = next(row for row in report["shifts"] if row["point"] == "Laptop principal")
        assert laptop_shift["openedAt"] == "13:00" and laptop_shift["expectedCash"] == 1014.0 and laptop_shift["difference"] == -4.0
        assert [row["time"] for row in report["sales"]] == ["14:00", "15:00", "23:30"]

        only_phone = client.get(f"/api/reports/daily?date=2026-10-27&point_id={phone['id']}", headers=pin).json()
        assert only_phone["salesCount"] == 2 and len(only_phone["shifts"]) == 1
        assert client.get("/api/reports/daily?date=2026-10-28", headers=pin).json()["salesCount"] == 1
        assert client.get("/api/reports/daily?date=27-10-2026", headers=pin).status_code == 422

        pdf = client.get("/api/reports/daily.pdf?date=2026-10-27", headers=pin)
        assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")
        assert 'filename="ventas-2026-10-27.pdf"' in pdf.headers["content-disposition"]
        shift_pdf = client.get(f"/api/reports/shift/{laptop_shift['id']}.pdf", headers=pin)
        assert shift_pdf.status_code == 200 and shift_pdf.content.startswith(b"%PDF")
        assert client.get("/api/reports/shift/999.pdf", headers=pin).status_code == 404
        empty = client.get("/api/reports/daily.pdf?date=2020-01-01", headers=pin)
        assert empty.status_code == 200 and empty.content.startswith(b"%PDF")


def test_deleted_product_is_archived_but_keeps_sales(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    pin = {"X-Admin-Pin": "1234"}
    with TestClient(app) as client:
        now = datetime.now(timezone.utc).isoformat()
        client.post("/api/sync", json={"type": "shift.open", "clientId": "s-del", "payload": {"openingCash": 0, "openedAt": now}})
        sale = lambda client_id: {"type": "sale.create", "clientId": client_id, "payload": {
            "turno_local_id": "s-del", "subtotal": 9.5, "propina": 0, "total": 9.5, "metodo_pago": "EFECTIVO", "creado_en": now,
            "detalles": [{"productId": 1, "name": "Arepa Pabellón", "quantity": 1, "price": 9.5}],
        }}
        assert client.post("/api/sync", json=sale("v-before")).status_code == 200

        assert client.delete("/api/products/1").status_code == 401
        assert client.delete("/api/products/1", headers=pin).json() == {"ok": True}
        assert 1 not in [product["id"] for product in client.get("/api/products").json()]
        assert 1 not in [row["productId"] for row in client.get("/api/menu-costs", headers=pin).json()]
        assert client.delete("/api/products/1", headers=pin).status_code == 404
        assert client.put("/api/products/1", json={"name": "X", "category": "Y", "price": 1}, headers=pin).status_code == 404
        assert client.get("/api/products/1/recipe", headers=pin).status_code == 404

        # Un celular sin conexión que lo vendió antes de enterarse del borrado igual sincroniza.
        assert client.post("/api/sync", json=sale("v-offline")).status_code == 200
        report = client.get("/api/reports/daily", headers=pin).json()
        assert report["products"] == [{"name": "Arepa Pabellón", "quantity": 2, "total": 19.0}]


def test_delete_stock_item_and_supplier_keep_history(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    pin = {"X-Admin-Pin": "1234"}
    with TestClient(app) as client:
        supplier = client.post("/api/suppliers", json={"name": "Distribuidora Sur"}, headers=pin).json()
        caja = client.post("/api/stock-items", json={"kind": "INSUMO", "name": "Caja", "unit": "unid", "unitCost": 80, "supplierId": supplier["id"]}, headers=pin).json()
        tequeno = client.post("/api/stock-items", json={"kind": "PRODUCTO", "name": "Tequeño", "unit": "unid", "unitCost": 100, "initialStock": 50}, headers=pin).json()
        client.post("/api/stock-movements", json={"itemId": caja["id"], "kind": "COMPRA", "quantity": 10, "supplierId": supplier["id"]}, headers=pin)
        client.put("/api/products/10/recipe", json={"lines": [{"itemId": tequeno["id"], "quantity": 5}, {"itemId": caja["id"], "quantity": 1}]}, headers=pin)

        assert client.get("/api/suppliers", headers=pin).json()[0]["itemCount"] == 1
        assert {i["name"]: i["usedIn"] for i in client.get("/api/stock-items", headers=pin).json()} == {"Caja": ["Tequeños (10 unidades)"], "Tequeño": ["Tequeños (10 unidades)"]}

        # Eliminar un insumo lo quita de las recetas (el costo baja) y conserva sus movimientos.
        assert client.delete(f"/api/stock-items/{caja['id']}").status_code == 401
        assert client.delete(f"/api/stock-items/{caja['id']}", headers=pin).json() == {"ok": True, "removedFromRecipes": ["Tequeños (10 unidades)"]}
        assert [i["name"] for i in client.get("/api/stock-items", headers=pin).json()] == ["Tequeño"]
        assert client.get("/api/products/10/recipe", headers=pin).json()["cost"] == 500.0
        assert [m["itemName"] for m in client.get("/api/stock-movements", headers=pin).json()].count("Caja") == 1
        assert client.delete(f"/api/stock-items/{caja['id']}", headers=pin).status_code == 404
        assert client.post("/api/stock-movements", json={"itemId": caja["id"], "kind": "COMPRA", "quantity": 1}, headers=pin).status_code == 404
        assert client.put("/api/products/10/recipe", json={"lines": [{"itemId": caja["id"], "quantity": 1}]}, headers=pin).status_code == 404

        # Eliminar un proveedor deja sus artículos sin proveedor y conserva las compras.
        client.put(f"/api/stock-items/{tequeno['id']}", json={"kind": "PRODUCTO", "name": "Tequeño", "unit": "unid", "unitCost": 100, "supplierId": supplier["id"]}, headers=pin)
        assert client.delete(f"/api/suppliers/{supplier['id']}", headers=pin).json() == {"ok": True, "itemsUpdated": 2}
        assert client.get("/api/suppliers", headers=pin).json() == []
        assert client.get("/api/stock-items", headers=pin).json()[0]["supplierId"] is None
        purchase = next(m for m in client.get("/api/stock-movements", headers=pin).json() if m["kind"] == "COMPRA")
        assert purchase["supplierName"] == "Distribuidora Sur"
        assert client.put(f"/api/suppliers/{supplier['id']}", json={"name": "X"}, headers=pin).status_code == 404
        assert client.post("/api/stock-items", json={"kind": "INSUMO", "name": "Y", "unit": "unid", "supplierId": supplier["id"]}, headers=pin).status_code == 404


def test_order_numbers_per_point_and_day(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}", admin_pin="1234")
    pin = {"X-Admin-Pin": "1234"}
    with TestClient(app) as client:
        laptop, phone = client.get("/api/points").json()
        assert (laptop["code"], phone["code"]) == ("A", "B")
        third = client.post("/api/points", json={"name": "Celular 2", "methods": ["QR"]}, headers=pin).json()
        assert third["code"] == "C"
        assert client.put(f"/api/points/{third['id']}", json={"name": "Celular 2", "code": "a", "methods": ["QR"]}, headers=pin).status_code == 409
        assert client.put(f"/api/points/{third['id']}", json={"name": "Celular 2", "code": "z", "methods": ["QR"]}, headers=pin).json()["code"] == "Z"
        assert client.post("/api/points", json={"name": "Raro", "code": "A-1", "methods": ["QR"]}, headers=pin).status_code == 422

        def sell(shift, client_id, number, code, when):
            return client.post("/api/sync", json={"type": "sale.create", "clientId": client_id, "payload": {
                "turno_local_id": shift, "subtotal": 9.5, "propina": 0, "total": 9.5, "metodo_pago": "QR", "creado_en": when,
                "numero_pedido": number, "codigo_pedido": code,
                "detalles": [{"productId": 1, "name": "Arepa Pabellón", "quantity": 1, "price": 9.5}],
            }})

        client.post("/api/sync", json={"type": "shift.open", "clientId": "sa", "payload": {"openingCash": 0, "openedAt": "2026-10-27T15:00:00Z", "pointId": laptop["id"]}})
        client.post("/api/sync", json={"type": "shift.open", "clientId": "sb", "payload": {"openingCash": 0, "openedAt": "2026-10-27T15:00:00Z", "pointId": phone["id"]}})
        assert sell("sa", "a1", 1, "A-001", "2026-10-27T16:00:00Z").status_code == 200
        assert sell("sa", "a2", 2, "A-002", "2026-10-27T16:05:00Z").status_code == 200
        assert sell("sb", "b1", 1, "B-001", "2026-10-27T16:01:00Z").status_code == 200
        assert sell("sb", "b-next-day", 1, "B-001", "2026-10-28T13:00:00Z").status_code == 200
        assert sell("sb", "old", None, None, "2026-10-27T16:02:00Z").status_code == 200  # dispositivo con la versión anterior

        assert client.get("/api/order-numbers?date=2026-10-27").json() == {str(laptop["id"]): 2, str(phone["id"]): 1}
        assert client.get("/api/order-numbers?date=2026-10-28").json() == {str(phone["id"]): 1}
        assert client.get("/api/order-numbers?date=ayer").status_code == 422
        orders = [row["order"] for row in client.get("/api/reports/daily?date=2026-10-27", headers=pin).json()["sales"]]
        assert orders == ["A-001", "B-001", "—", "A-002"]


def test_existing_points_get_letters_on_upgrade(tmp_path):
    database = tmp_path / "test.db"
    create_app(f"sqlite:///{database}")
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE puntos_venta SET codigo = NULL")
        connection.execute("INSERT INTO puntos_venta (nombre, medios_pago, es_activo) VALUES ('Celular viejo', 'QR', 1)")
    app = create_app(f"sqlite:///{database}")
    with TestClient(app) as client:
        assert [point["code"] for point in client.get("/api/points").json()] == ["A", "B", "C"]


def test_kitchen_comandas_print_once_and_public_ticket(tmp_path):
    app = create_app(f"sqlite:///{tmp_path / 'test.db'}")
    with TestClient(app) as client:
        laptop, phone = client.get("/api/points").json()
        now = datetime.now(timezone.utc).isoformat()

        def sell(client_id, code, shift="s-k"):
            return client.post("/api/sync", json={"type": "sale.create", "clientId": client_id, "payload": {
                "turno_local_id": shift, "subtotal": 13, "propina": 0, "total": 13, "metodo_pago": "QR", "creado_en": now,
                "numero_pedido": int(code[-3:]), "codigo_pedido": code,
                "detalles": [{"productId": 10, "name": "Tequeños <5>", "quantity": 2, "price": 6.5}],
            }})

        client.post("/api/sync", json={"type": "shift.open", "clientId": "s-k", "payload": {"openingCash": 0, "openedAt": now, "pointId": phone["id"]}})
        sell("before-station", "B-001")
        # La estación se activa ahora: lo vendido antes no se imprime.
        start = client.get("/api/comandas/last-id").json()["lastId"]
        assert start == 1
        assert client.post("/api/comandas/claim", json={"afterId": start}).json() == []

        sell("k1", "B-002")
        sell("k2", "B-003")
        first = client.post("/api/comandas/claim", json={"afterId": start}).json()
        assert [c["orderCode"] for c in first] == ["B-002", "B-003"]
        assert first[0]["point"] == "Celular 1" and first[0]["items"] == [{"name": "Tequeños <5>", "quantity": 2, "unitPrice": 6.5, "subtotal": 13.0}]
        # Una segunda estación (o la misma recargada) no vuelve a imprimirlos.
        assert client.post("/api/comandas/claim", json={"afterId": start}).json() == []
        sell("k3", "B-004")
        assert [c["orderCode"] for c in client.post("/api/comandas/claim", json={"afterId": 0}).json()] == ["B-001", "B-004"]

        recent = client.get("/api/comandas/recent").json()
        assert [c["orderCode"] for c in recent] == ["B-004", "B-003", "B-002", "B-001"]
        assert all(c["printedAt"] for c in recent)

        ticket = client.get("/ticket/k1")
        assert ticket.status_code == 200 and "B-002" in ticket.text and "Celular 1" in ticket.text
        assert "Tequeños &lt;5&gt;" in ticket.text and "<5>" not in ticket.text  # escapado
        assert "R$ 13,00" in ticket.text
        assert "todavía no está disponible" in client.get("/ticket/no-existe").text


def test_manager_pin_can_edit_but_not_delete(tmp_path):
    from fastapi.testclient import TestClient
    app = create_app(database_url=f"sqlite:///{tmp_path}/m.db", frontend_dist=None, admin_pin="1111", manager_pin="2222")
    with TestClient(app) as c:
        owner, mgr = {"X-Admin-Pin": "1111"}, {"X-Admin-Pin": "2222"}
        assert c.post("/api/admin/verify", headers={"X-Admin-Pin": "x"}).status_code == 401
        assert c.post("/api/admin/verify", headers=mgr).status_code == 200
        assert c.delete("/api/products/1", headers=mgr).status_code == 403
        assert c.put("/api/portal/settings", headers=mgr, json={}).status_code == 403
        assert c.delete("/api/products/1", headers=owner).status_code in (200, 204)


def test_pix_settings_validation_and_roles(tmp_path):
    from fastapi.testclient import TestClient
    app = create_app(database_url=f"sqlite:///{tmp_path}/p.db", frontend_dist=None, admin_pin="1111", manager_pin="2222")
    with TestClient(app) as c:
        owner = {"X-Admin-Pin": "1111"}
        assert c.get("/api/settings/pix").json()["keyType"] == "NONE"
        good = {"keyType": "CELULAR", "key": "48 98810-2993", "name": "Caraboa Express", "city": "Florianopolis", "link": ""}
        assert c.put("/api/settings/pix", json=good).status_code == 401
        assert c.put("/api/settings/pix", headers={"X-Admin-Pin": "2222"}, json=good).status_code == 403
        assert c.put("/api/settings/pix", headers=owner, json={**good, "city": ""}).status_code == 422
        assert c.put("/api/settings/pix", headers=owner, json={**good, "keyType": "CPF_CNPJ", "key": "123"}).status_code == 422
        assert c.put("/api/settings/pix", headers=owner, json={**good, "link": "ftp://x"}).status_code == 422
        assert c.put("/api/settings/pix", headers=owner, json=good).status_code == 200
        assert c.get("/api/settings/pix").json()["name"] == "Caraboa Express"


def test_shift_breakdown_and_delivery_fee(tmp_path):
    from fastapi.testclient import TestClient
    app = create_app(database_url=f"sqlite:///{tmp_path}/d.db", frontend_dist=None, admin_pin="1111")
    with TestClient(app) as c:
        opened = c.post("/api/sync", json={"type": "shift.open", "clientId": "s1", "payload": {
            "openingCash": 120.5, "openedAt": "2026-11-12T10:00:00Z", "openingBreakdown": {"100": 1, "20": 1, "0.5": 1, "x": 3}}})
        assert opened.status_code == 200
        sale = {"uuid_local": "v1", "turno_local_id": "s1", "subtotal": 25, "propina": 0, "envio": 7, "total": 32,
                "metodo_pago": "EFECTIVO", "creado_en": "2026-11-12T10:05:00Z",
                "detalles": [{"productId": 1, "name": "Pizza", "quantity": 1, "price": 25, "subtotal": 25}]}
        bad = c.post("/api/sync", json={"type": "sale.create", "clientId": "v1", "payload": {**sale, "total": 25}})
        assert bad.status_code == 409
        assert c.post("/api/sync", json={"type": "sale.create", "clientId": "v1", "payload": sale}).status_code == 200
        c.post("/api/sync", json={"type": "shift.close", "clientId": "s1", "payload": {
            "closingCash": 152.5, "closedAt": "2026-11-12T18:00:00Z", "closingBreakdown": {"100": 1, "50": 1, "2": 1, "0.5": 1}}})
        from sqlalchemy import text
        with app.state.engine.connect() as conn:
            row = conn.execute(text("select desglose_apertura, desglose_cierre from turnos")).one()
            assert '"100":1' in row[0] and "x" not in row[0] and '"0.5":1' in row[0]
            assert '"50":1' in row[1]
            assert float(conn.execute(text("select envio from ventas")).scalar_one()) == 7.0


def test_purchase_with_lines_lots_and_waste(tmp_path):
    from datetime import timedelta
    from fastapi.testclient import TestClient
    from backend.inventory import today_local
    app = create_app(database_url=f"sqlite:///{tmp_path}/c.db", frontend_dist=None, admin_pin="1111", manager_pin="2222")
    with TestClient(app) as c:
        h = {"X-Admin-Pin": "2222"}
        queso = c.post("/api/stock-items", headers=h, json={"kind": "INSUMO", "name": "Queso", "unit": "kg"}).json()
        cola = c.post("/api/stock-items", headers=h, json={"kind": "PRODUCTO", "name": "Coca-Cola", "unit": "unid"}).json()
        soon, past = (today_local() + timedelta(days=3)).isoformat(), (today_local() - timedelta(days=1)).isoformat()
        purchase = c.post("/api/purchases", headers=h, json={"account": "BANCO", "document": "F-1", "lines": [
            {"itemId": queso["id"], "quantity": 10, "lineTotal": 150, "expiresOn": soon},
            {"itemId": cola["id"], "quantity": 24, "lineTotal": 96}]})
        assert purchase.status_code == 201
        body = purchase.json()
        assert body["total"] == 246.0 and len(body["lines"]) == 2 and body["lines"][0]["unitCost"] == 15.0
        assert c.post("/api/purchases", headers=h, json={"lines": []}).status_code == 422
        assert c.post("/api/purchases", headers=h, json={"lines": [{"itemId": 999, "quantity": 1, "lineTotal": 1}]}).status_code == 404
        items = {i["name"]: i for i in c.get("/api/stock-items", headers=h).json()}
        assert items["Queso"]["stock"] == 10 and items["Queso"]["unitCost"] == 15.0
        assert items["Queso"]["expiryStatus"] == "POR_VENCER" and items["Coca-Cola"]["nextExpiry"] is None
        waste = c.post("/api/stock-waste", headers=h, json={"itemId": queso["id"], "quantity": 2, "reason": "DANADO", "note": "Se cayó"})
        assert waste.status_code == 201 and waste.json()["stock"] == 8
        assert c.post("/api/stock-waste", headers=h, json={"itemId": queso["id"], "quantity": 1, "reason": "X"}).status_code == 422
        moves = c.get("/api/stock-movements", headers=h).json()
        merma = next(m for m in moves if m["kind"] == "MERMA")
        assert merma["quantity"] == -2 and merma["reason"] == "DANADO" and merma["unitCost"] == 15.0
        c.post("/api/purchases", headers=h, json={"lines": [{"itemId": queso["id"], "quantity": 1, "lineTotal": 10, "expiresOn": past}]})
        assert {i["name"]: i for i in c.get("/api/stock-items", headers=h).json()}["Queso"]["expiryStatus"] == "VENCIDO"
        assert len(c.get("/api/purchases", headers=h).json()) == 2


def test_expenses_workers_and_summary(tmp_path):
    from fastapi.testclient import TestClient
    app = create_app(database_url=f"sqlite:///{tmp_path}/g.db", frontend_dist=None, admin_pin="1111", manager_pin="2222")
    with TestClient(app) as c:
        owner, mgr = {"X-Admin-Pin": "1111"}, {"X-Admin-Pin": "2222"}
        e = c.post("/api/expenses", headers=mgr, json={"kind": "FIJO", "category": "Alquiler", "amount": 1500, "account": "BANCO"})
        assert e.status_code == 201
        assert c.post("/api/expenses", headers=mgr, json={"kind": "VARIABLE", "category": "Bolsas", "amount": 80.5}).status_code == 201
        assert c.post("/api/expenses", headers=mgr, json={"kind": "FIJO", "category": "Luz", "amount": 0}).status_code == 422
        assert c.delete(f"/api/expenses/{e.json()['id']}", headers=mgr).status_code == 403
        ana = c.post("/api/workers", headers=mgr, json={"name": "Ana", "payType": "HORA", "rate": 12.5}).json()
        luis = c.post("/api/workers", headers=mgr, json={"name": "Luis", "payType": "DIA", "rate": 100}).json()
        done = c.post("/api/worker-payments", headers=mgr, json={"workerId": ana["id"], "units": 6, "paid": True, "account": "CAJA"}).json()
        pend = c.post("/api/worker-payments", headers=mgr, json={"workerId": luis["id"], "units": 2}).json()
        assert done["amount"] == 75.0 and not done["pending"] and pend["amount"] == 200.0 and pend["pending"]
        assert len(c.get("/api/worker-payments?pending=true", headers=mgr).json()) == 1
        assert c.put(f"/api/worker-payments/{pend['id']}/pay", headers=mgr, json={"account": "BANCO"}).json()["pending"] is False
        assert c.get("/api/expenses?month=2026-13", headers=mgr).status_code == 422
        s = c.get("/api/expenses/summary", headers=mgr).json()
        assert s["fixed"] == 1500 and s["variable"] == 80.5 and s["staffPaid"] == 275 and s["staffPending"] == 0
        assert s["total"] == 1855.5
        assert c.delete(f"/api/expenses/{e.json()['id']}", headers=owner).status_code == 200
        assert c.get("/api/expenses/summary", headers=owner).json()["fixed"] == 0


def test_finance_accounts_audit_and_shifts(tmp_path):
    from fastapi.testclient import TestClient
    app = create_app(database_url=f"sqlite:///{tmp_path}/f.db", frontend_dist=None, admin_pin="1111", manager_pin="2222")
    with TestClient(app) as c:
        owner, mgr = {"X-Admin-Pin": "1111"}, {"X-Admin-Pin": "2222"}
        c.post("/api/sync", json={"type": "shift.open", "clientId": "s1", "payload": {"openingCash": 100, "openedAt": "2026-11-12T12:00:00Z", "openingBreakdown": {"100": 1}}})
        def sale(cid, method, total):
            return c.post("/api/sync", json={"type": "sale.create", "clientId": cid, "payload": {
                "uuid_local": cid, "turno_local_id": "s1", "subtotal": total, "propina": 0, "envio": 0, "total": total,
                "metodo_pago": method, "creado_en": "2026-11-12T13:00:00Z",
                "detalles": [{"productId": 1, "name": "Pizza", "quantity": 1, "price": total, "subtotal": total}]}})
        assert sale("a", "EFECTIVO", 25).status_code == 200 and sale("b", "QR", 30).status_code == 200 and sale("m", "MERCADO_PAGO", 40).status_code == 200
        by = lambda: {a["key"]: a for a in c.get("/api/finance/accounts", headers=mgr).json()["accounts"]}
        assert (by()["CAJA"]["balance"], by()["BANCO"]["balance"], by()["MERCADOPAGO"]["balance"]) == (25, 30, 40)
        assert c.put("/api/finance/opening", headers=mgr, json={"start": "2026-11-01", "balances": {"CAJA": 100, "BANCO": 500, "MERCADOPAGO": 0}}).status_code == 403
        assert c.put("/api/finance/opening", headers=owner, json={"start": "2026-11-01", "balances": {"CAJA": 100, "BANCO": 500, "MERCADOPAGO": 0}}).status_code == 200
        assert (by()["CAJA"]["balance"], by()["BANCO"]["balance"]) == (125, 530)
        c.post("/api/expenses", headers=mgr, json={"kind": "FIJO", "category": "Luz", "amount": 20, "paidOn": "2026-11-12"})
        assert by()["CAJA"]["balance"] == 105
        assert c.post("/api/finance/transfers", headers=mgr, json={"from": "CAJA", "to": "CAJA", "amount": 5}).status_code == 422
        assert c.post("/api/finance/transfers", headers=mgr, json={"from": "CAJA", "to": "BANCO", "amount": 50}).status_code == 201
        assert (by()["CAJA"]["balance"], by()["BANCO"]["balance"]) == (55, 580)
        c.post("/api/finance/flows", headers=mgr, json={"account": "CAJA", "kind": "RETIRO", "amount": 5, "note": "Retiro del dueño"})
        result = c.post("/api/finance/audits", headers=mgr, json={"account": "CAJA", "counted": 45, "breakdown": {"20": 2, "5": 1}}).json()
        assert result["expected"] == 50 and result["difference"] == -5
        assert by()["CAJA"]["balance"] == 45
        assert c.get("/api/finance/audits", headers=mgr).json()[0]["breakdown"] == {"20": 2, "5": 1}
        kinds = [m["kind"] for m in c.get("/api/finance/movements", headers=mgr).json()]
        assert "AJUSTE_ARQUEO" in kinds and "RETIRO" in kinds and kinds.count("TRANSFERENCIA") == 2
        shifts = c.get("/api/finance/shifts", headers=mgr).json()
        assert shifts[0]["openingBreakdown"] == {"100": 1} and shifts[0]["expectedCash"] == 125


def test_users_roles_permissions_and_activity(tmp_path):
    from fastapi.testclient import TestClient
    app = create_app(database_url=f"sqlite:///{tmp_path}/u.db", frontend_dist=None, admin_pin="1111", manager_pin="2222")
    with TestClient(app) as c:
        owner = {"X-Admin-Pin": "1111"}
        assert c.get("/api/users").status_code == 401
        assert c.post("/api/users", headers=owner, json={"name": "Ana", "role": "CAJERO", "pin": "12"}).status_code == 422
        assert c.post("/api/users", headers=owner, json={"name": "Ana", "role": "CAJERO", "pin": "1111"}).status_code == 409  # igual a la del dueño
        assert c.post("/api/users", headers=owner, json={"name": "Ana", "role": "CAJERO", "pin": "3333"}).status_code == 201
        assert c.post("/api/users", headers=owner, json={"name": "Beto", "role": "CAJERO", "pin": "3333"}).status_code == 409
        beto = c.post("/api/users", headers=owner, json={"name": "Beto", "role": "ENCARGADO", "pin": "4444"}).json()
        carla = c.post("/api/users", headers=owner, json={"name": "Carla", "role": "DUENO", "pin": "5555"}).json()
        cajero, enc, dueno2 = {"X-Admin-Pin": "3333"}, {"X-Admin-Pin": "4444"}, {"X-Admin-Pin": "5555"}
        assert "pinHash" not in str(c.get("/api/users", headers=owner).json())
        who = c.post("/api/admin/verify", headers=cajero).json()
        assert who == {"ok": True, "name": "Ana", "role": "CAJERO"}
        assert c.post("/api/admin/verify", headers=enc).json()["name"] == "Beto"
        # cajero: solo pedidos online
        assert c.get("/api/portal/orders", headers=cajero).status_code == 200
        assert c.get("/api/reports/daily", headers=cajero).status_code == 403
        assert c.post("/api/expenses", headers=cajero, json={"kind": "FIJO", "category": "Luz", "amount": 5}).status_code == 403
        # encargado: carga datos, no borra ni gestiona usuarios
        assert c.post("/api/expenses", headers=enc, json={"kind": "FIJO", "category": "Luz", "amount": 5, "paidOn": "2026-11-12"}).status_code == 201
        assert c.get("/api/users", headers=enc).status_code == 403
        assert c.delete("/api/products/1", headers=enc).status_code == 403
        # segundo dueño: puede todo
        assert c.get("/api/users", headers=dueno2).status_code == 200
        # registro de acciones con el nombre
        log = c.get("/api/users/activity", headers=owner).json()
        assert any(row["user"] == "Beto" and row["action"] == "Registró gastos" for row in log)
        # desactivar corta el acceso al instante
        assert c.put(f"/api/users/{beto['id']}", headers=owner, json={"name": "Beto", "role": "ENCARGADO", "active": False}).status_code == 200
        assert c.post("/api/admin/verify", headers=enc).status_code == 401
        # cambiar la clave
        assert c.put(f"/api/users/{carla['id']}", headers=owner, json={"name": "Carla", "role": "DUENO", "pin": "6666"}).status_code == 200
        assert c.post("/api/admin/verify", headers=dueno2).status_code == 401
        assert c.post("/api/admin/verify", headers={"X-Admin-Pin": "6666"}).status_code == 200
        assert c.delete(f"/api/users/{carla['id']}", headers=owner).status_code == 200
        # demasiados intentos fallidos
        for _ in range(10):
            c.post("/api/admin/verify", headers={"X-Admin-Pin": "0000"})
        assert c.post("/api/admin/verify", headers={"X-Admin-Pin": "0000"}).status_code == 429


def test_customers_loyalty_and_rewards(tmp_path):
    from fastapi.testclient import TestClient
    app = create_app(database_url=f"sqlite:///{tmp_path}/c.db", frontend_dist=None, admin_pin="1111", manager_pin="2222")
    with TestClient(app) as c:
        own, mgr = {"X-Admin-Pin": "1111"}, {"X-Admin-Pin": "2222"}
        c.post("/api/sync", json={"type": "shift.open", "clientId": "s1", "payload": {"openingCash": 10, "openedAt": "2026-11-12T12:00:00Z"}})
        assert c.get("/api/customers").status_code == 401
        assert c.put("/api/loyalty/config", headers=mgr, json={"on": True, "every": 3}).status_code == 403  # solo el dueño
        assert c.put("/api/loyalty/config", headers=own, json={"on": True, "every": 3, "kind": "REGALO", "giftName": ""}).status_code == 422
        assert c.put("/api/loyalty/config", headers=own, json={"on": True, "every": 3, "kind": "DESCUENTO", "percent": 15}).status_code == 200

        def sale(cid, phone=None, name=None, total=25):
            payload = {"uuid_local": cid, "turno_local_id": "s1", "subtotal": total, "propina": 0, "envio": 0, "total": total,
                       "metodo_pago": "EFECTIVO", "creado_en": "2026-11-12T13:00:00Z",
                       "detalles": [{"productId": 1, "name": "Pizza", "quantity": 1, "price": total, "subtotal": total}]}
            if phone:
                payload.update({"cliente_telefono": phone, "cliente_nombre": name})
            return c.post("/api/sync", json={"type": "sale.create", "clientId": cid, "payload": payload})

        assert sale("a").status_code == 200  # sin teléfono: venta normal, sin cliente
        assert c.get("/api/customers", headers=mgr).json()["total"] == 0
        for i in range(2):
            assert sale(f"b{i}", "+55 48 98810-2993", "Ana").status_code == 200
        found = c.get("/api/customers/lookup", headers=mgr, params={"phone": "48988102993"}).json()  # mismo número escrito distinto
        assert found["name"] == "Ana" and found["orders"] == 2 and found["progress"] == 2 and found["every"] == 3 and found["rewards"] == []
        assert sale("b2", "5548988102993", "Ana").status_code == 200
        detail = c.get(f"/api/customers/{found['id']}", headers=mgr).json()
        assert detail["orders"] == 3 and detail["progress"] == 0 and detail["rewardsAvailable"] == 1
        reward = detail["rewards"][0]
        assert reward["kind"] == "DESCUENTO" and reward["percent"] == 15 and reward["code"].startswith("FID-") and reward["status"] == "DISPONIBLE"
        assert detail["topProducts"][0] == {"name": "Pizza", "quantity": 3} and len(detail["recent"]) == 3
        # duplicado de sincronización: no suma otra compra
        assert sale("b2", "5548988102993", "Ana").json()["duplicate"] is True
        assert c.get(f"/api/customers/{found['id']}", headers=mgr).json()["orders"] == 3
        # usar el premio una sola vez
        assert c.post(f"/api/loyalty/rewards/{reward['id']}/use", headers=mgr).status_code == 200
        assert c.post(f"/api/loyalty/rewards/{reward['id']}/use", headers=mgr).status_code == 409
        # preferencias y búsqueda
        assert c.put(f"/api/customers/{found['id']}", headers=mgr, json={"name": "Ana Paula", "preferences": "Sin cebolla"}).status_code == 200
        assert c.get("/api/customers", headers=mgr, params={"q": "paula"}).json()["customers"][0]["preferences"] == "Sin cebolla"
        assert c.get("/api/customers", headers=mgr, params={"q": "98810"}).json()["total"] == 1
        assert c.post("/api/customers", headers=mgr, json={"name": "Beto", "phone": "123"}).status_code == 422
        assert c.delete(f"/api/customers/{found['id']}", headers=mgr).status_code == 403
        assert c.delete(f"/api/customers/{found['id']}", headers=own).status_code == 200
