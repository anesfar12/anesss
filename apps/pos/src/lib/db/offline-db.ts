// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Dexie.js Offline Database
// IndexedDB schema for offline-first checkout
// CRDT deltas stored here until sync with server
// Service Worker caches: products, inventory, customers
// ═══════════════════════════════════════════════════════════════════════════

import Dexie, { type EntityTable } from 'dexie';

// ── Local Types ───────────────────────────────────────────────────────────

export interface LocalProduct {
  id: string;
  name: string;
  nameAr: string | null;
  brandName: string | null;
  category: string;
  thumbnailUrl: string | null;
  isNfcTagged: boolean;
  inventoryMode: string;
  variants: LocalVariant[];
  cachedAt: number;  // epoch ms
}

export interface LocalVariant {
  id: string;
  sku: string;
  name: string;
  sizeMl: number | null;
  retailPrice: number;
  vatRate: number;
  requiresNfc: boolean;
  isActive: boolean;
}

export interface LocalInventory {
  id: string;           // composite: variantId + locationId
  variantId: string;
  locationId: string;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
  reorderPoint: number;
  updatedAt: number;
}

export interface LocalCustomer {
  id: string;
  customerNumber: number;
  displayName: string;
  phone: string | null;
  email: string | null;
  tier: string;
  isVip: boolean;
  loyaltyPoints: number;
  languagePreference: string;
  cachedAt: number;
}

export interface LocalCart {
  id: string;               // device-local cart UUID
  transactionId: string | null;  // server transaction ID once synced
  locationId: string;
  customerId: string | null;
  staffId: string;
  status: 'draft' | 'syncing' | 'completed' | 'void';
  items: LocalCartItem[];
  subtotal: number;
  vatAmount: number;
  total: number;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
}

export interface LocalCartItem {
  id: string;
  variantId: string;
  productId: string;
  variantName: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  vatRate: number;
  vatAmount: number;
  lineTotal: number;
  nfcBottleId: string | null;
  nfcValidated: boolean;
  customization: Record<string, unknown>;
}

export interface CrdtDelta {
  id: string;                    // local UUID
  documentType: string;
  documentId: string;
  deltaType: string;
  deltaPayload: Record<string, unknown>;
  vectorClock: number;
  status: 'pending' | 'syncing' | 'applied' | 'conflict';
  createdAt: number;
  syncAttempts: number;
}

export interface LocalSession {
  id: string;
  userId: string;
  orgId: string;
  locationId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// ── Dexie Database ────────────────────────────────────────────────────────

export class LuxePOSDatabase extends Dexie {
  products!: EntityTable<LocalProduct, 'id'>;
  inventory!: EntityTable<LocalInventory, 'id'>;
  customers!: EntityTable<LocalCustomer, 'id'>;
  carts!: EntityTable<LocalCart, 'id'>;
  crdtDeltas!: EntityTable<CrdtDelta, 'id'>;
  sessions!: EntityTable<LocalSession, 'id'>;

