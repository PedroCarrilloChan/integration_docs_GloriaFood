# GloriaFood Platform - Cloudflare Workers

Plataforma completa de integración con GloriaFood API usando Cloudflare Workers, D1 (SQLite) y KV.

## Características

- **Recepción de Pedidos**: Webhook (push) y polling manual
- **Gestión de Clientes**: Base de datos de clientes con historial
- **Sincronización de Menú**: Automática cada 6 horas o manual
- **Dashboard**: Panel de administración web incluido
- **Estadísticas**: Ventas, productos más vendidos, métodos de pago

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Webhook   │  │   REST API  │  │    Cron (cada 6h)       │ │
│  │   /webhook  │  │   /api/*    │  │   Menu Sync             │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                      │               │
│         └────────────────┼──────────────────────┘               │
│                          │                                      │
│  ┌───────────────────────┴───────────────────────────────────┐ │
│  │                     Services                               │ │
│  │  OrdersService │ MenuService │ ClientsService │ StatsService│
│  └───────────────────────┬───────────────────────────────────┘ │
│                          │                                      │
│  ┌───────────────────────┴───────────────────────────────────┐ │
│  │              Cloudflare D1 (SQLite)                        │ │
│  │  orders │ clients │ menu_items │ order_items │ etc.        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Cloudflare KV (Cache)                         │ │
│  │  menu:full │ dashboard:stats                               │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Requisitos

- Cuenta de Cloudflare con Workers habilitado
- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)

## Instalación

### 1. Clonar e instalar dependencias

```bash
cd gloriafood-platform
npm install
```

### 2. Autenticarse en Cloudflare

```bash
wrangler login
```

### 3. Crear recursos en Cloudflare

```bash
# Crear base de datos D1
wrangler d1 create gloriafood-db

# Crear KV namespace para caché
wrangler kv:namespace create CACHE
```

### 4. Actualizar wrangler.toml

Copia los IDs generados al archivo `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "gloriafood-db"
database_id = "TU_DATABASE_ID_AQUI"

[[kv_namespaces]]
binding = "CACHE"
id = "TU_KV_ID_AQUI"
```

### 5. Ejecutar migraciones

```bash
# Local (desarrollo)
npm run db:migrate

# Producción
npm run db:migrate:prod
```

### 6. Configurar secrets

```bash
# Clave de autenticación de GloriaFood (de Admin Panel → Others → 3rd party integrations)
wrangler secret put GLORIAFOOD_SECRET_KEY

# Master key para validar webhooks (la obtienes de GloriaFood)
wrangler secret put GLORIAFOOD_MASTER_KEY

# Token para proteger tu API (genera uno seguro)
wrangler secret put API_AUTH_TOKEN
```

### 7. Desplegar

```bash
# Desarrollo local
npm run dev

# Producción
npm run deploy
```

## Configuración en GloriaFood

### Para Webhook (Push)

1. Ve a **Admin Panel → Integrations**
2. Selecciona **"Push Accepted Order"**
3. Configura tu URL: `https://tu-worker.tu-cuenta.workers.dev/webhook/orders`
4. Selecciona formato: **JSON**
5. Guarda y copia el **Master Key**

### Para Polling

No requiere configuración adicional en GloriaFood, solo necesitas la `secret_key` del restaurante.

## API Endpoints

### Autenticación

Todas las rutas `/api/*` requieren el header:
```
Authorization: Bearer TU_API_AUTH_TOKEN
```

### Pedidos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/orders` | Lista pedidos (paginado) |
| `GET` | `/api/orders/:id` | Detalle de pedido |
| `PUT` | `/api/orders/:id/status` | Actualizar estado |
| `POST` | `/api/orders/poll` | Polling manual de GloriaFood |

**Parámetros de lista:**
- `page` (default: 1)
- `limit` (default: 20)
- `type` (pickup/delivery)
- `status`
- `date_from`, `date_to`

### Menú

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/menu` | Menú completo |
| `GET` | `/api/menu/categories` | Lista categorías |
| `GET` | `/api/menu/categories/:id/items` | Items de categoría |
| `GET` | `/api/menu/search?q=query` | Buscar items |
| `POST` | `/api/menu/sync` | Sincronizar desde GloriaFood |

### Clientes

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/clients` | Lista clientes (paginado) |
| `GET` | `/api/clients/:id` | Detalle con historial |
| `GET` | `/api/clients/top` | Mejores clientes |
| `GET` | `/api/clients/marketing` | Clientes con consentimiento |
| `GET` | `/api/clients/stats` | Estadísticas generales |
| `PUT` | `/api/clients/:id` | Actualizar cliente |

### Estadísticas

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/stats/dashboard` | Resumen para dashboard |
| `GET` | `/api/stats/sales/daily` | Ventas por día |
| `GET` | `/api/stats/sales/hourly` | Ventas por hora |
| `GET` | `/api/stats/products/top` | Productos más vendidos |
| `GET` | `/api/stats/payments` | Por método de pago |
| `GET` | `/api/stats/delivery-zones` | Por zona de entrega |

### Logs

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/logs` | Logs de webhooks |

## Dashboard

El dashboard web está en la carpeta `dashboard/`. Puedes:

1. **Servirlo desde Cloudflare Pages:**
   ```bash
   cd dashboard
   wrangler pages deploy . --project-name gloriafood-dashboard
   ```

2. **Abrirlo localmente:** Solo abre `dashboard/index.html` en tu navegador

Al abrir el dashboard, te pedirá el API Token que configuraste.

## Estructura de Archivos

```
gloriafood-platform/
├── src/
│   ├── index.ts              # Entry point con rutas
│   ├── types.ts              # Definiciones TypeScript
│   └── services/
│       ├── gloriafood-client.ts  # Cliente API GloriaFood
│       ├── orders.ts             # Servicio de pedidos
│       ├── menu.ts               # Servicio de menú
│       ├── clients.ts            # Servicio de clientes
│       └── stats.ts              # Servicio de estadísticas
├── schema/
│   └── migrations.sql        # Esquema de base de datos
├── dashboard/
│   └── index.html            # Dashboard web
├── wrangler.toml             # Configuración Cloudflare
├── package.json
├── tsconfig.json
└── README.md
```

## Modelo de Datos

### Tablas Principales

- **restaurants**: Multi-restaurante
- **clients**: Clientes con datos de contacto
- **client_addresses**: Direcciones de entrega
- **orders**: Pedidos con toda la información
- **order_items**: Items de cada pedido
- **order_item_options**: Opciones (tamaños, extras)
- **menus**: Menús sincronizados
- **menu_categories**: Categorías
- **menu_items**: Productos
- **menu_item_sizes**: Tamaños disponibles
- **menu_option_groups**: Grupos de opciones
- **menu_options**: Opciones individuales
- **webhook_logs**: Registro de eventos

### Vistas

- **v_orders_with_clients**: Pedidos con info de cliente
- **v_daily_stats**: Estadísticas diarias

## Cron Jobs

El worker incluye un cron que sincroniza el menú cada 6 horas:

```toml
[triggers]
crons = ["0 */6 * * *"]
```

## Deduplicación de Pedidos

El sistema detecta pedidos duplicados usando la combinación `gloriafood_id` + `pos_system_id`. Si recibes el mismo pedido dos veces, solo se guarda una vez.

## Costos Estimados (Cloudflare)

- **Workers**: 100,000 requests/día gratis
- **D1**: 5M rows read/día gratis, 100K writes/día gratis
- **KV**: 100,000 reads/día gratis, 1,000 writes/día gratis

Para un restaurante típico, el plan gratuito debería ser suficiente.

## Soporte

Si tienes problemas:
1. Revisa los logs: `wrangler tail`
2. Consulta los webhook_logs en la API: `GET /api/logs`
3. Verifica que los secrets estén configurados: `wrangler secret list`

## Licencia

MIT
