// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Main POS Terminal Page
// Touch-optimized checkout interface with offline-first CRDT
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useState } from 'react';
import { usePOSStore } from '../stores/pos-store';
import { CartPanel } from '../components/cart/CartPanel';
import { ProductSearch } from '../components/checkout/ProductSearch';
import { CustomerPanel } from '../components/customer/CustomerPanel';
import { PaymentModal } from '../components/payment/PaymentModal';
import { StatusBar } from '../components/checkout/StatusBar';
import { NFCIndicator } from '../components/nfc/NFCIndicator';
import { crdtSync } from '../lib/crdt/sync-engine';
import { db } from '../lib/db/offline-db';

export default function POSPage() {
  const { session, activeCart, isOnline, isSyncing, pendingDeltaCount, createNewCart } = usePOSStore();
  const [showPayment, setShowPayment] = useState(false);
  const [activeTab, setActiveTab] = useState<'products' | 'customer'>('products');

  // Bootstrap: create initial cart and start CRDT sync engine
  useEffect(() => {
    if (!session) return;

    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

    // Start sync engine
    crdtSync.start(API_URL, () => session.accessToken);

    // Prime offline cache on first load
    crdtSync.primeOfflineCache(API_URL, () => session.accessToken, session.locationId);

    // Create initial cart if none exists
    if (!activeCart) {
      createNewCart(session.locationId, session.userId).catch(console.error);
    }

    return () => crdtSync.stop();
  }, [session]);

  if (!session) {
    return <LoginPrompt />;
  }

  const cartTotal = activeCart?.total ?? 0;
  const cartItemCount = activeCart?.items.length ?? 0;

  return (
    <div className="flex flex-col h-screen bg-neutral-950">
      {/* Status Bar — online/offline, sync status, NFC */}
      <StatusBar
        isOnline={isOnline}
        isSyncing={isSyncing}
        pendingDeltas={pendingDeltaCount}
        staffName={session.displayName}
      />

      {/* Main Layout: Product/Customer | Cart */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Products or Customer */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Tab switcher */}
          <div className="flex border-b border-neutral-800 bg-neutral-900">
            <TabButton
              active={activeTab === 'products'}
              onClick={() => setActiveTab('products')}
              label="Products"
            />
            <TabButton
              active={activeTab === 'customer'}
              onClick={() => setActiveTab('customer')}
              label="Customer"
            />
            <div className="ml-auto flex items-center pr-4">
              <NFCIndicator />
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab === 'products' ? <ProductSearch /> : <CustomerPanel />}
          </div>
        </div>

        {/* Right Panel — Cart */}
        <div className="w-96 flex-shrink-0 border-l border-neutral-800 flex flex-col bg-neutral-900">
          <CartPanel />

          {/* Checkout button */}
          <div className="p-4 border-t border-neutral-800">
            <button
              onClick={() => setShowPayment(true)}
              disabled={cartItemCount === 0}
              className="w-full py-4 rounded-xl font-semibold text-lg transition-all
                bg-amber-500 hover:bg-amber-400 text-neutral-950
                disabled:opacity-30 disabled:cursor-not-allowed
                active:scale-[0.98]"
            >
              {cartItemCount === 0
                ? 'Add items to checkout'
                : `Charge AED ${cartTotal.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && activeCart && (
        <PaymentModal
          cart={activeCart}
          onClose={() => setShowPayment(false)}
          onComplete={() => {
            setShowPayment(false);
            createNewCart(session.locationId, session.userId);
          }}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
        active
          ? 'border-amber-500 text-amber-400'
          : 'border-transparent text-neutral-400 hover:text-neutral-200'
      }`}
    >
      {label}
    </button>
  );
}

function LoginPrompt() {
  return (
    <div className="flex items-center justify-center h-screen bg-neutral-950">
      <div className="text-center">
        <div className="text-6xl mb-4">🏺</div>
        <h1 className="text-2xl font-semibold text-neutral-100 mb-2">LUXE POS v5.1</h1>
        <p className="text-neutral-400 mb-6">Please authenticate to begin</p>
        <a
          href="/login"
          className="px-8 py-3 bg-amber-500 text-neutral-950 rounded-xl font-semibold hover:bg-amber-400"
        >
          Sign In
        </a>
      </div>
    </div>
  );
}
