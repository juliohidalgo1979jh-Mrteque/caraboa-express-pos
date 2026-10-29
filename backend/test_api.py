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
        assert len(menu) == 12
        assert menu[0] == {
            "id": 1, "name": "Arepa Pabellón", "category": "Arepas", "price": 9.5,
            "symbol": "◉", "tone": "gold", "active": True, "image": None,
        }

        new_product = {"name": "Tequeños de guayaba", "category": "Tequeños", "price": 7.25, "symbol": "▰", "tone": "pink"}
        assert client.post("/api/products", json=new_product).status_code == 401
        assert client.post("/api/products", json=new_product, headers={"X-Admin-Pin": "0000"}).status_code == 401
        assert client.post("/api/admin/verify", headers={"X-Admin-Pin": "1234"}).status_code == 200

        created = client.post("/api/products", json=new_product, headers={"X-Admin-Pin": "1234"})
        assert created.status_code == 201
        assert created.json()["id"] == 13
        assert created.json()["category"] == "Tequeños"

        edited = {**new_product, "name": "Tequeños de guayaba (6)", "price": 8, "active": False}
        response = client.put("/api/products/13", json=edited, headers={"X-Admin-Pin": "1234"})
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
            "tagline": "MARTES DE ANTOJO",
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
        assert points[0]["methods"] == ["EFECTIVO"]

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

        # Receta de "Tequeños (5)" (producto 5): 5 tequeños + 1 caja + 0,03 l de salsa.
        recipe = client.put("/api/products/5/recipe", json={"margin": 60, "lines": [
            {"itemId": tequenos["id"], "quantity": 5},
            {"itemId": caja["id"], "quantity": 1},
            {"itemId": salsa["id"], "quantity": 0.03},
        ]}, headers=pin).json()
        assert recipe["cost"] == 710.0  # 500 + 90 + 120
        assert recipe["suggestedPrice"] == 1140.0  # 710 × 1,6 = 1136 → redondeado a $10
        dup = client.put("/api/products/5/recipe", json={"lines": [{"itemId": caja["id"], "quantity": 1}, {"itemId": caja["id"], "quantity": 2}]}, headers=pin)
        assert dup.status_code == 422
        costs = {row["productId"]: row for row in client.get("/api/menu-costs", headers=pin).json()}
        assert costs[5]["cost"] == 710.0 and costs[1]["lines"] == []

        # Una venta de 2 unidades descuenta 10 tequeños, 2 cajas y 0,06 l de salsa.
        now = datetime.now(timezone.utc).isoformat()
        client.post("/api/sync", json={"type": "shift.open", "clientId": "s-inv", "payload": {"openingCash": 0, "openedAt": now}})
        sale = {"type": "sale.create", "clientId": "v-inv", "payload": {
            "turno_local_id": "s-inv", "subtotal": 13, "propina": 0, "total": 13, "metodo_pago": "EFECTIVO", "creado_en": now,
            "detalles": [{"productId": 5, "name": "Tequeños (5)", "quantity": 2, "price": 6.5}],
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
        client.put("/api/products/5/recipe", json={"lines": [{"itemId": item["id"], "quantity": 5}]}, headers=pin)

        def sync(kind, client_id, payload):
            assert client.post("/api/sync", json={"type": kind, "clientId": client_id, "payload": payload}).status_code == 200

        # 27/10 en Argentina (UTC-3): 13:00 local = 16:00 UTC.
        sync("shift.open", "t-laptop", {"openingCash": 1000, "openedAt": "2026-10-27T16:00:00Z", "pointId": laptop["id"]})
        sync("shift.open", "t-phone", {"openingCash": 0, "openedAt": "2026-10-27T16:05:00Z", "pointId": phone["id"]})
        sale = lambda shift, method, qty, when, tip=0: {
            "turno_local_id": shift, "subtotal": 6.5 * qty, "propina": tip, "total": 6.5 * qty + tip, "metodo_pago": method, "creado_en": when,
            "detalles": [{"productId": 5, "name": "Tequeños (5)", "quantity": qty, "price": 6.5}],
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
        assert report["products"] == [{"name": "Tequeños (5)", "quantity": 4, "total": 26.0}]
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
        client.put("/api/products/5/recipe", json={"lines": [{"itemId": tequeno["id"], "quantity": 5}, {"itemId": caja["id"], "quantity": 1}]}, headers=pin)

        assert client.get("/api/suppliers", headers=pin).json()[0]["itemCount"] == 1
        assert {i["name"]: i["usedIn"] for i in client.get("/api/stock-items", headers=pin).json()} == {"Caja": ["Tequeños (5)"], "Tequeño": ["Tequeños (5)"]}

        # Eliminar un insumo lo quita de las recetas (el costo baja) y conserva sus movimientos.
        assert client.delete(f"/api/stock-items/{caja['id']}").status_code == 401
        assert client.delete(f"/api/stock-items/{caja['id']}", headers=pin).json() == {"ok": True, "removedFromRecipes": ["Tequeños (5)"]}
        assert [i["name"] for i in client.get("/api/stock-items", headers=pin).json()] == ["Tequeño"]
        assert client.get("/api/products/5/recipe", headers=pin).json()["cost"] == 500.0
        assert [m["itemName"] for m in client.get("/api/stock-movements", headers=pin).json()].count("Caja") == 1
        assert client.delete(f"/api/stock-items/{caja['id']}", headers=pin).status_code == 404
        assert client.post("/api/stock-movements", json={"itemId": caja["id"], "kind": "COMPRA", "quantity": 1}, headers=pin).status_code == 404
        assert client.put("/api/products/5/recipe", json={"lines": [{"itemId": caja["id"], "quantity": 1}]}, headers=pin).status_code == 404

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
                "detalles": [{"productId": 5, "name": "Tequeños <5>", "quantity": 2, "price": 6.5}],
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
        assert "$ 13,00" in ticket.text
        assert "todavía no está disponible" in client.get("/ticket/no-existe").text
