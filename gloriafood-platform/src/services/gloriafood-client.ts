import type { Env, GloriaFoodOrderResponse, GloriaFoodMenuResponse } from '../types';

/**
 * Cliente para comunicación con la API de GloriaFood
 */
export class GloriaFoodClient {
  private baseUrl: string;
  private secretKey: string;
  private apiVersion: string;

  constructor(env: Env) {
    this.baseUrl = env.GLORIAFOOD_API_URL || 'https://pos.globalfoodsoft.com';
    this.secretKey = env.GLORIAFOOD_SECRET_KEY;
    this.apiVersion = env.API_VERSION || '2';
  }

  private getHeaders(): HeadersInit {
    return {
      'Authorization': this.secretKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Glf-Api-Version': this.apiVersion,
    };
  }

  /**
   * Obtiene pedidos pendientes mediante polling
   * POST /pos/order/pop
   */
  async pollOrders(): Promise<GloriaFoodOrderResponse> {
    const response = await fetch(`${this.baseUrl}/pos/order/pop`, {
      method: 'POST',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Error polling orders: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Obtiene el menú completo del restaurante
   * GET /pos/menu
   */
  async fetchMenu(): Promise<GloriaFoodMenuResponse> {
    const response = await fetch(`${this.baseUrl}/pos/menu`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Error fetching menu: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Valida que una solicitud webhook viene de GloriaFood
   */
  static validateWebhookRequest(authHeader: string | null, masterKey: string): boolean {
    if (!authHeader || !masterKey) {
      return false;
    }
    return authHeader === masterKey;
  }
}
