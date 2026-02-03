import type { Env, Client } from '../types';

/**
 * Servicio para gestión de clientes
 */
export class ClientsService {
  private db: D1Database;
  private cache: KVNamespace;

  constructor(env: Env) {
    this.db = env.DB;
    this.cache = env.CACHE;
  }

  /**
   * Obtiene todos los clientes con paginación
   */
  async getClients(page: number = 1, limit: number = 20, search?: string): Promise<{
    clients: Client[];
    total: number;
  }> {
    let whereClause = '1=1';
    const params: string[] = [];

    if (search) {
      whereClause = `(
        first_name LIKE ? OR
        last_name LIKE ? OR
        email LIKE ? OR
        phone LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Contar total
    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as total FROM clients WHERE ${whereClause}`
    ).bind(...params).first<{ total: number }>();

    const total = countResult?.total || 0;

    // Obtener clientes
    const offset = (page - 1) * limit;
    const clients = await this.db.prepare(
      `SELECT * FROM clients WHERE ${whereClause} ORDER BY order_count DESC, created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all<Client>();

    return { clients: clients.results, total };
  }

  /**
   * Obtiene un cliente por ID
   */
  async getClientById(id: number): Promise<Client | null> {
    return this.db.prepare('SELECT * FROM clients WHERE id = ?')
      .bind(id).first<Client>();
  }

  /**
   * Obtiene un cliente con todos sus detalles
   */
  async getClientWithDetails(id: number): Promise<{
    client: Client;
    addresses: any[];
    orders: any[];
    stats: any;
  } | null> {
    const client = await this.getClientById(id);
    if (!client) return null;

    // Obtener direcciones
    const addresses = await this.db.prepare(`
      SELECT * FROM client_addresses WHERE client_id = ? ORDER BY created_at DESC
    `).bind(id).all();

    // Obtener pedidos recientes
    const orders = await this.db.prepare(`
      SELECT * FROM orders WHERE client_id = ? ORDER BY created_at DESC LIMIT 10
    `).bind(id).all();

    // Calcular estadísticas
    const stats = await this.db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        SUM(total_price) as total_spent,
        AVG(total_price) as avg_order_value,
        MAX(created_at) as last_order_date,
        SUM(CASE WHEN type = 'delivery' THEN 1 ELSE 0 END) as delivery_orders,
        SUM(CASE WHEN type = 'pickup' THEN 1 ELSE 0 END) as pickup_orders
      FROM orders WHERE client_id = ?
    `).bind(id).first();

    return {
      client,
      addresses: addresses.results,
      orders: orders.results,
      stats
    };
  }

  /**
   * Obtiene los clientes más frecuentes
   */
  async getTopClients(limit: number = 10): Promise<any[]> {
    const clients = await this.db.prepare(`
      SELECT
        c.*,
        COUNT(o.id) as total_orders,
        SUM(o.total_price) as total_spent,
        AVG(o.total_price) as avg_order_value,
        MAX(o.created_at) as last_order
      FROM clients c
      LEFT JOIN orders o ON c.id = o.client_id
      GROUP BY c.id
      ORDER BY total_orders DESC, total_spent DESC
      LIMIT ?
    `).bind(limit).all();

    return clients.results;
  }

  /**
   * Obtiene clientes que han aceptado marketing
   */
  async getMarketingClients(): Promise<Client[]> {
    const clients = await this.db.prepare(`
      SELECT * FROM clients WHERE marketing_consent = 1 AND email IS NOT NULL
      ORDER BY order_count DESC
    `).all<Client>();

    return clients.results;
  }

  /**
   * Busca clientes por email o teléfono
   */
  async findClient(email?: string, phone?: string): Promise<Client | null> {
    if (email) {
      const byEmail = await this.db.prepare(
        'SELECT * FROM clients WHERE email = ?'
      ).bind(email).first<Client>();
      if (byEmail) return byEmail;
    }

    if (phone) {
      const byPhone = await this.db.prepare(
        'SELECT * FROM clients WHERE phone = ?'
      ).bind(phone).first<Client>();
      if (byPhone) return byPhone;
    }

    return null;
  }

  /**
   * Actualiza información del cliente
   */
  async updateClient(id: number, data: Partial<Client>): Promise<boolean> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.first_name !== undefined) {
      fields.push('first_name = ?');
      values.push(data.first_name);
    }
    if (data.last_name !== undefined) {
      fields.push('last_name = ?');
      values.push(data.last_name);
    }
    if (data.email !== undefined) {
      fields.push('email = ?');
      values.push(data.email);
    }
    if (data.phone !== undefined) {
      fields.push('phone = ?');
      values.push(data.phone);
    }
    if (data.marketing_consent !== undefined) {
      fields.push('marketing_consent = ?');
      values.push(data.marketing_consent ? 1 : 0);
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const result = await this.db.prepare(
      `UPDATE clients SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    return result.meta.changes > 0;
  }

  /**
   * Obtiene estadísticas de clientes
   */
  async getClientsStats(): Promise<{
    total: number;
    withMarketing: number;
    newThisMonth: number;
    avgOrdersPerClient: number;
  }> {
    const stats = await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN marketing_consent = 1 THEN 1 ELSE 0 END) as with_marketing,
        SUM(CASE WHEN created_at >= date('now', '-30 days') THEN 1 ELSE 0 END) as new_this_month,
        AVG(order_count) as avg_orders
      FROM clients
    `).first<{
      total: number;
      with_marketing: number;
      new_this_month: number;
      avg_orders: number;
    }>();

    return {
      total: stats?.total || 0,
      withMarketing: stats?.with_marketing || 0,
      newThisMonth: stats?.new_this_month || 0,
      avgOrdersPerClient: stats?.avg_orders || 0
    };
  }
}
