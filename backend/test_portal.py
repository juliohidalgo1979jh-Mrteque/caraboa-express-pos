from datetime import date, timedelta

from fastapi.testclient import TestClient

from backend.main import create_app

PIN = {"X-Admin-Pin": "1234"}


def client_for(tmp_path):
    return TestClient(create_app(f"sqlite:///{tmp_path / 'portal.db'}", admin_pin="1234"))


def order(**overrides):
    body = {
        "name": "Ana", "phone": "+55 48 98810-2993", "fulfillment": "RETIRO", "lang": "pt",
        "items": [{"productId": 1, "quantity": 2}, {"productId": 10, "quantity": 1}],
    }
    return {**body, **overrides}


def promo(**overrides):
    body = {"kind": "PERCENT_FIRST", "percent": 10, "minTotal": 0, "active": True, "titleEs": "10% en tu primera compra", "titleEn": "10% off your first order"}
    return {**body, **overrides}


def test_portal_data_is_public_and_translated(tmp_path):
    with client_for(tmp_path) as client:
        data = client.get("/api/portal").json()  # sin PIN
        assert data["name"] == "Caraboa Express" and data["enabled"] is True
        assert data["whatsapp"] == "5548988102993"  # número por defecto del negocio
        pizza = next(p for p in data["products"] if p["id"] == 1)
        assert pizza["name"] == {"es": "Pizza Margarita 25 cm", "pt": "Pizza Margarita 25 cm", "en": "Margherita Pizza 25 cm (10 in)"}
        teque = next(p for p in data["products"] if p["id"] == 10)
        assert teque["description"]["en"].startswith("Fried dough sticks") and teque["description"]["es"].startswith("Deditos")
        assert data["promotions"] == []


def test_hidden_products_do_not_reach_the_portal(tmp_path):
    with client_for(tmp_path) as client:
        edited = {"name": "Pizza Margarita 25 cm", "category": "Pizzas", "price": 25, "symbol": "◉", "tone": "coral", "active": False}
        assert client.put("/api/products/1", json=edited, headers=PIN).status_code == 200
        assert 1 not in [p["id"] for p in client.get("/api/portal").json()["products"]]
        assert client.post("/api/portal/quote", json={"phone": "", "items": [{"productId": 1, "quantity": 1}]}).status_code == 422


def test_quote_uses_server_prices_and_first_order_discount(tmp_path):
    with client_for(tmp_path) as client:
        assert client.post("/api/portal/promotions", json=promo()).status_code == 401
        created = client.post("/api/portal/promotions", json=promo(), headers=PIN)
        assert created.status_code == 201
        items = [{"productId": 1, "quantity": 2}, {"productId": 10, "quantity": 1}]  # 2×25 + 20 = 70

        no_phone = client.post("/api/portal/quote", json={"phone": "", "items": items}).json()
        assert no_phone["subtotal"] == 70.0 and no_phone["discount"] == 0 and no_phone["firstOrder"] is None

        first = client.post("/api/portal/quote", json={"phone": "48 98810-2993", "items": items}).json()
        assert first["discount"] == 7.0 and first["total"] == 63.0 and first["firstOrder"] is True
        assert first["promotion"]["title"]["en"] == "10% off your first order"
        assert first["promotion"]["title"]["pt"] == "10% en tu primera compra"  # sin traducción: usa el español

        placed = client.post("/api/portal/orders", json=order())
        assert placed.status_code == 201
        body = placed.json()
        assert body["code"] == "W-0001" and body["total"] == 63.0 and body["discount"] == 7.0 and body["status"] == "NUEVO"

        # El mismo teléfono (con o sin código de país) ya no es "primera compra".
        again = client.post("/api/portal/quote", json={"phone": "5548988102993", "items": items}).json()
        assert again["firstOrder"] is False and again["discount"] == 0 and again["total"] == 70.0

        # Si cancelan el primer pedido, el cliente conserva su descuento.
        assert client.put("/api/portal/orders/1", json={"status": "CANCELADO"}, headers=PIN).status_code == 200
        assert client.post("/api/portal/quote", json={"phone": "5548988102993", "items": items}).json()["firstOrder"] is True


def test_best_single_promotion_wins_minimum_and_expiry(tmp_path):
    with client_for(tmp_path) as client:
        client.post("/api/portal/promotions", json=promo(percent=10), headers=PIN)
        client.post("/api/portal/promotions", json=promo(kind="PERCENT", percent=15, minTotal=100, titleEs="15% desde R$ 100"), headers=PIN)
        client.post("/api/portal/promotions", json=promo(kind="PERCENT", percent=50, validUntil=(date.today() - timedelta(days=3)).isoformat(), titleEs="Vencida"), headers=PIN)
        client.post("/api/portal/promotions", json=promo(kind="PERCENT", percent=50, active=False, titleEs="Apagada"), headers=PIN)
        client.post("/api/portal/promotions", json=promo(kind="INFO", percent=0, titleEs="Combo para dos", textEs="2 pizzas + 2 bebidas"), headers=PIN)

        titles = [p["title"]["es"] for p in client.get("/api/portal").json()["promotions"]]
        assert titles == ["10% en tu primera compra", "15% desde R$ 100", "Combo para dos"]  # sin vencidas ni apagadas

        small = client.post("/api/portal/quote", json={"phone": "48988102993", "items": [{"productId": 1, "quantity": 2}]}).json()
        assert small["discount"] == 5.0  # 10% de 50; la de 15% pide R$ 100
        big = client.post("/api/portal/quote", json={"phone": "48988102993", "items": [{"productId": 1, "quantity": 4}]}).json()
        assert big["discount"] == 15.0 and big["promotion"]["title"]["es"] == "15% desde R$ 100"  # no se suman: gana la mejor
        assert client.post("/api/portal/promotions", json=promo(percent=0), headers=PIN).status_code == 422


