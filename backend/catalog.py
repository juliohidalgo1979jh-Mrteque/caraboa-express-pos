PRODUCTS = [
    {"id": 1, "name": "Pizza Margarita 25 cm", "category": "Pizzas", "price": 25, "symbol": "◉", "tone": "coral"},
    {"id": 2, "name": "Pizza Portuguesa 25 cm", "category": "Pizzas", "price": 25, "symbol": "◉", "tone": "gold"},
    {"id": 3, "name": "Pizza Calabresa 25 cm", "category": "Pizzas", "price": 25, "symbol": "◉", "tone": "pink"},
    {"id": 4, "name": "Pizza 4 Quesos 25 cm", "category": "Pizzas", "price": 25, "symbol": "◉", "tone": "yellow"},
    {"id": 5, "name": "Pizza Salami 25 cm", "category": "Pizzas", "price": 25, "symbol": "◉", "tone": "lavender"},
    {"id": 6, "name": "Hamburguesa normal", "category": "Hamburguesas", "price": 25, "symbol": "●", "tone": "sage"},
    {"id": 7, "name": "Hamburguesa especial", "category": "Hamburguesas", "price": 30, "symbol": "●", "tone": "lime"},
    {"id": 8, "name": "Sándwich de pollo", "category": "Sándwiches", "price": 25, "symbol": "◒", "tone": "mint"},
    {"id": 9, "name": "Sándwich de pernil", "category": "Sándwiches", "price": 25, "symbol": "◒", "tone": "cream"},
    {"id": 10, "name": "Tequeños (10 unidades)", "category": "Tequeños", "price": 20, "symbol": "▰", "tone": "blue"},
]

TONES = ("gold", "coral", "mint", "yellow", "pink", "sage", "lime", "cream", "blue", "lavender")

# Textos del portal para clientes: id de producto -> {idioma: (nombre, descripción)}.
# El español es el nombre del producto; la descripción es opcional y la completa el negocio.
TRANSLATIONS = {
    1: {"pt": ("Pizza Margarita 25 cm", ""), "en": ("Margherita Pizza 25 cm (10 in)", "")},
    2: {"pt": ("Pizza Portuguesa 25 cm", ""), "en": ("Portuguesa Pizza 25 cm (10 in)", "")},
    3: {"pt": ("Pizza Calabresa 25 cm", ""), "en": ("Calabresa (Sausage) Pizza 25 cm (10 in)", "")},
    4: {"pt": ("Pizza 4 Queijos 25 cm", ""), "en": ("4 Cheese Pizza 25 cm (10 in)", "")},
    5: {"pt": ("Pizza Salame 25 cm", ""), "en": ("Salami Pizza 25 cm (10 in)", "")},
    6: {"pt": ("Hambúrguer normal", ""), "en": ("Classic burger", "")},
    7: {"pt": ("Hambúrguer especial", ""), "en": ("Special burger", "")},
    8: {"pt": ("Sanduíche de frango", ""), "en": ("Chicken sandwich", "")},
    9: {"pt": ("Sanduíche de pernil", ""), "en": ("Roast pork sandwich", "")},
    10: {
        "es": ("", "Deditos de masa rellenos de queso, fritos."),
        "pt": ("Tequeños (10 unidades)", "Palitinhos de massa recheados com queijo, fritos."),
        "en": ("Tequeños (10 pieces)", "Fried dough sticks filled with cheese."),
    },
}
