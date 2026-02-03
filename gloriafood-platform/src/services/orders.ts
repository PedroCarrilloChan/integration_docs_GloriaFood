import type { Env, GloriaFoodOrder, Order, OrderItem } from '../types';

/**
 * Servicio para gestión de pedidos
 */
export class OrdersService {
  private db: D1Database;
  private cache: KVNamespace;

  constructor(env: Env) {
    this.db = env.DB;
    this.cache = env.CACHE;
  }

  /**
   * Procesa y guarda un pedido recibido de GloriaFood
   */
  async processOrder(order: GloriaFoodOrder): Promise<{ orderId: number; isNew: boolean }> {
    // Verificar si el pedido ya existe (deduplicación)
    const existing = await this.db.prepare(
      'SELECT id FROM orders WHERE gloriafood_id = ? AND pos_system_id = ?'
    ).bind(order.id, order.pos_system_id || 0).first<{ id: number }>();

    if (existing) {
      return { orderId: existing.id, isNew: false };
    }

    // Obtener o crear cliente
    const clientId = await this.getOrCreateClient(order);

    // Obtener o crear restaurante
    const restaurantId = await this.getOrCreateRestaurant(order);

    // Determinar método de pago
    const paymentMethod = order.type === 'delivery'
      ? order.delivery_payment
      : order.pickup_payment;

    // Calcular propina
    const tipItem = order.items.find(i => i.type === 'tip');
    const tipAmount = tipItem?.total_item_price || 0;

    // Calcular delivery fee
    const deliveryItem = order.items.find(i => i.type === 'delivery_fee');
    const deliveryFee = deliveryItem?.total_item_price || 0;

    // Insertar pedido
    const result = await this.db.prepare(`
      INSERT INTO orders (
        gloriafood_id, pos_system_id, restaurant_id, client_id,
        status, type, source, currency, total_price, sub_total_price,
        tax_value, tax_type, tax_name, payment_method, payment_status,
        instructions, fulfill_at, accepted_at, for_later, pin_skipped,
        delivery_fee, delivery_address, delivery_latitude, delivery_longitude,
        delivery_zone, outside_delivery_area, tip_amount, raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      order.id,
      order.pos_system_id || 0,
      restaurantId,
      clientId,
      order.status,
      order.type,
      order.source || null,
      order.currency,
      order.total_price,
      order.sub_total_price,
      order.tax_value,
      order.tax_type,
      order.tax_name || null,
      paymentMethod || null,
      order.payment?.payment_status || 'pending',
      order.instructions || null,
      order.fulfill_at,
      order.accepted_at,
      order.for_later ? 1 : 0,
      order.pin_skipped ? 1 : 0,
      deliveryFee,
      order.client_address || null,
      order.latitude || null,
      order.longitude || null,
      order.delivery_zone_name || null,
      order.outside_delivery_area ? 1 : 0,
      tipAmount,
      JSON.stringify(order)
    ).run();

    const orderId = result.meta.last_row_id as number;

    // Insertar items del pedido
    await this.insertOrderItems(orderId, order.items);

    // Insertar cupones si hay
    if (order.coupons && order.coupons.length > 0) {
      for (const coupon of order.coupons) {
        await this.db.prepare(
          'INSERT INTO order_coupons (order_id, coupon_code) VALUES (?, ?)'
        ).bind(orderId, coupon).run();
      }
    }

    // Insertar impuestos
    if (order.tax_list) {
      for (const tax of order.tax_list) {
        await this.db.prepare(
          'INSERT INTO order_taxes (order_id, type, rate, value) VALUES (?, ?, ?, ?)'
        ).bind(orderId, tax.type, tax.rate, tax.value).run();
      }
    }

    // Insertar datos de facturación
    if (order.billing_details) {
      await this.insertBillingDetails(orderId, order.billing_details);
    }

    // Invalidar caché de estadísticas
    await this.cache.delete('dashboard:stats');

    return { orderId, isNew: true };
  }

  /**
   * Obtiene o crea un cliente
   */
  private async getOrCreateClient(order: GloriaFoodOrder): Promise<number | null> {
    const clientGloriaFoodId = order.client_id || order.user_id;
    if (!clientGloriaFoodId) return null;

    // Buscar cliente existente
    const existing = await this.db.prepare(
      'SELECT id FROM clients WHERE gloriafood_id = ?'
    ).bind(clientGloriaFoodId).first<{ id: number }>();

    if (existing) {
      // Actualizar información del cliente
      await this.db.prepare(`
        UPDATE clients SET
          first_name = COALESCE(?, first_name),
          last_name = COALESCE(?, last_name),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          order_count = ?,
          marketing_consent = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        order.client_first_name,
        order.client_last_name,
        order.client_email,
        order.client_phone,
        order.client_order_count || 0,
        order.client_marketing_consent ? 1 : 0,
        existing.id
      ).run();

      // Guardar dirección si es delivery
      if (order.type === 'delivery' && order.client_address_parts) {
        await this.saveClientAddress(existing.id, order);
      }

      return existing.id;
    }

