"""Subrecetas: preparaciones reutilizables (masa, salsa) que se usan dentro de las recetas de la carta."""

from decimal import Decimal
from typing import Any, Callable, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .inventory import money
from .models import Product, RecipeSubLine, StockItem, SubRecipe, SubRecipeLine


class SubLineInput(BaseModel):
    item_id: int = Field(alias="itemId")
    quantity: Decimal = Field(gt=0, max_digits=12, decimal_places=3)


class SubRecipeInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    yield_quantity: Decimal = Field(gt=0, alias="yieldQuantity", max_digits=12, decimal_places=3)
    yield_unit: Literal["g", "ml", "unid"] = Field(alias="yieldUnit")
    lines: list[SubLineInput] = Field(min_length=1, max_length=60)


def register_subrecipe_routes(app: FastAPI, get_db: Callable[..., Any], require_admin: Callable[..., None]) -> None:
    admin = [Depends(require_admin)]

    def serialize(session: Session, sub: SubRecipe) -> dict[str, Any]:
        rows = session.execute(
            select(SubRecipeLine, StockItem).join(StockItem, SubRecipeLine.item_id == StockItem.id)
            .where(SubRecipeLine.sub_id == sub.id).order_by(StockItem.name)
        ).all()
        batch = sum((line.quantity * item.unit_cost for line, item in rows), Decimal("0"))
        used_in = [name for (name,) in session.execute(
            select(Product.name).join(RecipeSubLine, RecipeSubLine.product_id == Product.id)
            .where(RecipeSubLine.sub_id == sub.id, Product.is_deleted.is_(False)).order_by(Product.name)
        ).all()]
        return {
            "id": sub.id, "name": sub.name, "yieldQuantity": float(sub.yield_quantity), "yieldUnit": sub.yield_unit,
            "lines": [{"itemId": item.id, "name": item.name, "unit": item.unit, "quantity": float(line.quantity),
                       "unitCost": float(item.unit_cost), "lineCost": money(line.quantity * item.unit_cost)} for line, item in rows],
            "batchCost": money(batch), "unitCost": float(batch / sub.yield_quantity) if sub.yield_quantity > 0 else 0.0,
            "usedIn": used_in,
        }

    def check_lines(session: Session, data: SubRecipeInput) -> None:
        ids = [line.item_id for line in data.lines]
        if len(set(ids)) != len(ids):
            raise HTTPException(status_code=422, detail="Un insumo aparece dos veces en la subreceta")
        for item_id in ids:
            item = session.get(StockItem, item_id)
            if item is None or item.is_deleted:
                raise HTTPException(status_code=404, detail="Artículo no encontrado")

    @app.get("/api/sub-recipes", dependencies=admin)
    def list_sub_recipes(session: Session = Depends(get_db)) -> list[dict[str, Any]]:
        return [serialize(session, sub) for sub in session.scalars(select(SubRecipe).order_by(SubRecipe.name))]

    @app.post("/api/sub-recipes", status_code=201, dependencies=admin)
    def create_sub_recipe(data: SubRecipeInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        check_lines(session, data)
        sub = SubRecipe(name=data.name.strip(), yield_quantity=data.yield_quantity, yield_unit=data.yield_unit)
        session.add(sub)
        session.flush()
        session.add_all(SubRecipeLine(sub_id=sub.id, item_id=line.item_id, quantity=line.quantity) for line in data.lines)
        session.commit()
        return serialize(session, sub)

    @app.put("/api/sub-recipes/{sub_id}", dependencies=admin)
    def update_sub_recipe(sub_id: int, data: SubRecipeInput, session: Session = Depends(get_db)) -> dict[str, Any]:
        sub = session.get(SubRecipe, sub_id)
        if sub is None:
            raise HTTPException(status_code=404, detail="Subreceta no encontrada")
        check_lines(session, data)
        sub.name, sub.yield_quantity, sub.yield_unit = data.name.strip(), data.yield_quantity, data.yield_unit
        session.execute(delete(SubRecipeLine).where(SubRecipeLine.sub_id == sub.id))
        session.add_all(SubRecipeLine(sub_id=sub.id, item_id=line.item_id, quantity=line.quantity) for line in data.lines)
        session.commit()
        return serialize(session, sub)

    @app.delete("/api/sub-recipes/{sub_id}", dependencies=admin)
    def delete_sub_recipe(sub_id: int, session: Session = Depends(get_db)) -> dict[str, Any]:
        sub = session.get(SubRecipe, sub_id)
        if sub is None:
            raise HTTPException(status_code=404, detail="Subreceta no encontrada")
        removed_from = serialize(session, sub)["usedIn"]
        session.execute(delete(RecipeSubLine).where(RecipeSubLine.sub_id == sub.id))
        session.execute(delete(SubRecipeLine).where(SubRecipeLine.sub_id == sub.id))
        session.delete(sub)
        session.commit()
        return {"ok": True, "removedFromRecipes": removed_from}
