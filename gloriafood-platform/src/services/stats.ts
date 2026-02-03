import type { Env, DashboardStats } from '../types';

/**
 * Servicio para estadísticas y dashboard
 */
export class StatsService {
  private db: D1Database;
  private cache: KVNamespace;

  constructor(env: Env) {
    this.db = env.DB;
    this.cache = env.CACHE;
  }

  /**
   * Obtiene estadísticas para el dashboard
   */
  async getDashboardStats(): Promise<DashboardStats> {
    // Intentar obtener de caché
    const cached = await this.cache.get('dashboard:stats');
    if (cached) {
      return JSON.parse(cached);
    }

    const [today, week, month, recentOrders, topClients, ordersByType] = await Promise.all([
      this.getStatsByPeriod('today'),
      this.getStatsByPeriod('week'),
      this.getStatsByPeriod('month'),
      this.getRecentOrders(10),
      this.getTopClients(5),
      this.getOrdersByType()
    ]);

    const stats: DashboardStats = {
      today,
      week,
      month,
      recentOrders,
      topClients,
      ordersByType
    };

    // Guardar en caché por 5 minutos
    await this.cache.put('dashboard:stats', JSON.stringify(stats), { expirationTtl: 300 });

    return stats;
  }

  /**
   * Obtiene estadísticas por período
   */
  private async getStatsByPeriod(period: 'today' | 'week' | 'month'): Promise<{
    orders: number;
    revenue: number;
    avgOrderValue: number;
  }> {
    let dateCondition: string;

    switch (period) {
      case 'today':
        dateCondition = "DATE(created_at) = DATE('now')";
        break;
      case 'week':
        dateCondition = "created_at >= DATE('now', '-7 days')";
        break;
      case 'month':
        dateCondition = "created_at >= DATE('now', '-30 days')";
        break;
    }

    const result = await this.db.prepare(`
      SELECT
        COUNT(*) as orders,
        COALESCE(SUM(total_price), 0) as revenue,
        COALESCE(AVG(total_price), 0) as avg_order_value
      FROM orders
      WHERE ${dateCondition}
    `).first<{
      orders: number;
      revenue: number;
      avg_order_value: number;
    }>();

    return {
      orders: result?.orders || 0,
      revenue: result?.revenue || 0,
      avgOrderValue: result?.avg_order_value || 0
    };
  }

  /**
   * Obtiene pedidos recientes
   */
  private async getRecentOrders(limit: number): Promise<any[]> {
    const orders = await this.db.prepare(`
      SELECT
        o.*,
        c.first_name as client_first_name,
        c.last_name as client_last_name
      FROM orders o
      LEFT JOIN clients c ON o.client_id = c.id
      ORDER BY o.created_at DESC
      LIMIT ?
    `).bind(limit).all();

    return orders.results;
  }

  /**
   * Obtiene los mejores clientes
   */
  private async getTopClients(limit: number): Promise<any[]> {
    const clients = await this.db.prepare(`
      SELECT
        c.*,
        COUNT(o.id) as total_orders,
        SUM(o.total_price) as total_spent
      FROM clients c
      INNER JOIN orders o ON c.id = o.client_id
      GROUP BY c.id
      ORDER BY total_spent DESC
      LIMIT ?
    `).bind(limit).all();

    return clients.results;
  }

  /**
   * Obtiene pedidos agrupados por tipo
   */
  private async getOrdersByType(): Promise<{ pickup: number; delivery: number }> {
    const result = await this.db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'pickup' THEN 1 ELSE 0 END) as pickup,
        SUM(CASE WHEN type = 'delivery' THEN 1 ELSE 0 END) as delivery
      FROM orders
      WHERE created_at >= DATE('now', '-30 days')
    `).first<{ pickup: number; delivery: number }>();

    return {
      pickup: result?.pickup || 0,
      delivery: result?.delivery || 0
    };
  }

  /**
   * Obtiene estadísticas de ventas por día
   */
  async getSalesByDay(days: number = 30): Promise<any[]> {
    const result = await this.db.prepare(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as orders,
        SUM(total_price) as revenue,
        AVG(total_price) as avg_order_value
      FROM orders
      WHERE created_at >= DATE('now', '-' || ? || ' days')
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).bind(days).all();

    return result.results;
  }

  /**
   * Obtiene estadísticas de ventas por hora
   */
  async getSalesByHour(): Promise<any[]> {
    const result = await this.db.prepare(`
      SELECT
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as orders,
        SUM(total_price) as revenue
      FROM orders
      WHERE created_at >= DATE('now', '-30 days')
      GROUP BY hour
      ORDER BY hour ASC
    `).all();

    return result.results;
  }

  /**
   * Obtiene los productos más vendidos
   */
  async getTopProducts(limit: number = 10): Promise<any[]> {
    const result = await this.db.prepare(`
      SELECT
        name,
        SUM(quantity) as total_quantity,
        SUM(total_price) as total_revenue,
        COUNT(DISTINCT order_id) as order_count
      FROM order_items
      WHERE type = 'item'
      GROUP BY name
      ORDER BY total_quantity DESC
      LIMIT ?
    `).bind(limit).all();

    return result.results;
  }

  /**
   * Obtiene estadísticas de métodos de pago
   */
  async getPaymentStats(): Promise<any[]> {
    const result = await this.db.prepare(`
      SELECT
        payment_method,
        COUNT(*) as count,
        SUM(total_price) as total
      FROM orders
      WHERE payment_method IS NOT NULL
      GROUP BY payment_method
      ORDER BY count DESC
    `).all();

    return result.results;
  }

  /**
   * Obtiene estadísticas de zonas de entrega
   */
  async getDeliveryZoneStats(): Promise<any[]> {
    const result = await this.db.prepare(`
      SELECT
        delivery_zone as zone,
        COUNT(*) as orders,
        SUM(total_price) as revenue,
        AVG(delivery_fee) as avg_delivery_fee
      FROM orders
      WHERE type = 'delivery' AND delivery_zone IS NOT NULL
      GROUP BY delivery_zone
      ORDER BY orders DESC
    `).all();

    return result.results;
  }
}