    // Crear nuevo cliente
    const result = await this.db.prepare(`
      INSERT INTO clients (
        gloriafood_id, first_name, last_name, email, phone,
        order_count, marketing_consent
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      clientGloriaFoodId,
      order.client_first_name || null,
      order.client_last_name || null,
      order.client_email || null,
      order.client_phone || null,
      order.client_order_count || 1,
      order.client_marketing_consent ? 1 : 0
    ).run();

    const clientId = result.meta.last_row_id as number;

    // Guardar dirección si es delivery
    if (order.type === 'delivery' && order.client_address_parts) {
      await this.saveClientAddress(clientId, order);
    }

    return clientId;
  }

  /**
   * Guarda la dirección del cliente
   */
  private async saveClientAddress(clientId: number, order: GloriaFoodOrder): Promise<void> {
    const parts = order.client_address_parts;
    if (!parts) return;

    // Verificar si ya existe esta dirección
    const existing = await this.db.prepare(
      'SELECT id FROM client_addresses WHERE client_id = ? AND full_address = ?'
    ).bind(clientId, parts.full_address || order.client_address).first();

    if (existing) return;

    await this.db.prepare(`
      INSERT INTO client_addresses (
        client_id, full_address, street, city, zipcode,
        bloc, floor, apartment, intercom, latitude, longitude, delivery_zone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      clientId,
      parts.full_address || order.client_address,
      parts.street || null,
      parts.city || null,
      parts.zipcode || null,
      parts.bloc || null,
      parts.floor || null,
      parts.apartment || null,
      parts.intercom || null,
      order.latitude || null,
      order.longitude || null,
      order.delivery_zone_name || null
    ).run();
  }

