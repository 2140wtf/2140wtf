// src/pets/shop/types/shop.types.ts

/**
 * Shop item category for Pets items
 */
export type ShopItemCategory = 
  | 'food' 
  | 'toy' 
  | 'medicine' 
  | 'hygiene'
  | 'energy';

/**
 * Stat effects that items can apply to Pets
 * 
 * All stages use the same 5 stats: hunger, happiness, energy, hygiene, health
 * For eggs, only health, hygiene, happiness are active (hunger/energy fixed at 100)
 */
export interface ItemEffect {
  hunger?: number;
  happiness?: number;
  energy?: number;
  hygiene?: number;
  health?: number;
}

/**
 * Shop item definition for Pets shop
 */
export interface ShopItem {
  id: string;
  name: string;
  type: ShopItemCategory;
  /** Default price used when currency-specific prices are omitted. */
  price: number;
  /** Optional fiat-coin price. Defaults to `price`. */
  fiatPrice?: number;
  /** Optional BAO demo-sats price. Defaults to `price`. */
  satsPrice?: number;
  icon: string;
  effect?: ItemEffect;
  status?: 'live' | 'disabled';
}

/**
 * Purchase request payload for Pets shop
 */
export interface PurchaseRequest {
  itemId: string;
  price: number;    // Single item price (for validation)
  quantity: number; // Number of items to purchase
  /** Preferred currency. When omitted the hook falls back to legacy behavior. */
  currency?: 'fiat' | 'sats';
}
