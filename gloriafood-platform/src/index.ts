import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, GloriaFoodOrderResponse } from './types';
import { GloriaFoodClient } from './services/gloriafood-client';
import { OrdersService } from './services/orders';
import { MenuService } from './services/menu';
import { ClientsService } from './services/clients';
import { StatsService } from './services/stats';

const app = new Hono<{ Bindings: Env }>();

// Middlewares
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware de autenticación para rutas protegidas
const authMiddleware = async (c: any, next: () => Promise<void>) => {
  const authHeader = c.req.header('Authorization');
  const apiToken = c.env.API_AUTH_TOKEN;

  // Permitir webhook de GloriaFood con master key
  if (c.req.path === '/webhook/orders') {
    return next();
  }

  if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  return next();
};

// =====================================================
// RUTAS PÚBLICAS
// =====================================================

app.get('/', (c) => {
  return c.json({
    name: 'GloriaFood Platform API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      webhook: 'POST /webhook/orders',
      orders: 'GET /api/orders',
      menu: 'GET /api/menu',
      clients: 'GET /api/clients',
      stats: 'GET /api/stats/dashboard'
    }
  });
});

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =====================================================
// WEBHOOK - Recepción de pedidos de GloriaFood (PUSH)
// =====================================================

app.post('/webhook/orders', async (c) => {
  const env = c.env;

  // Validar que la solicitud viene de GloriaFood
  const authHeader = c.req.header('Authorization');
  if (!GloriaFoodClient.validateWebhookRequest(authHeader, env.GLORIAFOOD_MASTER_KEY)) {
    // Log del intento fallido
    await env.DB.prepare(
      "INSERT INTO webhook_logs (event_type, payload, status, error_message) VALUES (?, ?, ?, ?)"
    ).bind('order_received', 'unauthorized', 'error', 'Invalid master key').run();

    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await c.req.json<GloriaFoodOrderResponse>();
    const ordersService = new OrdersService(env);

    const results = [];
    for (const order of payload.orders) {
      const result = await ordersService.processOrder(order);
      results.push({
        gloriafood_id: order.id,
        internal_id: result.orderId,
        is_new: result.isNew
      });
    }

    // Log exitoso
    await env.DB.prepare(
      "INSERT INTO webhook_logs (event_type, payload, status) VALUES (?, ?, ?)"
    ).bind('order_received', JSON.stringify({ count: payload.count, orders: results }), 'success').run();

    return c.json({
      success: true,
      message: `Processed ${results.length} orders`,
      data: results
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await env.DB.prepare(
      "INSERT INTO webhook_logs (event_type, payload, status, error_message) VALUES (?, ?, ?, ?)"
    ).bind('order_received', 'error', 'error', errorMessage).run();

    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// =====================================================
// API DE PEDIDOS
// =====================================================

app.get('/api/orders', authMiddleware, async (c) => {
  const env = c.env;
  const ordersService = new OrdersService(env);

  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const status = c.req.query('status');
  const type = c.req.query('type') as 'pickup' | 'delivery' | undefined;
  const dateFrom = c.req.query('date_from');
  const dateTo = c.req.query('date_to');

  const { orders, total } = await ordersService.getOrders(page, limit, {
    status,
    type,
    dateFrom,
    dateTo
  });

  return c.json({
    success: true,
    data: orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});

app.get('/api/orders/:id', authMiddleware, async (c) => {
  const env = c.env;
  const ordersService = new OrdersService(env);
  const id = parseInt(c.req.param('id'));

  const result = await ordersService.getOrderWithDetails(id);

  if (!result) {
    return c.json({ success: false, error: 'Order not found' }, 404);
  }

  return c.json({ success: true, data: result });
});

app.put('/api/orders/:id/status', authMiddleware, async (c) => {
  const env = c.env;
  const ordersService = new OrdersService(env);
  const id = parseInt(c.req.param('id'));

  const body = await c.req.json<{ status: string }>();
  const updated = await ordersService.updateOrderStatus(id, body.status);

  if (!updated) {
    return c.json({ success: false, error: 'Order not found' }, 404);
  }

  return c.json({ success: true, message: 'Status updated' });
});

// Polling manual de pedidos (alternativa al webhook)
app.post('/api/orders/poll', authMiddleware, async (c) => {
  const env = c.env;
  const gloriaFood = new GloriaFoodClient(env);
  const ordersService = new OrdersService(env);

  try {
    const response = await gloriaFood.pollOrders();
    const results = [];

    for (const order of response.orders) {
      const result = await ordersService.processOrder(order);
      results.push({
        gloriafood_id: order.id,
        internal_id: result.orderId,
        is_new: result.isNew
      });
    }

    return c.json({
      success: true,
      message: `Polled and processed ${results.length} orders`,
      data: results
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// =====================================================
// API DE MENÚ
// =====================================================

app.get('/api/menu', authMiddleware, async (c) => {
  const env = c.env;
  const menuService = new MenuService(env);

  const menu = await menuService.getFullMenu();

  if (!menu) {
    return c.json({
      success: false,
      error: 'Menu not found. Please sync first with POST /api/menu/sync'
    }, 404);
  }

  return c.json({ success: true, data: menu });
});

app.get('/api/menu/categories', authMiddleware, async (c) => {
  const env = c.env;
  const menuService = new MenuService(env);

  const categories = await menuService.getCategories();
  return c.json({ success: true, data: categories });
});

app.get('/api/menu/categories/:id/items', authMiddleware, async (c) => {
  const env = c.env;
  const menuService = new MenuService(env);
  const categoryId = parseInt(c.req.param('id'));

  const items = await menuService.getItemsByCategory(categoryId);
  return c.json({ success: true, data: items });
});

app.get('/api/menu/search', authMiddleware, async (c) => {
  const env = c.env;
  const menuService = new MenuService(env);
  const query = c.req.query('q') || '';

  if (query.length < 2) {
    return c.json({ success: false, error: 'Query must be at least 2 characters' }, 400);
  }

  const items = await menuService.searchItems(query);
  return c.json({ success: true, data: items });
});

app.post('/api/menu/sync', authMiddleware, async (c) => {
  const env = c.env;
  const menuService = new MenuService(env);

  try {
    const result = await menuService.syncMenu();
    return c.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: errorMessage }, 500);
  }
});

// =====================================================
// API DE CLIENTES
// =====================================================

app.get('/api/clients', authMiddleware, async (c) => {
  const env = c.env;
  const clientsService = new ClientsService(env);

  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const search = c.req.query('search');

  const { clients, total } = await clientsService.getClients(page, limit, search);

  return c.json({
    success: true,
    data: clients,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});

app.get('/api/clients/top', authMiddleware, async (c) => {
  const env = c.env;
  const clientsService = new ClientsService(env);

  const limit = parseInt(c.req.query('limit') || '10');
  const clients = await clientsService.getTopClients(limit);

  return c.json({ success: true, data: clients });
});

app.get('/api/clients/marketing', authMiddleware, async (c) => {
  const env = c.env;
  const clientsService = new ClientsService(env);

  const clients = await clientsService.getMarketingClients();
  return c.json({ success: true, data: clients });
});

app.get('/api/clients/stats', authMiddleware, async (c) => {
  const env = c.env;
  const clientsService = new ClientsService(env);

  const stats = await clientsService.getClientsStats();
  return c.json({ success: true, data: stats });
});

app.get('/api/clients/:id', authMiddleware, async (c) => {
  const env = c.env;
  const clientsService = new ClientsService(env);
  const id = parseInt(c.req.param('id'));

  const result = await clientsService.getClientWithDetails(id);

  if (!result) {
    return c.json({ success: false, error: 'Client not found' }, 404);
  }

  return c.json({ success: true, data: result });
});

app.put('/api/clients/:id', authMiddleware, async (c) => {
  const env = c.env;
  const clientsService = new ClientsService(env);
  const id = parseInt(c.req.param('id'));

  const body = await c.req.json();
  const updated = await clientsService.updateClient(id, body);

  if (!updated) {
    return c.json({ success: false, error: 'Client not found or no changes' }, 404);
  }

  return c.json({ success: true, message: 'Client updated' });
});

// =====================================================
// API DE ESTADÍSTICAS
// =====================================================

app.get('/api/stats/dashboard', authMiddleware, async (c) => {
  const env = c.env;
  const statsService = new StatsService(env);

  const stats = await statsService.getDashboardStats();
  return c.json({ success: true, data: stats });
});

app.get('/api/stats/sales/daily', authMiddleware, async (c) => {
  const env = c.env;
  const statsService = new StatsService(env);

  const days = parseInt(c.req.query('days') || '30');
  const sales = await statsService.getSalesByDay(days);

  return c.json({ success: true, data: sales });
});

app.get('/api/stats/sales/hourly', authMiddleware, async (c) => {
  const env = c.env;
  const statsService = new StatsService(env);

  const sales = await statsService.getSalesByHour();
  return c.json({ success: true, data: sales });
});

app.get('/api/stats/products/top', authMiddleware, async (c) => {
  const env = c.env;
  const statsService = new StatsService(env);

  const limit = parseInt(c.req.query('limit') || '10');
  const products = await statsService.getTopProducts(limit);

  return c.json({ success: true, data: products });
});

app.get('/api/stats/payments', authMiddleware, async (c) => {
  const env = c.env;
  const statsService = new StatsService(env);

  const stats = await statsService.getPaymentStats();
  return c.json({ success: true, data: stats });
});

app.get('/api/stats/delivery-zones', authMiddleware, async (c) => {
  const env = c.env;
  const statsService = new StatsService(env);

  const stats = await statsService.getDeliveryZoneStats();
  return c.json({ success: true, data: stats });
});

// =====================================================
// API DE LOGS
// =====================================================

app.get('/api/logs', authMiddleware, async (c) => {
  const env = c.env;

  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');
  const eventType = c.req.query('event_type');
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM webhook_logs';
  const params: (string | number)[] = [];

  if (eventType) {
    query += ' WHERE event_type = ?';
    params.push(eventType);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = await env.DB.prepare(query).bind(...params).all();

  return c.json({ success: true, data: logs.results });
});

// =====================================================
// SCHEDULED HANDLER - Cron Jobs
// =====================================================

export default {
  fetch: app.fetch,

  // Handler para cron jobs (sincronización automática del menú)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const menuService = new MenuService(env);

    try {
      console.log('Starting scheduled menu sync...');
      const result = await menuService.syncMenu();
      console.log('Menu sync completed:', result);
    } catch (error) {
      console.error('Menu sync failed:', error);
    }
  }
};
