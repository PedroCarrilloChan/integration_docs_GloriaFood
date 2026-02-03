// =====================================================
// TIPOS DE DATOS GLORIAFOOD API
// =====================================================

// Bindings de Cloudflare
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  GLORIAFOOD_SECRET_KEY: string;
  GLORIAFOOD_MASTER_KEY: string;
  GLORIAFOOD_API_URL: string;
  API_VERSION: string;
  API_AUTH_TOKEN: string;
}

// =====================================================
// TIPOS DE PEDIDOS (Orders)
// =====================================================

export interface GloriaFoodOrderResponse {
  count: number;
  orders: GloriaFoodOrder[];
}

export interface GloriaFoodOrder {
  id: number;
  api_version: number;
  status: 'accepted';
  type: 'pickup' | 'delivery';
  source?: string;
  restaurant_key: string;
  restaurant_id: number;
  restaurant_name: string;
  restaurant_phone?: string;
  restaurant_country?: string;
  restaurant_state?: string;
  restaurant_city?: string;
  restaurant_zipcode?: string;
  restaurant_street?: string;
  restaurant_latitude?: string;
  restaurant_longitude?: string;
  restaurant_timezone?: string;
  restaurant_token?: string;
  company_account_id?: number;
  pos_system_id?: number;
  currency: string;
  total_price: number;
  sub_total_price: number;
  tax_value: number;
  tax_type: 'NET' | 'GROSS';
  tax_name?: string;
  tax_list?: OrderTax[];
  coupons?: string[];
  instructions?: string;
  fulfill_at: string;
  accepted_at: string;
  for_later?: boolean;
  pin_skipped?: boolean;
  pickup_payment?: PaymentMethod;
  delivery_payment?: PaymentMethod;
  payment?: PaymentInfo;
  items: OrderItem[];
  client_id?: number;
  user_id?: number;
  client_first_name?: string;
  client_last_name?: string;
  client_email?: string;
  client_phone?: string;
  client_address?: string;
  client_address_parts?: AddressParts;
  client_order_count?: number;
  client_marketing_consent?: boolean;
  client_ip_address?: string;
  latitude?: string;
  longitude?: string;
  delivery_zone_name?: string;
  outside_delivery_area?: boolean;
  delivery_by_distance?: DeliveryByDistance;
  billing_details?: BillingDetails;
}

export type PaymentMethod = 'CASH' | 'ONLINE' | 'CARD' | 'CARD_PHONE';

export interface PaymentInfo {
  payment_status: string;
  payment_processor?: string;
  payment_processor_name?: string;
  payment_method?: string;
  card_type?: string;
}

export interface OrderTax {
  type: 'item' | 'delivery_fee' | 'tip' | 'fees_discounts_subtotal' | 'service_fee_total';
  value: number;
  rate: number;
}

export interface AddressParts {
  street?: string;
  bloc?: string;
  floor?: string;
  apartment?: string;
  intercom?: string;
  more_address?: string;
  zipcode?: string;
  city?: string;
  full_address?: string;
}

export interface DeliveryByDistance {
  distance: number;
  unit: 'km' | 'mile';
  delivery_fee: number;
}

export interface OrderItem {
  id: number;
  name: string;
  total_item_price: number;
  price: number;
  quantity: number;
  instructions?: string;
  type: 'item' | 'delivery_fee' | 'tip' | 'promo_cart' | 'promo_item' | 'promo_cart_item' | 'service_fee_subtotal' | 'service_fee_total' | 'cash_discount';
  type_id?: number;
  tax_rate?: number;
  tax_value?: number;
  tax_type?: 'NET' | 'GROSS';
  parent_id?: number;
  item_discount?: number;
  cart_discount?: number;
  cart_discount_rate?: number;
  kitchen_internal_name?: string;
  coupon?: string;
  options?: OrderItemOption[];
}