  /**
   * Obtiene o crea un restaurante
   */
  private async getOrCreateRestaurant(order: GloriaFoodOrder): Promise<number> {
    const existing = await this.db.prepare(
      'SELECT id FROM restaurants WHERE restaurant_key = ?'
    ).bind(order.restaurant_key).first<{ id: number }>();

    if (existing) {
      return existing.id;
    }

    const result = await this.db.prepare(`
      INSERT INTO restaurants (
        gloriafood_id, restaurant_key, name, timezone, currency
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(
      order.restaurant_id,
      order.restaurant_key,
      order.restaurant_name,
      order.restaurant_timezone || 'UTC',
      order.currency
    ).run();

    return result.meta.last_row_id as number;
  }

  /**
   * Inserta los items de un pedido
   */
  private async insertOrderItems(orderId: number, items: OrderItem[]): Promise<void> {
    for (const item of items) {
      const result = await this.db.prepare(`
        INSERT INTO order_items (
          order_id, gloriafood_id, name, type, type_id, quantity,
          price, total_price, tax_rate, tax_value, tax_type,
          item_discount, cart_discount, cart_discount_rate,
          instructions, kitchen_internal_name, coupon
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        orderId,
        item.id,
        item.name,
        item.type,
        item.type_id || null,
        item.quantity,
        item.price,
        item.total_item_price,
        item.tax_rate || 0,
        item.tax_value || 0,
        item.tax_type || null,
        item.item_discount || 0,
        item.cart_discount || 0,
        item.cart_discount_rate || 0,
        item.instructions || null,
        item.kitchen_internal_name || null,
        item.coupon || null
      ).run();

      const itemId = result.meta.last_row_id as number;

      // Insertar opciones del item
      if (item.options && item.options.length > 0) {
        for (const option of item.options) {
          await this.db.prepare(`
            INSERT INTO order_item_options (
              order_item_id, gloriafood_id, name, group_name,
              type, type_id, quantity, price, kitchen_internal_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            itemId,
            option.id,
            option.name,
            option.group_name || null,
            option.type,
            option.type_id || null,
            option.quantity,
            option.price,
            option.kitchen_internal_name || null
          ).run();
        }
      }
    }
  }

  /**
   * Inserta datos de facturación
   */
  private async insertBillingDetails(orderId: number, billing: GloriaFoodOrder['billing_details']): Promise<void> {
    if (!billing) return;

    await this.db.prepare(`
      INSERT INTO billing_details (
        order_id, type, company_name, cui, reg_com,
        person_name, person_type, document_type, document_number,
        address, city, region, sector, country_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      orderId,
      billing.type || null,
      billing.company_name || null,
      billing.cui || null,
      billing.reg_com || null,
      billing.person_name || null,
      billing.person_type || null,
      billing.document_type || null,
      billing.document_number || null,
      billing.address || null,
      billing.city || null,
      billing.region || null,
      billing.sector || null,
      billing.country_code || null
    ).run();
  }

  /**
   * Obtiene todos los pedidos con paginación
   */
  async getOrders(page: number = 1, limit: number = 20, filters?: {
    status?: string;
    type?: 'pickup' | 'delivery';
    dateFrom?: string;
    dateTo?: string;
    restaurantId?: number;
  }): Promise<{ orders: Order[]; total: number }> {
    let whereClause = '1=1';
    const params: (string | number)[] = [];

    if (filters?.status) {
      whereClause += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.type) {
      whereClause += ' AND type = ?';
      params.push(filters.type);
    }
    if (filters?.dateFrom) {
      whereClause += ' AND created_at >= ?';
      params.push(filters.dateFrom);
    }
    if (filters?.dateTo) {
      whereClause += ' AND created_at <= ?';
      params.push(filters.dateTo);
    }
    if (filters?.restaurantId) {
      whereClause += ' AND restaurant_id = ?';
      params.push(filters.restaurantId);
    }

    // Contar total
    const countResult = await this.db.prepare(
      `SELECT COUNT(*) as total FROM orders WHERE ${whereClause}`
    ).bind(...params).first<{ total: number }>();

    const total = countResult?.total || 0;

    // Obtener pedidos
    const offset = (page - 1) * limit;
    const orders = await this.db.prepare(
      `SELECT * FROM orders WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all<Order>();

    return { orders: orders.results, total };
  }

  /**
   * Obtiene un pedido por ID
   */
  async getOrderById(id: number): Promise<Order | null> {
    return this.db.prepare('SELECT * FROM orders WHERE id = ?')
      .bind(id).first<Order>();
  }

  /**
   * Obtiene un pedido completo con items y opciones
   */
  async getOrderWithDetails(id: number): Promise<{
    order: Order;
    items: any[];
    client: any;
    billing: any;
  } | null> {
    const order = await this.getOrderById(id);
    if (!order) return null;

    // Obtener items
    const items = await this.db.prepare(`
      SELECT oi.*,
        (SELECT json_group_array(json_object(
          'id', oio.id,
          'name', oio.name,
          'group_name', oio.group_name,
          'type', oio.type,
          'quantity', oio.quantity,
          'price', oio.price
        )) FROM order_item_options oio WHERE oio.order_item_id = oi.id) as options
      FROM order_items oi WHERE oi.order_id = ?
    `).bind(id).all();

    // Obtener cliente
    const client = order.client_id
      ? await this.db.prepare('SELECT * FROM clients WHERE id = ?').bind(order.client_id).first()
      : null;

    // Obtener datos de facturación
    const billing = await this.db.prepare(
      'SELECT * FROM billing_details WHERE order_id = ?'
    ).bind(id).first();

    return {
      order,
      items: items.results.map(i => ({
        ...i,
        options: i.options ? JSON.parse(i.options as string) : []
      })),
      client,
      billing
    };
  }

  /**
   * Actualiza el estado de un pedido
   */
  async updateOrderStatus(id: number, status: string): Promise<boolean> {
    const result = await this.db.prepare(
      'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(status, id).run();

    return result.meta.changes > 0;
  }
}
