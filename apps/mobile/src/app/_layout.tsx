// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Mobile Root Layout (expo-router 4.x)
// New Architecture enabled — no legacy bridge
// ═══════════════════════════════════════════════════════════════════════════

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StyleSheet } from 'react-native';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 min
      gcTime: 30 * 60 * 1000,        // 30 min
      retry: 2,
      networkMode: 'offlineFirst',   // offline-first for CRDT
    },
  },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#0a0a0a' },
            headerTintColor: '#f5f5f5',
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: '#0a0a0a' },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: 'Sign In', headerShown: false }} />
          <Stack.Screen name="customer/[id]" options={{ title: 'Customer Profile' }} />
          <Stack.Screen name="nfc-scan" options={{ title: 'NFC Scan', presentation: 'modal' }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