def test_order_validation_and_limits(tmp_path):
    with client_for(tmp_path) as client:
        assert client.post("/api/portal/orders", json=order(phone="123")).status_code == 422
        assert client.post("/api/portal/orders", json=order(name="   ")).status_code == 422
        assert client.post("/api/portal/orders", json=order(fulfillment="ENTREGA")).status_code == 422  # falta dirección
        assert client.post("/api/portal/orders", json=order(items=[])).status_code == 422
        assert client.post("/api/portal/orders", json=order(items=[{"productId": 1, "quantity": 0}])).status_code == 422
        assert client.post("/api/portal/orders", json=order(items=[{"productId": 999, "quantity": 1}])).status_code == 422
        delivery = client.post("/api/portal/orders", json=order(fulfillment="ENTREGA", address="Rua das Flores 12, Florianópolis", notes="Sem cebola"))
        assert delivery.status_code == 201 and delivery.json()["address"].startswith("Rua das Flores")
        pickup = client.post("/api/portal/orders", json=order(address="ignorada")).json()
        assert pickup["address"] == ""  # en retiro no se guarda dirección
        for _ in range(3):
            assert client.post("/api/portal/orders", json=order()).status_code == 201
        assert client.post("/api/portal/orders", json=order()).status_code == 429  # 5 pedidos nuevos en una hora
        # Los precios del navegador no cuentan: el servidor calcula.
        tampered = client.post("/api/portal/quote", json={"phone": "", "items": [{"productId": 1, "quantity": 1, "price": 0.01}]}).json()
        assert tampered["total"] == 25.0


def test_closed_portal_rejects_orders_and_settings_are_admin_only(tmp_path):
    with client_for(tmp_path) as client:
        assert client.get("/api/portal/settings").status_code == 401
        saved = client.put("/api/portal/settings", json={"name": "Caraboa Express", "whatsapp": "+55 48 98810-2993", "enabled": False, "infoEs": "Delivery en el centro", "infoEn": "Delivery downtown"}, headers=PIN)
        assert saved.status_code == 200 and saved.json()["whatsapp"] == "5548988102993"
        public = client.get("/api/portal").json()
        assert public["enabled"] is False and public["whatsapp"] == "5548988102993"
        assert public["info"] == {"es": "Delivery en el centro", "pt": "Delivery en el centro", "en": "Delivery downtown"}
        assert client.post("/api/portal/orders", json=order()).status_code == 409
        bad = client.put("/api/portal/settings", json={"name": "X", "whatsapp": "12"}, headers=PIN)
        assert bad.status_code == 422


def test_admin_translations_and_order_board(tmp_path):
    with client_for(tmp_path) as client:
        assert client.get("/api/portal/texts").status_code == 401
        rows = client.get("/api/portal/texts", headers=PIN).json()
        assert rows[0]["es"]["name"] == "Pizza Margarita 25 cm" and rows[0]["en"]["name"].startswith("Margherita")
        body = {"es": {"description": "Tomate, muzzarella y albahaca"}, "pt": {"name": "Pizza Margherita 25 cm", "description": "Tomate, mussarela e manjericão"}, "en": {"name": "Margherita Pizza", "description": "Tomato, mozzarella and basil"}}
        assert client.put("/api/portal/texts/1", json=body, headers=PIN).status_code == 200
        pizza = next(p for p in client.get("/api/portal").json()["products"] if p["id"] == 1)
        assert pizza["name"]["es"] == "Pizza Margarita 25 cm" and pizza["name"]["pt"] == "Pizza Margherita 25 cm"
        assert pizza["description"]["es"].startswith("Tomate, muzzarella")
        assert client.put("/api/portal/texts/999", json=body, headers=PIN).status_code == 404

        client.post("/api/portal/orders", json=order())
        client.post("/api/portal/orders", json=order(name="Bob", phone="48 91011798"))
        assert client.get("/api/portal/orders").status_code == 401
        active = client.get("/api/portal/orders", headers=PIN).json()
        assert [o["name"] for o in active] == ["Bob", "Ana"] and active[0]["items"][0]["quantity"] == 2
        assert client.put("/api/portal/orders/2", json={"status": "ENTREGADO"}, headers=PIN).json()["status"] == "ENTREGADO"
        assert client.put("/api/portal/orders/2", json={"status": "RARO"}, headers=PIN).status_code == 422
        assert [o["name"] for o in client.get("/api/portal/orders", headers=PIN).json()] == ["Ana"]
        assert len(client.get("/api/portal/orders?scope=all", headers=PIN).json()) == 2


def test_portal_page_is_served_with_absolute_preview_image(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<title>POS</title>", encoding="utf-8")
    (dist / "portal.html").write_text('<meta property="og:image" content="%BASE%/logo.png">', encoding="utf-8")
    with TestClient(create_app(f"sqlite:///{tmp_path / 'p.db'}", frontend_dist=dist, admin_pin="1234")) as client:
        page = client.get("/pedir")
        assert page.status_code == 200 and 'content="http://testserver/logo.png"' in page.text
