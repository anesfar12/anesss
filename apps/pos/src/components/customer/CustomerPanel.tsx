// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — CustomerPanel Component
// Customer search (offline + API), VIP profile, biometric checkout
// Black Book key info for staff coaching
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, Star, Phone, Mail, Fingerprint, Crown, Gift } from 'lucide-react';
import { db, type LocalCustomer } from '../../lib/db/offline-db';
import { usePOSStore } from '../../stores/pos-store';

const TIER_COLORS: Record<string, string> = {
  ultra:          'text-purple-300 bg-purple-500/20',
  platinum:       'text-slate-200 bg-slate-500/20',
  gold:           'text-amber-300 bg-amber-500/20',
  silver:         'text-neutral-300 bg-neutral-500/20',
  standard:       'text-neutral-500 bg-neutral-800',
  bespoke_member: 'text-rose-300 bg-rose-500/20',
};

export function CustomerPanel() {
  const [query, setQuery] = useState('');
  const { activeCustomer, setCustomer, isOnline } = usePOSStore();

  // Live search from IndexedDB
  const results = useLiveQuery(
    async () => {
      if (query.length < 2) return [];
      const q = query.toLowerCase();
      return db.customers
        .filter(c =>
          (c.displayName ?? '').toLowerCase().includes(q) ||
          (c.phone ?? '').includes(q) ||
          (c.email ?? '').toLowerCase().includes(q) ||
          String(c.customerNumber) === q
        )
        .limit(10)
        .toArray();
    },
    [query],
    []
  );

  const handleSelect = useCallback((customer: LocalCustomer) => {
    setCustomer(customer);
    setQuery('');
  }, [setCustomer]);

  const handleBiometric = useCallback(async () => {
    // Trigger Amazon One palm scan — hardware calls to NitroBiometrics on mobile
    // On web: show modal for token input
    alert('Biometric checkout: tap customer palm on Amazon One device');
  }, []);

  return (
    <div className="flex flex-col h-full bg-neutral-950">
      {/* Search */}
      <div className="p-4 border-b border-neutral-800 space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, phone, email…"
            className="w-full pl-9 pr-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl
              text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-amber-500 text-sm"
          />
        </div>

        {/* Biometric lookup button (Amazon One) */}
        <button
          onClick={handleBiometric}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
            border border-neutral-700 text-neutral-400 hover:border-amber-500/50 hover:text-amber-400
            text-sm transition-colors"
        >
          <Fingerprint size={15} />
          <span>Biometric Lookup</span>
        </button>
      </div>

      {/* Active customer profile */}
      {activeCustomer && (
        <div className="border-b border-neutral-800">
          <CustomerProfile customer={activeCustomer} onClear={() => setCustomer(null)} />
        </div>
      )}

      {/* Search results */}
      {query.length >= 2 && (
        <div className="flex-1 overflow-y-auto divide-y divide-neutral-800">
          {results.length === 0 ? (
            <div className="p-6 text-center text-neutral-600 text-sm">
              No customers found
              {!isOnline && <p className="text-xs mt-1 text-orange-400">Offline — showing cached only</p>}
            </div>
          ) : (
            results.map(customer => (
              <button
                key={customer.id}
                onClick={() => handleSelect(customer)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition-colors text-left"
              >
                <CustomerAvatar customer={customer} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-neutral-100 font-medium truncate">{customer.displayName}</span>
                    {customer.isVip && <Star size={11} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TIER_COLORS[customer.tier] ?? ''}`}>
                      {customer.tier.toUpperCase()}
                    </span>
                    {customer.phone && <span className="text-xs text-neutral-600">{customer.phone}</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-amber-400 font-medium">{customer.loyaltyPoints.toLocaleString()} pts</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Idle state */}
      {!activeCustomer && query.length < 2 && (
        <div className="flex-1 flex items-center justify-center text-center text-neutral-700 p-8">
          <div>
            <div className="text-4xl mb-3">👤</div>
            <p className="text-sm">Search for a customer or scan biometric</p>
            <p className="text-xs mt-1">Optional — checkout works without customer</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Customer Profile Card ─────────────────────────────────────────────────

function CustomerProfile({ customer, onClear }: { customer: LocalCustomer; onClear: () => void }) {
  return (
    <div className="p-4 bg-neutral-900/60">
      <div className="flex items-start gap-3">
        <CustomerAvatar customer={customer} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-neutral-100">{customer.displayName}</span>
            {customer.isVip && <Star size={13} className="text-amber-400 fill-amber-400" />}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${TIER_COLORS[customer.tier] ?? ''}`}>
              {customer.tier.replace('_', ' ').toUpperCase()}
            </span>
            <span className="text-xs text-neutral-500">#{customer.customerNumber}</span>
          </div>
          {/* Contact */}
          <div className="flex flex-col gap-1 text-xs text-neutral-500">
            {customer.phone && (
              <div className="flex items-center gap-1.5">
                <Phone size={11} />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-1.5">
                <Mail size={11} />
                <span className="truncate">{customer.email}</span>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onClear}
          className="text-neutral-600 hover:text-neutral-400 text-xs transition-colors mt-0.5"
        >
          ✕
        </button>
      </div>

      {/* Loyalty */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 bg-neutral-800 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Gift size={11} className="text-amber-400" />
            <span className="text-[10px] text-neutral-500 uppercase tracking-wide">Loyalty</span>
          </div>
          <span className="text-sm font-semibold text-amber-400">
            {customer.loyaltyPoints.toLocaleString()} pts
          </span>
        </div>
        <div className="flex-1 bg-neutral-800 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Crown size={11} className="text-neutral-400" />
            <span className="text-[10px] text-neutral-500 uppercase tracking-wide">Language</span>
          </div>
          <span className="text-sm font-semibold text-neutral-300 uppercase">
            {customer.languagePreference}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────

function CustomerAvatar({ customer, size }: { customer: LocalCustomer; size: 'sm' | 'lg' }) {
  const initials = customer.displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const dim = size === 'lg' ? 'w-12 h-12 text-base' : 'w-9 h-9 text-sm';

  return (
    <div className={`${dim} rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center font-semibold text-amber-400 flex-shrink-0`}>
      {initials}
    </div>
  );
}