export interface OrderItemOption {
  id: number;
  name: string;
  price: number;
  group_name?: string;
  quantity: number;
  type: 'size' | 'option';
  type_id?: number;
  kitchen_internal_name?: string;
}

export interface BillingDetails {
  type?: 'personal' | 'company';
  company_name?: string;
  cui?: string;
  reg_com?: string;
  person_name?: string;
  person_type?: string;
  document_type?: string;
  document_number?: string;
  address?: string;
  city?: string;
  region?: string;
  sector?: string;
  country_code?: string;
}

// =====================================================
// TIPOS DE MENÚ (Menu)
// =====================================================

export interface GloriaFoodMenuResponse {
  id: number;
  restaurant_id: number;
  active: boolean;
  currency: string;
  categories: MenuCategory[];
}

export interface MenuCategory {
  id: number;
  name: string;
  description?: string;
  active: boolean;
  items: MenuItem[];
  groups?: MenuOptionGroup[];
}

export interface MenuItem {
  id: number;
  name: string;
  description?: string;
  price: number;
  active: boolean;
  tags?: MenuItemTag[];
  sizes?: MenuItemSize[];
  groups?: MenuOptionGroup[];
  extras?: MenuItemExtras;
}

export type MenuItemTag = 'HOT' | 'VEGETARIAN' | 'VEGAN' | 'GLUTEN_FREE' | 'HALAL' | 'NUT_FREE' | 'DAIRY_FREE' | 'RAW';

export interface MenuItemExtras {
  menu_item_order_types?: ('pickup' | 'delivery')[];
  menu_item_kitchen_internal_name?: string;
  menu_item_allergens_ids?: number[];
  menu_item_allergens_values?: Allergen[];
  menu_item_nutritional_values?: NutritionalValue[];
  menu_item_nutritional_values_size?: string;
}

export interface Allergen {
  id: number;
  name: string;
}

export interface NutritionalValue {
  id: number;
  value: string;
}

export interface MenuItemSize {
  id: number;
  name: string;
  price: number;
  default: boolean;
  groups?: MenuOptionGroup[];
}

export interface MenuOptionGroup {
  id: number;
  name: string;
  required: boolean;
  allow_quantity: boolean;
  force_min: number;
  force_max: number;
  options: MenuOption[];
}

export interface MenuOption {
  id: number;
  name: string;
  price: number;
  default: boolean;
  extras?: {
    menu_option_kitchen_internal_name?: string;
  };
}

// =====================================================
// TIPOS INTERNOS DE LA APLICACIÓN
// =====================================================

export interface Restaurant {
  id: number;
  gloriafood_id: number | null;
  restaurant_key: string;
  name: string;
  timezone: string;
  currency: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: number;
  gloriafood_id: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  order_count: number;
  marketing_consent: boolean;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: number;
  gloriafood_id: number;
  pos_system_id: number | null;
  restaurant_id: number | null;
  client_id: number | null;
  status: string;
  type: 'pickup' | 'delivery';
  source: string | null;
  currency: string;
  total_price: number;
  sub_total_price: number | null;
  tax_value: number;
  tax_type: string | null;
  tax_name: string | null;
  payment_method: string | null;
  payment_status: string;
  instructions: string | null;
  fulfill_at: string | null;
  accepted_at: string | null;
  for_later: boolean;
  delivery_fee: number;
  delivery_address: string | null;
  delivery_latitude: string | null;
  delivery_longitude: string | null;
  delivery_zone: string | null;
  outside_delivery_area: boolean;
  tip_amount: number;
  raw_payload: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// TIPOS DE RESPUESTAS API
// =====================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DashboardStats {
  today: {
    orders: number;
    revenue: number;
    avgOrderValue: number;
  };
  week: {
    orders: number;
    revenue: number;
    avgOrderValue: number;
  };
  month: {
    orders: number;
    revenue: number;
    avgOrderValue: number;
  };
  recentOrders: Order[];
  topClients: Client[];
  ordersByType: {
    pickup: number;
    delivery: number;
  };
}
