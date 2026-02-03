-- =====================================================
-- ESQUEMA DE BASE DE DATOS GLORIAFOOD PLATFORM
-- Cloudflare D1 (SQLite)
-- =====================================================

-- Tabla de restaurantes (soporte multi-restaurante)
CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gloriafood_id INTEGER UNIQUE,
    restaurant_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    currency TEXT DEFAULT 'USD',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de clientes
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gloriafood_id INTEGER UNIQUE,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    order_count INTEGER DEFAULT 0,
    marketing_consent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Índices para búsqueda rápida de clientes
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_gloriafood_id ON clients(gloriafood_id);

-- Tabla de direcciones de clientes
CREATE TABLE IF NOT EXISTS client_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    full_address TEXT,
    street TEXT,
    city TEXT,
    zipcode TEXT,
    bloc TEXT,
    floor TEXT,
    apartment TEXT,
    intercom TEXT,
    latitude TEXT,
    longitude TEXT,
    delivery_zone TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_addresses_client ON client_addresses(client_id);

-- Tabla de pedidos
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gloriafood_id INTEGER NOT NULL,
    pos_system_id INTEGER,
    restaurant_id INTEGER,
    client_id INTEGER,
    status TEXT DEFAULT 'accepted',
    type TEXT NOT NULL, -- 'pickup' o 'delivery'
    source TEXT,
    currency TEXT DEFAULT 'USD',
    total_price REAL NOT NULL,
    sub_total_price REAL,
    tax_value REAL DEFAULT 0,
    tax_type TEXT, -- 'NET' o 'GROSS'
    tax_name TEXT,
    payment_method TEXT, -- 'CASH', 'ONLINE', 'CARD', 'CARD_PHONE'
    payment_status TEXT DEFAULT 'pending',
    instructions TEXT,
    fulfill_at TEXT,
    accepted_at TEXT,
    for_later INTEGER DEFAULT 0,
    pin_skipped INTEGER DEFAULT 0,
    -- Datos de entrega
    delivery_fee REAL DEFAULT 0,
    delivery_address TEXT,
    delivery_latitude TEXT,
    delivery_longitude TEXT,
    delivery_zone TEXT,
    outside_delivery_area INTEGER DEFAULT 0,
    -- Propina
    tip_amount REAL DEFAULT 0,
    -- Metadatos
    raw_payload TEXT, -- JSON completo original
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
    FOREIGN KEY (client_id) REFERENCES clients(id),
    UNIQUE(gloriafood_id, pos_system_id)
);

