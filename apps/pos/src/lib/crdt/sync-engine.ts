// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — CRDT Sync Engine
// Syncs pending deltas to server on reconnect
// Target: < 2s merge on reconnect (delta-state, not full sync)
// Blueprint Section 7 + Fix 2
// ═══════════════════════════════════════════════════════════════════════════

import { db, type CrdtDelta } from '../lib/db/offline-db';
import { usePOSStore } from '../stores/pos-store';

const SYNC_BATCH_SIZE = 50;
const SYNC_INTERVAL_MS = 5000;         // try every 5s when online
const SYNC_RETRY_MAX = 3;

class CrdtSyncEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  start(apiBaseUrl: string, getToken: () => string | null) {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      if (navigator.onLine && !this.isSyncing) {
        this.sync(apiBaseUrl, getToken).catch(console.error);
      }
    }, SYNC_INTERVAL_MS);

    // Also sync immediately on reconnect
    window.addEventListener('online', () => {
      this.sync(apiBaseUrl, getToken).catch(console.error);
    });

    console.log('[CRDT] Sync engine started');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async sync(apiBaseUrl: string, getToken: () => string | null): Promise<{ applied: number; conflicts: number }> {
    const token = getToken();
    if (!token || !navigator.onLine) return { applied: 0, conflicts: 0 };

    this.isSyncing = true;
    usePOSStore.getState().markSyncing(true);

    try {
      const syncStart = Date.now();

      // Get pending deltas
      const pending = await db.crdtDeltas
        .where('status').equals('pending')
        .and(d => d.syncAttempts < SYNC_RETRY_MAX)
        .limit(SYNC_BATCH_SIZE)
        .toArray();

      if (pending.length === 0) {
        return { applied: 0, conflicts: 0 };
      }

      // Mark as syncing
      await db.crdtDeltas.bulkUpdate(
        pending.map(d => ({ key: d.id, changes: { status: 'syncing' as const } }))
      );

      // Send batch to server
      const response = await fetch(`${apiBaseUrl}/api/v1/transactions/crdt/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          deltas: pending.map(d => ({
            documentType: d.documentType,
            documentId: d.documentId,
            deltaType: d.deltaType,
            deltaPayload: d.deltaPayload,
            vectorClock: d.vectorClock,
          })),
        }),
        signal: AbortSignal.timeout(3000), // 3s timeout for sync
      });

      if (!response.ok) {
        // Mark as pending again for retry
        await db.crdtDeltas.bulkUpdate(
          pending.map(d => ({
            key: d.id,
            changes: { status: 'pending' as const, syncAttempts: d.syncAttempts + 1 }
          }))
        );
        throw new Error(`Sync failed: ${response.status}`);
      }

      const result = await response.json() as { data: { applied: number; conflicts: number } };
      const { applied, conflicts } = result.data;

      // Mark applied deltas
      const appliedIds = pending.slice(0, applied).map(d => d.id);
      await db.crdtDeltas.where('id').anyOf(appliedIds).modify({ status: 'applied' });

      // Mark conflicts
      if (conflicts > 0) {
        const conflictIds = pending.slice(applied, applied + conflicts).map(d => d.id);
        await db.crdtDeltas.where('id').anyOf(conflictIds).modify({ status: 'conflict' });
      }

      const syncMs = Date.now() - syncStart;
      if (syncMs > 2000) {
        console.warn(`[CRDT] Sync exceeded 2s SLA: ${syncMs}ms for ${pending.length} deltas`);
      } else {
        console.log(`[CRDT] Synced ${applied} deltas in ${syncMs}ms`);
      }

      await usePOSStore.getState().updatePendingDeltaCount();
      return { applied, conflicts };
    } finally {
      this.isSyncing = false;
      usePOSStore.getState().markSyncing(false);
    }
  }

  // ── Pre-sync: pull server inventory before going offline ──────────────

  async primeOfflineCache(apiBaseUrl: string, getToken: () => string | null, locationId: string) {
    const token = getToken();
    if (!token) return;

    try {
      // Fetch top 500 products
      const [productsRes, inventoryRes, customersRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/products?limit=500`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiBaseUrl}/api/v1/inventory?locationId=${locationId}&limit=1000`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiBaseUrl}/api/v1/customers?limit=500`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (productsRes.ok) {
        const { data: products } = await productsRes.json() as { data: unknown[] };
        const { cacheProducts } = await import('../lib/db/offline-db');
        await cacheProducts(products as Parameters<typeof cacheProducts>[0]);
        console.log(`[CRDT] Cached ${products.length} products for offline use`);
      }

      if (inventoryRes.ok) {
        const { data: inventory } = await inventoryRes.json() as { data: unknown[] };
        const { cacheInventory } = await import('../lib/db/offline-db');
        await cacheInventory(inventory as Parameters<typeof cacheInventory>[0]);
      }

      if (customersRes.ok) {
        const { data: customers } = await customersRes.json() as { data: unknown[] };
        const { cacheCustomers } = await import('../lib/db/offline-db');
        await cacheCustomers(customers as Parameters<typeof cacheCustomers>[0]);
        console.log(`[CRDT] Cached ${customers.length} customers for offline lookup`);
      }
    } catch (err) {
      console.error('[CRDT] Cache priming failed:', err);
    }
  }
}

export const crdtSync = new CrdtSyncEngine();