  constructor() {
    super('LuxePOS_v5');

    this.version(10).stores({
      // Products — cached catalog for offline search
      products: 'id, name, brandName, category, inventoryMode, cachedAt',

      // Inventory — stock levels per variant+location
      inventory: 'id, variantId, locationId, quantityAvailable, updatedAt',

      // Customers — top 500 VIPs cached for offline biometric/phone lookup
      customers: 'id, customerNumber, phone, email, tier, cachedAt',

      // Carts — local draft carts (CRDT OR-Set for items)
      carts: 'id, transactionId, locationId, customerId, staffId, status, createdAt, updatedAt',

      // CRDT delta queue — pending syncs to server
      crdtDeltas: 'id, documentType, documentId, deltaType, status, vectorClock, createdAt',

      // Auth session
      sessions: 'id, userId, orgId',
    });
  }
}

export const db = new LuxePOSDatabase();

// ── Cart CRDT operations (OR-Set semantics) ────────────────────────────

export async function addItemToCart(cartId: string, item: LocalCartItem): Promise<void> {
  await db.transaction('rw', db.carts, db.crdtDeltas, async () => {
    const cart = await db.carts.get(cartId);
    if (!cart) throw new Error('Cart not found');

    // OR-Set add: item gets unique ID — no conflict with concurrent adds
    const updatedItems = [...cart.items, item];
    const totals = recalculateTotals(updatedItems);

    await db.carts.update(cartId, {
      items: updatedItems,
      ...totals,
      updatedAt: Date.now(),
    });

    // Queue CRDT delta for server sync
    await db.crdtDeltas.add({
      id: crypto.randomUUID(),
      documentType: 'cart',
      documentId: cartId,
      deltaType: 'or_set_add',
      deltaPayload: { item },
      vectorClock: Date.now(),
      status: 'pending',
      createdAt: Date.now(),
      syncAttempts: 0,
    });
  });
}

export async function removeItemFromCart(cartId: string, itemId: string): Promise<void> {
  await db.transaction('rw', db.carts, db.crdtDeltas, async () => {
    const cart = await db.carts.get(cartId);
    if (!cart) return;

    const updatedItems = cart.items.filter(i => i.id !== itemId);
    const totals = recalculateTotals(updatedItems);

    await db.carts.update(cartId, {
      items: updatedItems,
      ...totals,
      updatedAt: Date.now(),
    });

    // OR-Set remove: references item by unique ID — safe for concurrent removes
    await db.crdtDeltas.add({
      id: crypto.randomUUID(),
      documentType: 'cart',
      documentId: cartId,
      deltaType: 'or_set_remove',
      deltaPayload: { itemId },
      vectorClock: Date.now(),
      status: 'pending',
      createdAt: Date.now(),
      syncAttempts: 0,
    });
  });
}

// ── Inventory PN-Counter CRDT ─────────────────────────────────────────

export async function decrementInventoryLocally(
  variantId: string,
  locationId: string,
  quantity: number,
): Promise<void> {
  const id = `${variantId}:${locationId}`;
  await db.transaction('rw', db.inventory, db.crdtDeltas, async () => {
    const inv = await db.inventory.get(id);
    if (inv) {
      await db.inventory.update(id, {
        quantityOnHand: Math.max(0, inv.quantityOnHand - quantity),
        quantityAvailable: Math.max(0, inv.quantityAvailable - quantity),
        updatedAt: Date.now(),
      });
    }

    await db.crdtDeltas.add({
      id: crypto.randomUUID(),
      documentType: 'inventory',
      documentId: variantId,
      deltaType: 'pn_counter_decrement',
      deltaPayload: { variant_id: variantId, location_id: locationId, delta: -quantity, vector_clock: Date.now() },
      vectorClock: Date.now(),
      status: 'pending',
      createdAt: Date.now(),
      syncAttempts: 0,
    });
  });
}

// ── Helper: recalculate cart totals ──────────────────────────────────────

function recalculateTotals(items: LocalCartItem[]) {
  const subtotal = items.reduce((sum, i) => sum + (i.unitPrice * i.quantity) - i.discountAmount, 0);
  const vatAmount = items.reduce((sum, i) => sum + i.vatAmount, 0);
  return { subtotal, vatAmount, total: subtotal + vatAmount };
}

// ── Cache population helpers ──────────────────────────────────────────────

export async function cacheProducts(products: LocalProduct[]): Promise<void> {
  await db.products.bulkPut(products);
}

export async function cacheInventory(inventory: LocalInventory[]): Promise<void> {
  await db.inventory.bulkPut(inventory);
}

export async function cacheCustomers(customers: LocalCustomer[]): Promise<void> {
  await db.customers.bulkPut(customers);
}

export async function getPendingDeltas(): Promise<CrdtDelta[]> {
  return db.crdtDeltas.where('status').equals('pending').toArray();
}
