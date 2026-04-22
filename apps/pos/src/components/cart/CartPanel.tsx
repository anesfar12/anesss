// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — CartPanel Component
// Live cart display — items, NFC status, VAT breakdown, loyalty points
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { Trash2, ShieldCheck, ShieldX, User2, Star } from 'lucide-react';
import { usePOSStore } from '../../stores/pos-store';
import type { LocalCartItem } from '../../lib/db/offline-db';

export function CartPanel() {
  const { activeCart, activeCustomer, removeItem, updateItemQuantity } = usePOSStore();

  const items = activeCart?.items ?? [];
  const subtotal = activeCart?.subtotal ?? 0;
  const vatAmount = activeCart?.vatAmount ?? 0;
  const total = activeCart?.total ?? 0;

  // Estimate loyalty points earned
  const pointsEstimate = Math.floor(total / 10);

  return (
    <div className="flex flex-col h-full">
      {/* Customer bar */}
      <div className="px-4 py-3 border-b border-neutral-800">
        {activeCustomer ? (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center">
              <User2 size={13} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-100 truncate">{activeCustomer.displayName}</p>
              <p className="text-xs text-neutral-500">{activeCustomer.tier} · {activeCustomer.loyaltyPoints.toLocaleString()} pts</p>
            </div>
            {activeCustomer.isVip && (
              <Star size={13} className="text-amber-400 fill-amber-400 flex-shrink-0" />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-neutral-600">
            <User2 size={14} />
            <span className="text-sm">No customer selected</span>
          </div>
        )}
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-800">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-neutral-700 text-sm">
            Cart is empty
          </div>
        ) : (
          items.map(item => (
            <CartItem
              key={item.id}
              item={item}
              onRemove={() => removeItem(item.id)}
              onQtyChange={qty => updateItemQuantity(item.id, qty)}
            />
          ))
        )}
      </div>

      {/* Totals */}
      {items.length > 0 && (
        <div className="border-t border-neutral-800 px-4 py-3 space-y-1.5 bg-neutral-900/50">
          <div className="flex justify-between text-xs text-neutral-500">
            <span>Subtotal (excl. VAT)</span>
            <span>AED {(subtotal - vatAmount < 0 ? 0 : subtotal).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-neutral-500">
            <span>VAT (5%)</span>
            <span>AED {vatAmount.toFixed(2)}</span>
          </div>
          {activeCustomer && pointsEstimate > 0 && (
            <div className="flex justify-between text-xs text-amber-500/70">
              <span>Loyalty pts to earn</span>
              <span>+{pointsEstimate} pts</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-base text-neutral-100 pt-1 border-t border-neutral-800 mt-1">
            <span>Total</span>
            <span className="text-amber-400">AED {total.toFixed(2)}</span>
          </div>
          <p className="text-[10px] text-neutral-600 text-center">
            {items.reduce((s, i) => s + i.quantity, 0)} item{items.reduce((s, i) => s + i.quantity, 0) !== 1 ? 's' : ''} · Incl. 5% VAT
          </p>
        </div>
      )}
    </div>
  );
}

// ── Cart Item ─────────────────────────────────────────────────────────────

function CartItem({ item, onRemove, onQtyChange }: {
  item: LocalCartItem;
  onRemove: () => void;
  onQtyChange: (qty: number) => void;
}) {
  return (
    <div className="px-4 py-3">
      {/* Product name + NFC badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-neutral-100 font-medium truncate">{item.productName}</p>
          <p className="text-xs text-neutral-500 truncate">{item.variantName.split('—')[1]?.trim()}</p>
        </div>
        <NfcBadge validated={item.nfcValidated} required={item.nfcBottleId !== null || !item.nfcValidated} />
      </div>

      {/* Quantity + price + remove */}
      <div className="flex items-center gap-2">
        {/* Quantity control */}
        <div className="flex items-center border border-neutral-700 rounded-lg overflow-hidden">
          <button
            onClick={() => onQtyChange(item.quantity - 1)}
            className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:bg-neutral-800 transition-colors"
          >
            −
          </button>
          <span className="w-8 text-center text-sm text-neutral-200">{item.quantity}</span>
          <button
            onClick={() => onQtyChange(item.quantity + 1)}
            className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:bg-neutral-800 transition-colors"
          >
            +
          </button>
        </div>

        {/* Line total */}
        <div className="flex-1 text-right">
          <p className="text-sm font-semibold text-neutral-100">
            AED {item.lineTotal.toFixed(2)}
          </p>
          {item.quantity > 1 && (
            <p className="text-xs text-neutral-600">@ AED {item.unitPrice.toFixed(2)}</p>
          )}
        </div>

        {/* Remove */}
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg text-neutral-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Customization preview */}
      {item.customization && Object.keys(item.customization).length > 0 && (
        <div className="mt-1.5 text-[10px] text-neutral-600 bg-neutral-800 rounded px-2 py-1">
          ✏️ {JSON.stringify(item.customization)}
        </div>
      )}
    </div>
  );
}

// ── NFC Badge ─────────────────────────────────────────────────────────────

function NfcBadge({ validated, required }: { validated: boolean; required: boolean }) {
  if (!required) return null;
  return (
    <div className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
      validated
        ? 'bg-emerald-500/20 text-emerald-400'
        : 'bg-red-500/20 text-red-400'
    }`}>
      {validated ? <ShieldCheck size={10} /> : <ShieldX size={10} />}
      NFC
    </div>
  );
}
