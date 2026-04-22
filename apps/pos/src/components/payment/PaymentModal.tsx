// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — PaymentModal Component
// Multi-tender payment: cash, card (SoftPOS), gift card, loyalty points
// Calls API checkout — sub-500ms SLA enforced
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useState, useCallback } from 'react';
import { CreditCard, Banknote, Gift, Star, Loader2, CheckCircle, X } from 'lucide-react';
import { usePOSStore } from '../../stores/pos-store';
import type { LocalCart } from '../../lib/db/offline-db';
import { db } from '../../lib/db/offline-db';

interface PaymentLine {
  method: 'cash' | 'card_tap' | 'gift_card' | 'loyalty_points' | 'split';
  amount: number;
  currency: string;
  reference?: string;
}

interface PaymentModalProps {
  cart: LocalCart;
  onClose: () => void;
  onComplete: () => void;
}

type CheckoutStep = 'payment' | 'processing' | 'success' | 'error';

export function PaymentModal({ cart, onClose, onComplete }: PaymentModalProps) {
  const { session, activeCustomer, setCheckoutLoading, setCheckoutError, isOnline } = usePOSStore();
  const [step, setStep] = useState<CheckoutStep>('payment');
  const [selectedMethod, setSelectedMethod] = useState<PaymentLine['method']>('card_tap');
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [receiptData, setReceiptData] = useState<{ receiptNumber: number; checkoutMs: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const remaining = cart.total - payments.reduce((s, p) => s + p.amount, 0);
  const isFullyPaid = Math.abs(remaining) < 0.01;

  const addPayment = useCallback((method: PaymentLine['method'], amount: number) => {
    setPayments(prev => [...prev, { method, amount, currency: 'AED' }]);
  }, []);

  const removePayment = useCallback((idx: number) => {
    setPayments(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleCheckout = useCallback(async () => {
    if (!session || !isFullyPaid) return;

    setStep('processing');
    setCheckoutLoading(true);

    const checkoutStart = Date.now();

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

      // Step 1: Create transaction on server (or use existing transactionId)
      let transactionId = cart.transactionId;

      if (!transactionId) {
        const createRes = await fetch(`${API_URL}/api/v1/transactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.accessToken}`,
            'X-Device-ID': 'web-pos',
            'X-Idempotency-Key': cart.id,
          },
          body: JSON.stringify({
            locationId: session.locationId,
            customerId: activeCustomer?.id ?? null,
            type: 'sale',
            channel: 'in_store',
            currency: 'AED',
          }),
        });

        if (!createRes.ok) throw new Error('Failed to create transaction');
        const { data: txData } = await createRes.json() as { data: { transactionId: string } };
        transactionId = txData.transactionId;

        // Update local cart with server transaction ID
        await db.carts.update(cart.id, { transactionId, status: 'syncing', syncedAt: Date.now() });
      }

      // Step 2: Add all items
      for (const item of cart.items) {
        const itemRes = await fetch(`${API_URL}/api/v1/transactions/${transactionId}/items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.accessToken}`,
          },
          body: JSON.stringify({
            productVariantId: item.variantId,
            quantity: item.quantity,
            overridePrice: item.unitPrice,
            discountPercent: item.discountPercent,
            nfcBottleId: item.nfcBottleId ?? undefined,
            customization: item.customization,
          }),
        });
        if (!itemRes.ok) {
          const err = await itemRes.json() as { message: string };
          throw new Error(err.message ?? 'Failed to add item');
        }
      }

      // Step 3: Complete checkout — sub-500ms SLA
      const completeRes = await fetch(`${API_URL}/api/v1/transactions/${transactionId}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.accessToken}`,
          'X-Idempotency-Key': `complete-${cart.id}`,
        },
        body: JSON.stringify({ payments }),
        signal: AbortSignal.timeout(3000),  // 3s hard timeout — checkout must not hang
      });

      if (!completeRes.ok) {
        const err = await completeRes.json() as { message: string };
        throw new Error(err.message ?? 'Checkout failed');
      }

      const { data } = await completeRes.json() as {
        data: { transactionId: string; receiptNumber: number; checkoutMs: number; loyaltyPointsEarned: number }
      };

      const totalMs = Date.now() - checkoutStart;
      console.log(`✅ Checkout complete: receipt #${data.receiptNumber} in ${data.checkoutMs}ms (total: ${totalMs}ms)`);

      // Mark cart as completed
      await db.carts.update(cart.id, { status: 'completed', transactionId, syncedAt: Date.now() });

      setReceiptData({ receiptNumber: data.receiptNumber, checkoutMs: data.checkoutMs });
      setStep('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Checkout failed';
      setErrorMessage(msg);
      setCheckoutError(msg);
      setStep('error');
      console.error('Checkout error:', err);
    } finally {
      setCheckoutLoading(false);
    }
  }, [session, cart, payments, isFullyPaid, activeCustomer]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md bg-neutral-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-neutral-800 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
          <div>
            <h2 className="font-semibold text-neutral-100">
              {step === 'success' ? 'Sale Complete' :
               step === 'error' ? 'Checkout Failed' :
               step === 'processing' ? 'Processing…' :
               'Payment'}
            </h2>
            {step === 'payment' && (
              <p className="text-xs text-neutral-500 mt-0.5">
                Total: AED {cart.total.toFixed(2)} · {cart.items.length} item{cart.items.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          {step === 'payment' && (
            <button onClick={onClose} className="text-neutral-600 hover:text-neutral-400 transition-colors">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6">
          {step === 'payment' && (
            <PaymentStep
              cart={cart}
              payments={payments}
              remaining={remaining}
              isFullyPaid={isFullyPaid}
              selectedMethod={selectedMethod}
              setSelectedMethod={setSelectedMethod}
              addPayment={addPayment}
              removePayment={removePayment}
              onCheckout={handleCheckout}
              isOnline={isOnline}
              hasCustomer={!!activeCustomer}
            />
          )}

          {step === 'processing' && (
            <div className="py-8 flex flex-col items-center gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Loader2 size={24} className="text-amber-400 animate-spin" />
              </div>
              <div>
                <p className="font-medium text-neutral-100">Processing payment…</p>
                <p className="text-xs text-neutral-500 mt-1">Please wait — do not navigate away</p>
              </div>
            </div>
          )}

          {step === 'success' && receiptData && (
            <div className="py-6 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle size={28} className="text-emerald-400" />
              </div>
              <div>
                <p className="font-semibold text-neutral-100 text-lg">
                  Receipt #{receiptData.receiptNumber}
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  AED {cart.total.toFixed(2)} charged · {receiptData.checkoutMs}ms
                </p>
              </div>
              <button
                onClick={onComplete}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold transition-colors"
              >
                New Sale
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="py-6 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center text-3xl">
                ⚠️
              </div>
              <div>
                <p className="font-semibold text-neutral-100">Checkout failed</p>
                <p className="text-sm text-red-400 mt-1">{errorMessage}</p>
              </div>
              <div className="flex gap-3 w-full">
                <button onClick={() => setStep('payment')} className="flex-1 py-3 rounded-xl border border-neutral-700 text-neutral-300 font-medium hover:bg-neutral-800 transition-colors">
                  Try Again
                </button>
                <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-neutral-700 text-neutral-300 font-medium hover:bg-neutral-800 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payment Step ──────────────────────────────────────────────────────────

function PaymentStep({
  cart, payments, remaining, isFullyPaid, selectedMethod,
  setSelectedMethod, addPayment, removePayment, onCheckout, isOnline, hasCustomer,
}: {
  cart: LocalCart;
  payments: PaymentLine[];
  remaining: number;
  isFullyPaid: boolean;
  selectedMethod: PaymentLine['method'];
  setSelectedMethod: (m: PaymentLine['method']) => void;
  addPayment: (method: PaymentLine['method'], amount: number) => void;
  removePayment: (idx: number) => void;
  onCheckout: () => void;
  isOnline: boolean;
  hasCustomer: boolean;
}) {
  const methods: { id: PaymentLine['method']; label: string; icon: React.ReactNode }[] = [
    { id: 'card_tap', label: 'Card / Tap', icon: <CreditCard size={16} /> },
    { id: 'cash', label: 'Cash', icon: <Banknote size={16} /> },
    { id: 'gift_card', label: 'Gift Card', icon: <Gift size={16} /> },
    { id: 'loyalty_points', label: 'Loyalty', icon: <Star size={16} /> },
  ];

  return (
    <div className="space-y-4">
      {/* Amount remaining */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-800">
        <span className="text-sm text-neutral-400">Remaining</span>
        <span className={`text-xl font-bold ${remaining <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
          AED {Math.max(0, remaining).toFixed(2)}
        </span>
      </div>

      {/* Payments added */}
      {payments.length > 0 && (
        <div className="space-y-1.5">
          {payments.map((p, i) => (
            <div key={i} className="flex items-center justify-between bg-neutral-800 px-3 py-2 rounded-lg">
              <span className="text-sm text-neutral-300 capitalize">{p.method.replace('_', ' ')}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-100">AED {p.amount.toFixed(2)}</span>
                <button onClick={() => removePayment(i)} className="text-neutral-600 hover:text-red-400 transition-colors">
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Method selector */}
      {!isFullyPaid && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {methods.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedMethod(m.id)}
                className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  selectedMethod === m.id
                    ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                    : 'border-neutral-700 text-neutral-500 hover:border-neutral-600'
                }`}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* Quick charge buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => addPayment(selectedMethod, remaining)}
              className="py-3 rounded-xl border border-neutral-700 text-sm font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              Exact: AED {remaining.toFixed(2)}
            </button>
            {[500, 1000].map(amt => remaining > amt && (
              <button
                key={amt}
                onClick={() => addPayment(selectedMethod, amt)}
                className="py-3 rounded-xl border border-neutral-700 text-sm font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                AED {amt.toFixed(2)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Offline warning */}
      {!isOnline && (
        <div className="text-xs text-orange-400 bg-orange-400/10 rounded-lg px-3 py-2 text-center">
          Offline — payment recorded locally, will sync when reconnected
        </div>
      )}

      {/* Checkout button */}
      <button
        onClick={onCheckout}
        disabled={!isFullyPaid}
        className="w-full py-4 rounded-xl font-semibold text-base transition-all
          bg-amber-500 hover:bg-amber-400 text-neutral-950
          disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
      >
        {isFullyPaid ? `Complete Sale — AED ${cart.total.toFixed(2)}` : `Add AED ${remaining.toFixed(2)} more`}
      </button>
    </div>
  );
}
