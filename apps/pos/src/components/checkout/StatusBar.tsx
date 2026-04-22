// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — StatusBar Component
// Shows: online/offline, CRDT sync status, pending delta count, staff name
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { Wifi, WifiOff, RefreshCw, User, AlertCircle } from 'lucide-react';

interface StatusBarProps {
  isOnline: boolean;
  isSyncing: boolean;
  pendingDeltas: number;
  staffName: string;
}

export function StatusBar({ isOnline, isSyncing, pendingDeltas, staffName }: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800 text-xs">
      {/* Left: Brand */}
      <div className="flex items-center gap-2">
        <span className="text-amber-400 font-semibold tracking-widest text-xs">LUXE POS</span>
        <span className="text-neutral-600">v5.1</span>
      </div>

      {/* Center: Sync status */}
      <div className="flex items-center gap-3">
        {/* Online/Offline */}
        <div className={`flex items-center gap-1.5 ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
          {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{isOnline ? 'Online' : 'Offline'}</span>
        </div>

        {/* Sync indicator */}
        {isSyncing && (
          <div className="flex items-center gap-1.5 text-amber-400">
            <RefreshCw size={13} className="animate-spin" />
            <span>Syncing…</span>
          </div>
        )}

        {/* Pending deltas badge */}
        {!isSyncing && pendingDeltas > 0 && (
          <div className="flex items-center gap-1.5 text-orange-400">
            <AlertCircle size={13} />
            <span>{pendingDeltas} pending</span>
          </div>
        )}

        {!isSyncing && pendingDeltas === 0 && isOnline && (
          <span className="text-neutral-600">All synced</span>
        )}
      </div>

      {/* Right: Staff */}
      <div className="flex items-center gap-1.5 text-neutral-400">
        <User size={13} />
        <span>{staffName}</span>
      </div>
    </div>
  );
}
