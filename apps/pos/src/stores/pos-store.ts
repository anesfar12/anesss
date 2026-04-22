// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Zustand POS Store
// Global state: cart, active customer, session, online/offline status
// Persisted to IndexedDB via Dexie — survives page refresh
// ═══════════════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  db, addItemToCart, removeItemFromCart, decrementInventoryLocally,
  type LocalCart, type LocalCartItem, type LocalCustomer,
} from '../lib/db/offline-db';

// ── Types ─────────────────────────────────────────────────────────────────

export interface SessionState {
  userId: string;
  orgId: string;
  locationId: string;
  role: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
}

export interface NfcValidationState {
  isValidating: boolean;
  lastResult: { valid: boolean; bottleId: string; message: string } | null;
}

export interface POSState {
  // Session
  session: SessionState | null;
  isOnline: boolean;
  isSyncing: boolean;
  pendingDeltaCount: number;

  // Active transaction
  activeCart: LocalCart | null;
  activeCartId: string | null;

  // Active customer
  activeCustomer: LocalCustomer | null;

  // NFC state
  nfc: NfcValidationState;

  // UI state
  isCheckoutLoading: boolean;
  checkoutError: string | null;

  // Actions
  setSession: (session: SessionState | null) => void;
  setOnline: (online: boolean) => void;

  // Cart actions
  createNewCart: (locationId: string, staffId: string) => Promise<string>;
  loadCart: (cartId: string) => Promise<void>;
  addItem: (item: Omit<LocalCartItem, 'id'>) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  updateItemQuantity: (itemId: string, quantity: number) => Promise<void>;
  setCustomer: (customer: LocalCustomer | null) => void;
  clearCart: () => void;

  // NFC actions
  setNfcValidating: (validating: boolean) => void;
  setNfcResult: (result: NfcValidationState['lastResult']) => void;

  // Sync
  markSyncing: (syncing: boolean) => void;
  updatePendingDeltaCount: () => Promise<void>;

  // Checkout
  setCheckoutLoading: (loading: boolean) => void;
  setCheckoutError: (error: string | null) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────

export const usePOSStore = create<POSState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    session: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    pendingDeltaCount: 0,
    activeCart: null,
    activeCartId: null,
    activeCustomer: null,
    nfc: { isValidating: false, lastResult: null },
    isCheckoutLoading: false,
    checkoutError: null,

    // ── Session ──────────────────────────────────────────────────────────
    setSession: (session) => set({ session }),

    setOnline: (isOnline) => {
      set({ isOnline });
      if (isOnline) {
        // Trigger CRDT sync when back online
        get().updatePendingDeltaCount();
      }
    },

    // ── Cart management ───────────────────────────────────────────────────
    createNewCart: async (locationId, staffId) => {
      const cartId = crypto.randomUUID();
      const cart: LocalCart = {
        id: cartId,
        transactionId: null,
        locationId,
        customerId: null,
        staffId,
        status: 'draft',
        items: [],
        subtotal: 0,
        vatAmount: 0,
        total: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        syncedAt: null,
      };
      await db.carts.add(cart);
      set({ activeCart: cart, activeCartId: cartId });
      return cartId;
    },

    loadCart: async (cartId) => {
      const cart = await db.carts.get(cartId);
      if (cart) set({ activeCart: cart, activeCartId: cartId });
    },

    addItem: async (itemData) => {
      const { activeCartId, activeCart } = get();
      if (!activeCartId || !activeCart) throw new Error('No active cart');

      const item: LocalCartItem = {
        ...itemData,
        id: crypto.randomUUID(),
      };

      await addItemToCart(activeCartId, item);

      // Decrement local inventory (CRDT PN-counter)
      const { session } = get();
      if (session) {
        await decrementInventoryLocally(
          item.variantId,
          activeCart.locationId,
          item.quantity,
        );
      }

      // Refresh cart from Dexie
      const updated = await db.carts.get(activeCartId);
      if (updated) set({ activeCart: updated });

      await get().updatePendingDeltaCount();
    },

    removeItem: async (itemId) => {
      const { activeCartId } = get();
      if (!activeCartId) return;

      await removeItemFromCart(activeCartId, itemId);

      const updated = await db.carts.get(activeCartId);
      if (updated) set({ activeCart: updated });
    },

    updateItemQuantity: async (itemId, quantity) => {
      const { activeCartId, activeCart } = get();
      if (!activeCartId || !activeCart) return;

      if (quantity <= 0) {
        await get().removeItem(itemId);
        return;
      }

      const updatedItems = activeCart.items.map(i =>
        i.id === itemId
          ? { ...i, quantity, lineTotal: (i.unitPrice * quantity) - i.discountAmount + i.vatAmount }
          : i
      );

      const subtotal = updatedItems.reduce((s, i) => s + i.unitPrice * i.quantity - i.discountAmount, 0);
      const vatAmount = updatedItems.reduce((s, i) => s + i.vatAmount, 0);
      const total = subtotal + vatAmount;

      await db.carts.update(activeCartId, {
        items: updatedItems, subtotal, vatAmount, total, updatedAt: Date.now(),
      });
      const updated = await db.carts.get(activeCartId);
      if (updated) set({ activeCart: updated });
    },

    setCustomer: (customer) => {
      set({ activeCustomer: customer });
      const { activeCartId } = get();
      if (activeCartId) {
        db.carts.update(activeCartId, { customerId: customer?.id ?? null, updatedAt: Date.now() });
      }
    },

    clearCart: () => set({ activeCart: null, activeCartId: null, activeCustomer: null }),

    // ── NFC ──────────────────────────────────────────────────────────────
    setNfcValidating: (isValidating) =>
      set((s) => ({ nfc: { ...s.nfc, isValidating } })),

    setNfcResult: (lastResult) =>
      set((s) => ({ nfc: { ...s.nfc, lastResult, isValidating: false } })),

    // ── Sync ─────────────────────────────────────────────────────────────
    markSyncing: (isSyncing) => set({ isSyncing }),

    updatePendingDeltaCount: async () => {
      const count = await db.crdtDeltas.where('status').equals('pending').count();
      set({ pendingDeltaCount: count });
    },

    // ── Checkout ─────────────────────────────────────────────────────────
    setCheckoutLoading: (isCheckoutLoading) => set({ isCheckoutLoading }),
    setCheckoutError: (checkoutError) => set({ checkoutError }),
  }))
);

// ── Online/Offline detection ──────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => usePOSStore.getState().setOnline(true));
  window.addEventListener('offline', () => usePOSStore.getState().setOnline(false));
}
