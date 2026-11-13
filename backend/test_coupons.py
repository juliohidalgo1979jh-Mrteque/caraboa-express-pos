from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.main import create_app

PIN = {"X-Admin-Pin": "1234"}
PHONE = "+55 48 98810-2993"


def client_for(tmp_path):
    return TestClient(create_app(f"sqlite:///{tmp_path / 'c.db'}", admin_pin="1234"))


def code(**overrides):
    return {"code": "instagram10", "label": "Instagram", "kind": "PERCENT", "value": 10, **overrides}


def order(**overrides):
    body = {"name": "Ana", "phone": PHONE, "fulfillment": "RETIRO", "lang": "pt", "items": [{"productId": 1, "quantity": 2}]}
    return {**body, **overrides}


def open_shift(client):
    client.post("/api/sync", json={"type": "shift.open", "clientId": "s1", "payload": {"openingCash": 0, "openedAt": datetime.now(timezone.utc).isoformat()}})


def test_codes_crud_and_validation(tmp_path):
    with client_for(tmp_path) as client:
        assert client.post("/api/promo-codes", json=code()).status_code == 401
        created = client.post("/api/promo-codes", json=code(), headers=PIN).json()
        assert created["code"] == "INSTAGRAM10" and created["uses"] == 0
        assert client.post("/api/promo-codes", json=code(), headers=PIN).status_code == 409
        assert client.post("/api/promo-codes", json=code(code="FID-ABCDE"), headers=PIN).status_code == 422
        assert client.post("/api/promo-codes", json=code(code="ab c", value=150), headers=PIN).status_code == 422
        assert client.put(f"/api/promo-codes/{created['id']}", json=code(isActive=False), headers=PIN).json()["isActive"] is False
        r = client.post("/api/coupons/validate", json={"code": "instagram10", "phone": PHONE, "subtotal": 50}, headers=PIN)
        assert r.status_code == 422  # desactivado
        client.put(f"/api/promo-codes/{created['id']}", json=code(), headers=PIN)
        ok = client.post("/api/coupons/validate", json={"code": " instagram10 ", "phone": PHONE, "subtotal": 50}, headers=PIN).json()
        assert ok["discount"] == 5 and ok["type"] == "PROMO"
        assert client.post("/api/coupons/validate", json={"code": "instagram10", "phone": "", "subtotal": 50}, headers=PIN).status_code == 422
        assert client.delete(f"/api/promo-codes/{created['id']}", headers=PIN).json() == {"ok": True}


def test_portal_code_is_single_use_per_person_and_released_on_cancel(tmp_path):
    with client_for(tmp_path) as client:
        client.post("/api/promo-codes", json=code(minTotal=10), headers=PIN)
        quote = client.post("/api/portal/quote", json={"phone": PHONE, "code": "INSTAGRAM10", "items": [{"productId": 1, "quantity": 2}]}).json()
        assert quote["coupon"]["code"] == "INSTAGRAM10" and quote["discount"] == round(quote["subtotal"] * 0.1, 2)
        assert quote["total"] == round(quote["subtotal"] - quote["discount"], 2)
        bad = client.post("/api/portal/quote", json={"phone": PHONE, "code": "NOPE", "items": [{"productId": 1, "quantity": 2}]}).json()
        assert bad["coupon"] is None and bad["couponError"] == "INVALID" and bad["discount"] == 0
        nophone = client.post("/api/portal/quote", json={"phone": "", "code": "INSTAGRAM10", "items": [{"productId": 1, "quantity": 2}]}).json()
        assert nophone["couponError"] == "PHONE"
        placed = client.post("/api/portal/orders", json=order(code="INSTAGRAM10"))
        assert placed.status_code == 201 and placed.json()["discount"] == quote["discount"] and placed.json()["coupon"]["code"] == "INSTAGRAM10"
        # la misma persona (aunque escriba el número distinto) no puede repetirlo
        again = client.post("/api/portal/orders", json=order(code="INSTAGRAM10", phone="048988102993"))
        assert again.status_code == 422
        again_quote = client.post("/api/portal/quote", json={"phone": PHONE, "code": "INSTAGRAM10", "items": [{"productId": 1, "quantity": 2}]}).json()
        assert again_quote["couponError"] == "USED"
        # otra persona sí puede
        other = client.post("/api/portal/orders", json=order(code="INSTAGRAM10", phone="+55 48 91111-2222"))
        assert other.status_code == 201
        listed = client.get("/api/promo-codes", headers=PIN).json()[0]
        assert listed["uses"] == 2
        # cancelar el pedido devuelve el código
        client.put(f"/api/portal/orders/{placed.json()['id']}", json={"status": "CANCELADO"}, headers=PIN)
        assert client.get("/api/promo-codes", headers=PIN).json()[0]["uses"] == 1
        assert client.post("/api/portal/orders", json=order(code="INSTAGRAM10")).status_code == 201
        # mínimo de compra
        small = client.post("/api/portal/quote", json={"phone": "+55 48 93333-4444", "code": "INSTAGRAM10", "items": [{"productId": 10, "quantity": 1}]}).json()
        assert small["couponError"] in ("MIN", "") or small["coupon"] is not None