-- Índices para pedidos
CREATE INDEX IF NOT EXISTS idx_orders_gloriafood ON orders(gloriafood_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_fulfill ON orders(fulfill_at);

-- Tabla de items de pedido
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    gloriafood_id INTEGER,
    parent_id INTEGER, -- Para items anidados
    name TEXT NOT NULL,
    type TEXT DEFAULT 'item', -- 'item', 'delivery_fee', 'tip', 'promo_cart', etc.
    type_id INTEGER,
    quantity INTEGER DEFAULT 1,
    price REAL NOT NULL,
    total_price REAL NOT NULL,
    tax_rate REAL DEFAULT 0,
    tax_value REAL DEFAULT 0,
    tax_type TEXT,
    item_discount REAL DEFAULT 0,
    cart_discount REAL DEFAULT 0,
    cart_discount_rate REAL DEFAULT 0,
    instructions TEXT,
    kitchen_internal_name TEXT,
    coupon TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES order_items(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Tabla de opciones de items
CREATE TABLE IF NOT EXISTS order_item_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_item_id INTEGER NOT NULL,
    gloriafood_id INTEGER,
    name TEXT NOT NULL,
    group_name TEXT,
    type TEXT, -- 'size' o 'option'
    type_id INTEGER,
    quantity INTEGER DEFAULT 1,
    price REAL DEFAULT 0,
    kitchen_internal_name TEXT,
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_options_item ON order_item_options(order_item_id);

-- Tabla de cupones usados
CREATE TABLE IF NOT EXISTS order_coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    coupon_code TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Tabla de impuestos por pedido
CREATE TABLE IF NOT EXISTS order_taxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    type TEXT, -- 'item', 'delivery_fee', 'tip', etc.
    rate REAL,
    value REAL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- =====================================================
-- TABLAS DE MENÚ
-- =====================================================

-- Tabla de menús
CREATE TABLE IF NOT EXISTS menus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gloriafood_id INTEGER UNIQUE,
    restaurant_id INTEGER,
    currency TEXT DEFAULT 'USD',
    active INTEGER DEFAULT 1,
    synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
);

-- Tabla de categorías
CREATE TABLE IF NOT EXISTS menu_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    gloriafood_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_categories_menu ON menu_categories(menu_id);

-- Tabla de items del menú
CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    gloriafood_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    kitchen_internal_name TEXT,
    order_types TEXT, -- JSON array: ["pickup", "delivery"]
    tags TEXT, -- JSON array: ["VEGETARIAN", "VEGAN", etc.]
    allergens TEXT, -- JSON array de alérgenos
    nutritional_values TEXT, -- JSON object
    image_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES menu_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_gloriafood ON menu_items(gloriafood_id);

-- Tabla de tamaños de items
CREATE TABLE IF NOT EXISTS menu_item_sizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    gloriafood_id INTEGER,
    name TEXT NOT NULL,
    price REAL DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sizes_item ON menu_item_sizes(item_id);

-- Tabla de grupos de opciones
CREATE TABLE IF NOT EXISTS menu_option_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gloriafood_id INTEGER,
    name TEXT NOT NULL,
    required INTEGER DEFAULT 0,
    allow_quantity INTEGER DEFAULT 0,
    force_min INTEGER DEFAULT 0,
    force_max INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de relación entre items/sizes y grupos de opciones
CREATE TABLE IF NOT EXISTS menu_item_option_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    size_id INTEGER,
    option_group_id INTEGER NOT NULL,
    FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (size_id) REFERENCES menu_item_sizes(id) ON DELETE CASCADE,
    FOREIGN KEY (option_group_id) REFERENCES menu_option_groups(id) ON DELETE CASCADE
);

-- Tabla de opciones
CREATE TABLE IF NOT EXISTS menu_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    option_group_id INTEGER NOT NULL,
    gloriafood_id INTEGER,
    name TEXT NOT NULL,
    price REAL DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    kitchen_internal_name TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (option_group_id) REFERENCES menu_option_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_options_group ON menu_options(option_group_id);

-- =====================================================
-- TABLAS DE DATOS DE FACTURACIÓN
-- =====================================================

CREATE TABLE IF NOT EXISTS billing_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE,
    type TEXT, -- 'personal' o 'company'
    company_name TEXT,
    cui TEXT,
    reg_com TEXT,
    person_name TEXT,
    person_type TEXT,
    document_type TEXT,
    document_number TEXT,
    address TEXT,
    city TEXT,
    region TEXT,
    sector TEXT,
    country_code TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- =====================================================
-- TABLA DE LOGS/EVENTOS
-- =====================================================

CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL, -- 'order_received', 'menu_sync', 'error'
    payload TEXT,
    status TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_type ON webhook_logs(event_type);

-- =====================================================
-- VISTAS ÚTILES
-- =====================================================

-- Vista de pedidos con información del cliente
CREATE VIEW IF NOT EXISTS v_orders_with_clients AS
SELECT
    o.*,
    c.first_name as client_first_name,
    c.last_name as client_last_name,
    c.email as client_email,
    c.phone as client_phone,
    c.order_count as client_total_orders,
    r.name as restaurant_name
FROM orders o
LEFT JOIN clients c ON o.client_id = c.id
LEFT JOIN restaurants r ON o.restaurant_id = r.id;

-- Vista de estadísticas por día
CREATE VIEW IF NOT EXISTS v_daily_stats AS
SELECT
    DATE(created_at) as date,
    restaurant_id,
    COUNT(*) as total_orders,
    SUM(total_price) as total_revenue,
    SUM(CASE WHEN type = 'delivery' THEN 1 ELSE 0 END) as delivery_orders,
    SUM(CASE WHEN type = 'pickup' THEN 1 ELSE 0 END) as pickup_orders,
    AVG(total_price) as avg_order_value
FROM orders
GROUP BY DATE(created_at), restaurant_id;
