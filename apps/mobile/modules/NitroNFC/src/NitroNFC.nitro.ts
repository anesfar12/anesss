// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — NitroNFC Module
// Blueprint Section 2.3 — exact TypeScript interface specification
// Nitro Modules: synchronous C++ ↔ JS execution, zero serialization overhead
// SLA: <200ms NFC validation (maintained by synchronous read)
// Engineering Fix 7: JS fallback for Expo Go dev mode
// ═══════════════════════════════════════════════════════════════════════════

import type { HybridObject } from 'react-native-nitro-modules';

// ── Exact interface from Blueprint Section 2.3 ────────────────────────────

export interface NFCReadResult {
  sunMessage: string;
  bottleId: string;
  counter: number;
  isValid: boolean;
}

export interface NFCValidationResult {
  valid: boolean;
  fraudSignal: boolean;
  scanTimestamp: number;
}

export interface NitroNFC extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // Synchronous — blocks JS thread only for NFC read duration
  readNTAG424DNA(): NFCReadResult;
  validateSUNMessage(sunMessage: string, bottleId: string): NFCValidationResult;
  writeBottleChip(bottleId: string, hmacKey: string): boolean;
}

// ── Fix 7: JS fallback for Expo Go / dev environment ─────────────────────

class NitroNFCFallback {
  readNTAG424DNA(): NFCReadResult {
    console.warn('[NitroNFC] Running in fallback mode — native NFC not available (Expo Go / simulator)');
    // Return a mock valid read for development
    return {
      sunMessage: 'dev:00000:mock-hmac-signature-for-development',
      bottleId: '00000000-0000-0000-0000-000000000000',
      counter: 1,
      isValid: false,  // always false in fallback — never passes validation
    };
  }

  validateSUNMessage(_sunMessage: string, _bottleId: string): NFCValidationResult {
    return { valid: false, fraudSignal: false, scanTimestamp: Date.now() };
  }

  writeBottleChip(_bottleId: string, _hmacKey: string): boolean {
    console.warn('[NitroNFC] Write not available in fallback mode');
    return false;
  }

  isAvailable(): boolean {
    return false;
  }
}

// ── Module loader with Fix 7 fallback ────────────────────────────────────

let _nfcModule: NitroNFC | NitroNFCFallback | null = null;

export function getNitroNFC(): NitroNFC | NitroNFCFallback {
  if (_nfcModule) return _nfcModule;

  try {
    // In production builds: native Nitro Module is available
    const { NitroModules } = require('react-native-nitro-modules');
    _nfcModule = NitroModules.createHybridObject<NitroNFC>('NitroNFC');
    console.log('[NitroNFC] Native module loaded — UWB NFC active');
  } catch {
    // Fix 7: fallback to JS implementation in Expo Go / dev mode
    console.warn('[NitroNFC] Native module unavailable — using JS fallback (Fix 7)');
    _nfcModule = new NitroNFCFallback();
  }

  return _nfcModule;
}

export function isNFCNativeAvailable(): boolean {
  const mod = getNitroNFC();
  if (mod instanceof NitroNFCFallback) return false;
  return true;
}