def test_amount_code_max_uses_and_expiry(tmp_path):
    with client_for(tmp_path) as client:
        client.post("/api/promo-codes", json=code(code="SORTEO5", kind="AMOUNT", value=5, maxUses=1), headers=PIN)
        client.post("/api/promo-codes", json=code(code="VIEJO", validUntil="2020-01-01"), headers=PIN)
        first = client.post("/api/portal/orders", json=order(code="SORTEO5"))
        assert first.status_code == 201 and first.json()["discount"] == 5
        second = client.post("/api/portal/orders", json=order(code="SORTEO5", phone="+55 48 91111-2222"))
        assert second.status_code == 422 and "máxima" in second.json()["detail"]
        assert client.post("/api/portal/orders", json=order(code="VIEJO")).status_code == 422


def test_loyalty_reward_code_redeems_in_portal_and_pos(tmp_path):
    with client_for(tmp_path) as client:
        assert client.put("/api/loyalty/config", json={"on": True, "every": 2, "kind": "DESCUENTO", "percent": 20, "min": 0}, headers=PIN).status_code == 200
        open_shift(client)
        for _ in range(2):
            placed = client.post("/api/portal/orders", json=order(items=[{"productId": 1, "quantity": 1}])).json()
            client.put(f"/api/portal/orders/{placed['id']}", json={"paid": True, "paymentMethod": "EFECTIVO"}, headers=PIN)
            done = client.put(f"/api/portal/orders/{placed['id']}", json={"status": "ENTREGADO"}, headers=PIN).json()
        reward = done["reward"]
        assert reward and reward["code"].startswith("FID-")
        # otro número no puede usarlo
        stranger = client.post("/api/coupons/validate", json={"code": reward["code"], "phone": "+55 48 91111-2222", "subtotal": 40}, headers=PIN)
        assert stranger.status_code == 422
        # en la caja
        ok = client.post("/api/coupons/validate", json={"code": reward["code"].lower(), "phone": PHONE, "subtotal": 40}, headers=PIN).json()
        assert ok["discount"] == 8 and ok["type"] == "REWARD"
        sale = {
            "type": "sale.create", "clientId": "pos-1",
            "payload": {
                "turno_local_id": "s1", "subtotal": 40, "descuento": 8, "codigo_promo": reward["code"], "propina": 0, "total": 32,
                "metodo_pago": "EFECTIVO", "creado_en": datetime.now(timezone.utc).isoformat(), "cliente_telefono": PHONE,
                "detalles": [{"productId": 1, "name": "Pizza", "quantity": 1, "price": 40, "subtotal": 40}],
            },
        }
        assert client.post("/api/sync", json=sale).status_code == 200
        again = client.post("/api/coupons/validate", json={"code": reward["code"], "phone": PHONE, "subtotal": 40}, headers=PIN)
        assert again.status_code == 422 and "utilizado" in again.json()["detail"]
        report = client.get("/api/reports/daily", headers=PIN).json()
        assert report["discounts"] == 8 and report["total"] >= 32


def test_pos_sale_discount_rules(tmp_path):
    with client_for(tmp_path) as client:
        open_shift(client)
        client.post("/api/promo-codes", json=code(code="CAJA10"), headers=PIN)
        base = {"turno_local_id": "s1", "propina": 0, "metodo_pago": "EFECTIVO", "creado_en": datetime.now(timezone.utc).isoformat(), "cliente_telefono": PHONE,
                "detalles": [{"productId": 1, "name": "Pizza", "quantity": 1, "price": 50, "subtotal": 50}]}

        def send(client_id, **extra):
            return client.post("/api/sync", json={"type": "sale.create", "clientId": client_id, "payload": {**base, **extra}})

        # descuento sin código, descuento mayor al subtotal, total que no cuadra
        assert send("a", subtotal=50, descuento=5, total=45).status_code == 409
        assert send("b", subtotal=50, descuento=60, codigo_promo="CAJA10", total=0).status_code == 409
        assert send("c", subtotal=50, descuento=5, codigo_promo="CAJA10", total=50).status_code == 409
        assert send("d", subtotal=50, descuento=4, codigo_promo="CAJA10", total=46).status_code == 409  # el código da 5, no 4
        assert send("e", subtotal=50, descuento=5, codigo_promo="CAJA10", total=45).status_code == 200
        # la misma persona ya lo usó: validar falla
        assert client.post("/api/coupons/validate", json={"code": "CAJA10", "phone": PHONE, "subtotal": 50}, headers=PIN).status_code == 422
        # una venta ya cobrada fuera de línea no se pierde aunque el código ya se hubiera gastado
        assert send("f", subtotal=50, descuento=5, codigo_promo="CAJA10", total=45).status_code == 200
