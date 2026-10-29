-- TABLA: Clientes
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(20),
    email VARCHAR(100),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLA: Categorias
CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL
);

-- TABLA: Productos
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    categoria_id INT REFERENCES categorias(id),
    nombre VARCHAR(100) NOT NULL,
    precio_base DECIMAL(10, 2) NOT NULL,
    es_activo BOOLEAN DEFAULT TRUE
);

-- TABLA: Ingredientes (Insumos)
CREATE TABLE ingredientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    unidad_medida VARCHAR(10) NOT NULL, -- 'gr', 'ml', 'unid'
    costo_unidad DECIMAL(10, 4) NOT NULL,
    stock_actual DECIMAL(10, 2) DEFAULT 0,
    stock_minimo DECIMAL(10, 2) DEFAULT 0
);

-- TABLA: Recetas (BOM - Bill of Materials)
CREATE TABLE recetas (
    id SERIAL PRIMARY KEY,
    producto_id INT REFERENCES productos(id) ON DELETE CASCADE,
    ingrediente_id INT REFERENCES ingredientes(id),
    cantidad DECIMAL(10, 4) NOT NULL,
    UNIQUE(producto_id, ingrediente_id)
);

-- TABLA: Turnos / Cajas
CREATE TABLE turnos (
    id SERIAL PRIMARY KEY,
    uuid_local VARCHAR(36) UNIQUE,
    monto_inicial DECIMAL(10, 2) NOT NULL,
    monto_final_real DECIMAL(10, 2),
    fecha_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP,
    estado VARCHAR(20) DEFAULT 'ABIERTO' -- 'ABIERTO', 'CERRADO'
);

-- TABLA: Ventas
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    turno_id INT REFERENCES turnos(id),
    cliente_id INT REFERENCES clientes(id),
    subtotal DECIMAL(10, 2) NOT NULL,
    descuento DECIMAL(10, 2) DEFAULT 0,
    total DECIMAL(10, 2) NOT NULL,
    propina DECIMAL(10, 2) DEFAULT 0,
    metodo_pago VARCHAR(20) NOT NULL, -- 'EFECTIVO', 'TARJETA', 'QR'
    es_offline BOOLEAN DEFAULT FALSE,
    uuid_local VARCHAR(36) UNIQUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TABLA: DetalleVenta
CREATE TABLE detalle_venta (
    id SERIAL PRIMARY KEY,
    venta_id INT REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id INT REFERENCES productos(id),
    nombre_producto VARCHAR(100) NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    modificadores JSONB -- Guarda notas tipo: {"sin": "cebolla", "extra": "queso"}
);

-- TABLA: Gastos
CREATE TABLE gastos (
    id SERIAL PRIMARY KEY,
    turno_id INT REFERENCES turnos(id),
    categoria VARCHAR(50) NOT NULL, -- 'GAS', 'COMBUSTIBLE', 'INSUMOS_EXTRA'
    monto DECIMAL(10, 2) NOT NULL,
    descripcion TEXT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);