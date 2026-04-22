// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — NFCIndicator Component
// Shows NFC scanning status in the status bar
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { ShieldCheck, Loader2 } from 'lucide-react';
import { usePOSStore } from '../../stores/pos-store';

export function NFCIndicator() {
  const { nfc } = usePOSStore();

  if (!nfc.isValidating && !nfc.lastResult) return null;

  if (nfc.isValidating) {
    return (
      <div className="flex items-center gap-1.5 text-amber-400 text-xs">
        <Loader2 size={12} className="animate-spin" />
        <span>NFC…</span>
      </div>
    );
  }

  if (nfc.lastResult) {
    const ok = nfc.lastResult.valid;
    return (
      <div className={`flex items-center gap-1.5 text-xs ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
        <ShieldCheck size={12} />
        <span>{ok ? 'Authenticated' : 'Invalid'}</span>
      </div>
    );
  }

  return null;
}
