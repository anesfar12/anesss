// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — NitroBiometrics Module
// Blueprint Section 2.3 — Face ID / Palm — synchronous result to UI thread
// SLA: <100ms staff auth, <500ms VIP palm checkout
// Engineering Fix 7: JS fallback for Expo Go
// ═══════════════════════════════════════════════════════════════════════════

import type { HybridObject } from 'react-native-nitro-modules';

// ── Interfaces ────────────────────────────────────────────────────────────

export interface BiometricAuthResult {
  success: boolean;
  biometricType: 'face_id' | 'touch_id' | 'none';
  errorCode: string | null;
}

export interface AmazonOnePalmResult {
  success: boolean;
  biometricToken: string | null;  // provider token — raw biometric NEVER stored
  errorCode: string | null;
  latencyMs: number;
}

export interface NitroBiometrics extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // Staff Face ID auth — synchronous, <100ms SLA
  authenticateWithFaceId(reason: string): BiometricAuthResult;

  // Amazon One palm — synchronous token return, <500ms SLA
  authenticateWithAmazonOne(): AmazonOnePalmResult;

  // Check availability
  isFaceIdAvailable(): boolean;
  isAmazonOneAvailable(): boolean;

  // Enroll biometric (manager flow)
  enrollAmazonOne(customerId: string): AmazonOnePalmResult;
}

// ── Fix 7: JS fallback ────────────────────────────────────────────────────

class NitroBiometricsFallback {
  authenticateWithFaceId(_reason: string): BiometricAuthResult {
    console.warn('[NitroBiometrics] Face ID not available — fallback mode (Fix 7)');
    return { success: false, biometricType: 'none', errorCode: 'FALLBACK_MODE' };
  }

  authenticateWithAmazonOne(): AmazonOnePalmResult {
    console.warn('[NitroBiometrics] Amazon One not available — fallback mode');
    return { success: false, biometricToken: null, errorCode: 'FALLBACK_MODE', latencyMs: 0 };
  }

  isFaceIdAvailable(): boolean { return false; }
  isAmazonOneAvailable(): boolean { return false; }

  enrollAmazonOne(_customerId: string): AmazonOnePalmResult {
    return { success: false, biometricToken: null, errorCode: 'FALLBACK_MODE', latencyMs: 0 };
  }
}

let _bioModule: NitroBiometrics | NitroBiometricsFallback | null = null;

export function getNitroBiometrics(): NitroBiometrics | NitroBiometricsFallback {
  if (_bioModule) return _bioModule;

  try {
    const { NitroModules } = require('react-native-nitro-modules');
    _bioModule = NitroModules.createHybridObject<NitroBiometrics>('NitroBiometrics');
    console.log('[NitroBiometrics] Native module loaded — Face ID + Amazon One active');
  } catch {
    console.warn('[NitroBiometrics] Using JS fallback (Fix 7)');
    _bioModule = new NitroBiometricsFallback();
  }

  return _bioModule;
}
