import type {
  Env,
  GloriaFoodMenuResponse,
  MenuCategory,
  MenuItem,
  MenuItemSize,
  MenuOptionGroup
} from '../types';
import { GloriaFoodClient } from './gloriafood-client';

/**
 * Servicio para gestión y sincronización del menú
 */
export class MenuService {
  private db: D1Database;
  private cache: KVNamespace;
  private gloriaFood: GloriaFoodClient;

  constructor(env: Env) {
    this.db = env.DB;
    this.cache = env.CACHE;
    this.gloriaFood = new GloriaFoodClient(env);
  }

  /**
   * Sincroniza el menú completo desde GloriaFood
   */
  async syncMenu(): Promise<{ success: boolean; message: string; stats: any }> {
    try {
      const menuData = await this.gloriaFood.fetchMenu();

      // Obtener o crear el menú
      const menuId = await this.getOrCreateMenu(menuData);

      let stats = {
        categories: 0,
        items: 0,
        sizes: 0,
        optionGroups: 0,
        options: 0
      };

      // Limpiar datos existentes del menú
      await this.clearMenuData(menuId);

      // Procesar categorías
      for (const category of menuData.categories) {
        await this.processCategory(menuId, category, stats);
      }

      // Actualizar timestamp de sincronización
      await this.db.prepare(
        'UPDATE menus SET synced_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(menuId).run();

      // Guardar menú en caché (1 hora)
      await this.cache.put('menu:full', JSON.stringify(menuData), { expirationTtl: 3600 });

      // Registrar evento
      await this.logEvent('menu_sync', { stats }, 'success');

      return {
        success: true,
        message: 'Menú sincronizado correctamente',
        stats
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.logEvent('menu_sync', { error: errorMessage }, 'error', errorMessage);
      throw error;
    }
  }

  /**
   * Obtiene o crea el registro del menú
   */
  private async getOrCreateMenu(menuData: GloriaFoodMenuResponse): Promise<number> {
    const existing = await this.db.prepare(
      'SELECT id FROM menus WHERE gloriafood_id = ?'
    ).bind(menuData.id).first<{ id: number }>();

    if (existing) {
      await this.db.prepare(
        'UPDATE menus SET currency = ?, active = ? WHERE id = ?'
      ).bind(menuData.currency, menuData.active ? 1 : 0, existing.id).run();
      return existing.id;
    }

    const result = await this.db.prepare(`
      INSERT INTO menus (gloriafood_id, restaurant_id, currency, active)
      VALUES (?, ?, ?, ?)
    `).bind(
      menuData.id,
      menuData.restaurant_id,
      menuData.currency,
      menuData.active ? 1 : 0
    ).run();

    return result.meta.last_row_id as number;
  }

  /**
   * Limpia los datos existentes del menú
   */
  private async clearMenuData(menuId: number): Promise<void> {
    // Obtener IDs de categorías
    const categories = await this.db.prepare(
      'SELECT id FROM menu_categories WHERE menu_id = ?'
    ).bind(menuId).all<{ id: number }>();

    for (const cat of categories.results) {
      // Obtener IDs de items
      const items = await this.db.prepare(
        'SELECT id FROM menu_items WHERE category_id = ?'
      ).bind(cat.id).all<{ id: number }>();

      for (const item of items.results) {
        // Eliminar tamaños y sus relaciones
        await this.db.prepare(
          'DELETE FROM menu_item_sizes WHERE item_id = ?'
        ).bind(item.id).run();

        // Eliminar relaciones item-optiongroup
        await this.db.prepare(
          'DELETE FROM menu_item_option_groups WHERE item_id = ?'
        ).bind(item.id).run();
      }

      // Eliminar items
      await this.db.prepare(
        'DELETE FROM menu_items WHERE category_id = ?'
      ).bind(cat.id).run();
    }

    // Eliminar categorías
    await this.db.prepare(
      'DELETE FROM menu_categories WHERE menu_id = ?'
    ).bind(menuId).run();
  }

  /**
   * Procesa una categoría del menú
   */
  private async processCategory(
    menuId: number,
    category: MenuCategory,
    stats: any,
    sortOrder: number = 0
  ): Promise<void> {
    const result = await this.db.prepare(`
      INSERT INTO menu_categories (menu_id, gloriafood_id, name, description, active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      menuId,
      category.id,
      category.name,
      category.description || null,
      category.active ? 1 : 0,
      sortOrder
    ).run();

    const categoryId = result.meta.last_row_id as number;
    stats.categories++;

    // Procesar items de la categoría
    let itemSortOrder = 0;
    for (const item of category.items) {
      await this.processItem(categoryId, item, stats, itemSortOrder++);
    }

    // Procesar grupos de opciones a nivel de categoría
    if (category.groups) {
      for (const group of category.groups) {
        await this.processOptionGroup(group, stats, null, null);
      }
    }
  }

  /**
   * Procesa un item del menú
   */
  private async processItem(
    categoryId: number,
    item: MenuItem,
    stats: any,
    sortOrder: number = 0
  ): Promise<void> {
    const extras = item.extras || {};

    const result = await this.db.prepare(`
      INSERT INTO menu_items (
        category_id, gloriafood_id, name, description, price, active,
        sort_order, kitchen_internal_name, order_types, tags, allergens, nutritional_values
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      categoryId,
      item.id,
      item.name,
      item.description || null,
      item.price,
      item.active ? 1 : 0,
      sortOrder,
      extras.menu_item_kitchen_internal_name || null,
      extras.menu_item_order_types ? JSON.stringify(extras.menu_item_order_types) : null,
      item.tags ? JSON.stringify(item.tags) : null,
      extras.menu_item_allergens_values ? JSON.stringify(extras.menu_item_allergens_values) : null,
      extras.menu_item_nutritional_values ? JSON.stringify(extras.menu_item_nutritional_values) : null
    ).run();

    const itemId = result.meta.last_row_id as number;
    stats.items++;

    // Procesar tamaños
    if (item.sizes) {
      let sizeSortOrder = 0;
      for (const size of item.sizes) {
        await this.processSize(itemId, size, stats, sizeSortOrder++);
      }
    }

    // Procesar grupos de opciones del item
    if (item.groups) {
      for (const group of item.groups) {
        await this.processOptionGroup(group, stats, itemId, null);
      }
    }
  }

  /**
   * Procesa un tamaño de item
   */
  private async processSize(
    itemId: number,
    size: MenuItemSize,
    stats: any,
    sortOrder: number = 0
  ): Promise<void> {
    const result = await this.db.prepare(`
      INSERT INTO menu_item_sizes (item_id, gloriafood_id, name, price, is_default, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      itemId,
      size.id,
      size.name,
      size.price,
      size.default ? 1 : 0,
      sortOrder
    ).run();

    const sizeId = result.meta.last_row_id as number;
    stats.sizes++;

    // Procesar grupos de opciones del tamaño
    if (size.groups) {
      for (const group of size.groups) {
        await this.processOptionGroup(group, stats, null, sizeId);
      }
    }
  }

  /**
   * Procesa un grupo de opciones
   */
  private async processOptionGroup(
    group: MenuOptionGroup,
    stats: any,
    itemId: number | null,
    sizeId: number | null
  ): Promise<void> {
    // Verificar si el grupo ya existe
    let groupId: number;
    const existing = await this.db.prepare(
      'SELECT id FROM menu_option_groups WHERE gloriafood_id = ?'
    ).bind(group.id).first<{ id: number }>();

    if (existing) {
      groupId = existing.id;
      // Actualizar grupo existente
      await this.db.prepare(`
        UPDATE menu_option_groups SET
          name = ?, required = ?, allow_quantity = ?, force_min = ?, force_max = ?
        WHERE id = ?
      `).bind(
        group.name,
        group.required ? 1 : 0,
        group.allow_quantity ? 1 : 0,
        group.force_min,
        group.force_max,
        groupId
      ).run();
    } else {
      const result = await this.db.prepare(`
        INSERT INTO menu_option_groups (gloriafood_id, name, required, allow_quantity, force_min, force_max)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        group.id,
        group.name,
        group.required ? 1 : 0,
        group.allow_quantity ? 1 : 0,
        group.force_min,
        group.force_max
      ).run();
      groupId = result.meta.last_row_id as number;
      stats.optionGroups++;
    }

    // Crear relación con item o size
    if (itemId || sizeId) {
      await this.db.prepare(`
        INSERT OR IGNORE INTO menu_item_option_groups (item_id, size_id, option_group_id)
        VALUES (?, ?, ?)
      `).bind(itemId, sizeId, groupId).run();
    }

    // Procesar opciones del grupo (solo si es nuevo)
    if (!existing) {
      let optionSortOrder = 0;
      for (const option of group.options) {
        await this.db.prepare(`
          INSERT INTO menu_options (
            option_group_id, gloriafood_id, name, price, is_default, kitchen_internal_name, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          groupId,
          option.id,
          option.name,
          option.price,
          option.default ? 1 : 0,
          option.extras?.menu_option_kitchen_internal_name || null,
          optionSortOrder++
        ).run();
        stats.options++;
      }
    }
  }

  /**
   * Obtiene el menú completo
   */
  async getFullMenu(): Promise<any> {
    // Intentar obtener de caché
    const cached = await this.cache.get('menu:full');
    if (cached) {
      return JSON.parse(cached);
    }

    // Construir menú desde la base de datos
    const menu = await this.db.prepare('SELECT * FROM menus LIMIT 1').first();
    if (!menu) {
      return null;
    }

    const categories = await this.db.prepare(`
      SELECT * FROM menu_categories WHERE menu_id = ? ORDER BY sort_order
    `).bind(menu.id).all();

    const fullMenu = {
      ...menu,
      categories: await Promise.all(categories.results.map(async (cat) => {
        const items = await this.db.prepare(`
          SELECT * FROM menu_items WHERE category_id = ? ORDER BY sort_order
        `).bind(cat.id).all();

        return {
          ...cat,
          items: await Promise.all(items.results.map(async (item) => {
            // Obtener tamaños
            const sizes = await this.db.prepare(`
              SELECT * FROM menu_item_sizes WHERE item_id = ? ORDER BY sort_order
            `).bind(item.id).all();

            // Obtener grupos de opciones del item
            const groups = await this.getOptionGroupsForItem(item.id as number);

            return {
              ...item,
              tags: item.tags ? JSON.parse(item.tags as string) : [],
              order_types: item.order_types ? JSON.parse(item.order_types as string) : [],
              allergens: item.allergens ? JSON.parse(item.allergens as string) : [],
              nutritional_values: item.nutritional_values ? JSON.parse(item.nutritional_values as string) : [],
              sizes: sizes.results,
              groups
            };
          }))
        };
      }))
    };

    // Guardar en caché
    await this.cache.put('menu:full', JSON.stringify(fullMenu), { expirationTtl: 3600 });

    return fullMenu;
  }

  /**
   * Obtiene grupos de opciones para un item
   */
  private async getOptionGroupsForItem(itemId: number): Promise<any[]> {
    const relations = await this.db.prepare(`
      SELECT og.* FROM menu_option_groups og
      INNER JOIN menu_item_option_groups miog ON og.id = miog.option_group_id
      WHERE miog.item_id = ?
    `).bind(itemId).all();

    return Promise.all(relations.results.map(async (group) => {
      const options = await this.db.prepare(`
        SELECT * FROM menu_options WHERE option_group_id = ? ORDER BY sort_order
      `).bind(group.id).all();

      return {
        ...group,
        options: options.results
      };
    }));
  }

  /**
   * Obtiene categorías del menú
   */
  async getCategories(): Promise<any[]> {
    const categories = await this.db.prepare(`
      SELECT mc.*, COUNT(mi.id) as item_count
      FROM menu_categories mc
      LEFT JOIN menu_items mi ON mc.id = mi.category_id
      GROUP BY mc.id
      ORDER BY mc.sort_order
    `).all();

    return categories.results;
  }

  /**
   * Obtiene items de una categoría
   */
  async getItemsByCategory(categoryId: number): Promise<any[]> {
    const items = await this.db.prepare(`
      SELECT * FROM menu_items WHERE category_id = ? AND active = 1 ORDER BY sort_order
    `).bind(categoryId).all();

    return items.results;
  }

  /**
   * Busca items por nombre
   */
  async searchItems(query: string): Promise<any[]> {
    const items = await this.db.prepare(`
      SELECT mi.*, mc.name as category_name
      FROM menu_items mi
      INNER JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.name LIKE ? OR mi.description LIKE ?
      ORDER BY mi.name
      LIMIT 50
    `).bind(`%${query}%`, `%${query}%`).all();

    return items.results;
  }

  /**
   * Registra un evento en el log
   */
  private async logEvent(
    eventType: string,
    payload: any,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    await this.db.prepare(`
      INSERT INTO webhook_logs (event_type, payload, status, error_message)
      VALUES (?, ?, ?, ?)
    `).bind(eventType, JSON.stringify(payload), status, errorMessage || null).run();
  }
}
