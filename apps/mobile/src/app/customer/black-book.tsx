// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Digital Black Book Screen (Mobile)
// Staff view: customer profile, scent wardrobe, key dates, hospitality prefs
// React Native 0.84+ New Architecture — Fabric renderer
// ═══════════════════════════════════════════════════════════════════════════

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';

const COLORS = {
  bg:         '#0a0a0a',
  surface:    '#141414',
  border:     '#1f1f1f',
  amber:      '#f59e0b',
  amberDim:   '#78350f',
  text:       '#f5f5f5',
  textMuted:  '#6b7280',
  textDim:    '#374151',
  emerald:    '#10b981',
  red:        '#ef4444',
  purple:     '#a855f7',
};

const TIER_COLORS: Record<string, string> = {
  ultra:    '#a855f7',
  platinum: '#cbd5e1',
  gold:     '#f59e0b',
  silver:   '#94a3b8',
  standard: '#6b7280',
};

interface CustomerProfileProps {
  customerId: string;
  apiBaseUrl: string;
  accessToken: string;
}

// ── Main Black Book Screen ────────────────────────────────────────────────

export default function BlackBookScreen({ customerId, apiBaseUrl, accessToken }: CustomerProfileProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'wardrobe' | 'dates' | 'hospitality'>('profile');
  const qc = useQueryClient();

  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // Fetch customer + black book
  const { data: customer, isLoading: loadingCustomer, refetch } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/api/v1/customers/${customerId}`, { headers });
      if (!res.ok) throw new Error('Failed to load customer');
      const { data } = await res.json();
      return data;
    },
  });

  const { data: blackBook, isLoading: loadingBB } = useQuery({
    queryKey: ['black-book', customerId],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/api/v1/customers/${customerId}/black-book`, { headers });
      if (!res.ok) throw new Error('Failed to load Black Book');
      const { data } = await res.json();
      return data;
    },
  });

  const { data: wardrobe, isLoading: loadingWardrobe } = useQuery({
    queryKey: ['wardrobe', customerId],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/api/v1/customers/${customerId}/scent-wardrobe`, { headers });
      if (!res.ok) return [];
      const { data } = await res.json();
      return data;
    },
  });

  // Update black book mutation
  const updateBBMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const res = await fetch(`${apiBaseUrl}/api/v1/customers/${customerId}/black-book`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update Black Book');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['black-book', customerId] });
    },
    onError: () => Alert.alert('Error', 'Failed to save changes'),
  });

  const isLoading = loadingCustomer || loadingBB;

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.amber} />
        <Text style={[styles.textMuted, { marginTop: 12 }]}>Loading Black Book…</Text>
      </View>
    );
  }

  if (!customer) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.textMuted}>Customer not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Customer header */}
      <CustomerHeader customer={customer} />

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['profile', 'wardrobe', 'dates', 'hospitality'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'wardrobe' ? '🫙 Wardrobe' :
               tab === 'dates' ? '📅 Dates' :
               tab === 'hospitality' ? '🥂 VIP' :
               '👤 Profile'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={COLORS.amber} />}
      >
        {activeTab === 'profile' && (
          <ProfileTab blackBook={blackBook} onUpdate={updateBBMutation.mutate} isSaving={updateBBMutation.isPending} />
        )}
        {activeTab === 'wardrobe' && (
          <WardrobeTab wardrobe={wardrobe ?? []} isLoading={loadingWardrobe} />
        )}
        {activeTab === 'dates' && (
          <DatesTab keyDates={blackBook?.keyDates ?? []} onUpdate={updateBBMutation.mutate} />
        )}
        {activeTab === 'hospitality' && (
          <HospitalityTab blackBook={blackBook} onUpdate={updateBBMutation.mutate} />
        )}
      </ScrollView>
    </View>
  );
}

// ── Customer Header ───────────────────────────────────────────────────────

function CustomerHeader({ customer }: { customer: Record<string, unknown> }) {
  const tier = customer['tier'] as string;
  const tierColor = TIER_COLORS[tier] ?? COLORS.textMuted;

  return (
    <View style={styles.header}>
      <View style={[styles.avatar, { borderColor: tierColor }]}>
        <Text style={[styles.avatarText, { color: tierColor }]}>
          {String(customer['displayName'] ?? '').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
        </Text>
      </View>
      <View style={styles.headerInfo}>
        <View style={styles.headerRow}>
          <Text style={styles.customerName}>{String(customer['displayName'])}</Text>
          {customer['isVip'] && <Text style={styles.vipBadge}>⭐ VIP</Text>}
        </View>
        <View style={styles.headerRow}>
          <Text style={[styles.tierBadge, { color: tierColor }]}>
            {tier.toUpperCase().replace('_', ' ')}
          </Text>
          <Text style={styles.textMuted}>  #{String(customer['customerNumber'])}</Text>
        </View>
        <Text style={styles.textMuted}>
          {String(customer['loyaltyPoints'] ?? 0).toLocaleString()} pts
          {customer['phone'] ? `  ·  ${customer['phone']}` : ''}
        </Text>
      </View>
    </View>
  );
}

// ── Profile Tab (Scent profile + skin science) ────────────────────────────

function ProfileTab({ blackBook, onUpdate, isSaving }: {
  blackBook: Record<string, unknown> | undefined;
  onUpdate: (updates: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [skinPh, setSkinPh] = useState(String(blackBook?.['skinPh'] ?? ''));
  const [skinType, setSkinType] = useState(String(blackBook?.['skinType'] ?? ''));
  const [spouseName, setSpouseName] = useState(String(blackBook?.['spouseName'] ?? ''));
  const [preferredBeverage, setPreferredBeverage] = useState(String(blackBook?.['preferredBeverage'] ?? ''));

  const handleSave = useCallback(() => {
    const updates: Record<string, unknown> = {};
    if (skinPh) updates['skinPh'] = parseFloat(skinPh);
    if (skinType) updates['skinType'] = skinType;
    if (spouseName) updates['spouseName'] = spouseName;
    if (preferredBeverage) updates['preferredBeverage'] = preferredBeverage;
    onUpdate(updates);
  }, [skinPh, skinType, spouseName, preferredBeverage, onUpdate]);

  const families = (blackBook?.['preferredFamilies'] as string[] | undefined) ?? [];
  const avoidedNotes = (blackBook?.['avoidedNotes'] as string[] | undefined) ?? [];

  return (
    <View style={styles.tabContent}>
      {/* Scent Profile */}
      <SectionHeader title="Scent Profile" icon="🌸" />
      {families.length > 0 ? (
        <View style={styles.tagRow}>
          {families.map(f => (
            <View key={f} style={styles.tag}>
              <Text style={styles.tagText}>{f}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.textMuted}>No preferred families recorded</Text>
      )}

      {avoidedNotes.length > 0 && (
        <>
          <Text style={[styles.label, { marginTop: 12 }]}>Avoided Notes</Text>
          <View style={styles.tagRow}>
            {avoidedNotes.map(n => (
              <View key={n} style={[styles.tag, styles.tagAvoided]}>
                <Text style={[styles.tagText, { color: COLORS.red }]}>{n}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Skin Science */}
      <SectionHeader title="Skin Science" icon="🔬" />
      <View style={styles.row}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Skin pH (4.5–7.5)</Text>
          <TextInput
            style={styles.input}
            value={skinPh}
            onChangeText={setSkinPh}
            keyboardType="decimal-pad"
            placeholder="e.g. 5.5"
            placeholderTextColor={COLORS.textMuted}
          />
        </View>
        <View style={[styles.inputGroup, { marginLeft: 12 }]}>
          <Text style={styles.label}>Skin Type</Text>
          <TextInput
            style={styles.input}
            value={skinType}
            onChangeText={setSkinType}
            placeholder="dry / oily / combo"
            placeholderTextColor={COLORS.textMuted}
          />
        </View>
      </View>

      {/* Household */}
      <SectionHeader title="Household" icon="🏠" />
      <Text style={styles.label}>Spouse / Partner Name</Text>
      <TextInput
        style={styles.input}
        value={spouseName}
        onChangeText={setSpouseName}
        placeholder="Name"
        placeholderTextColor={COLORS.textMuted}
      />

      {/* Hospitality */}
      <SectionHeader title="Preferred Beverage" icon="☕" />
      <TextInput
        style={styles.input}
        value={preferredBeverage}
        onChangeText={setPreferredBeverage}
        placeholder="Arabic coffee, green tea…"
        placeholderTextColor={COLORS.textMuted}
      />

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator size="small" color="#000" />
        ) : (
          <Text style={styles.saveButtonText}>Save Changes</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── Wardrobe Tab ──────────────────────────────────────────────────────────

function WardrobeTab({ wardrobe, isLoading }: { wardrobe: Record<string, unknown>[]; isLoading: boolean }) {
  if (isLoading) return <ActivityIndicator style={{ margin: 32 }} color={COLORS.amber} />;

  if (wardrobe.length === 0) {
    return (
      <View style={[styles.tabContent, styles.center]}>
        <Text style={{ fontSize: 40, marginBottom: 8 }}>🫙</Text>
        <Text style={styles.textMuted}>Scent Wardrobe is empty</Text>
      </View>
    );
  }

  return (
    <FlashList
      data={wardrobe}
      estimatedItemSize={80}
      renderItem={({ item }) => (
        <View style={styles.wardrobeItem}>
          <View style={styles.wardrobeInfo}>
            <Text style={styles.wardrobeName}>{String(item['productName'])}</Text>
            <Text style={styles.textMuted}>{String(item['brandName'] ?? '')}</Text>
            {(item['occasion'] as string[] | undefined)?.length ? (
              <View style={styles.tagRow}>
                {(item['occasion'] as string[]).map(o => (
                  <View key={o} style={[styles.tag, styles.tagSmall]}>
                    <Text style={[styles.tagText, { fontSize: 10 }]}>{o}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          {item['rating'] && (
            <Text style={styles.rating}>{'★'.repeat(Number(item['rating']))}</Text>
          )}
          {item['isSignature'] && (
            <View style={styles.signatureBadge}>
              <Text style={styles.signatureText}>Signature</Text>
            </View>
          )}
        </View>
      )}
      keyExtractor={item => String(item['id'])}
      contentContainerStyle={{ padding: 16 }}
    />
  );
}

// ── Dates Tab ─────────────────────────────────────────────────────────────

function DatesTab({ keyDates, onUpdate }: {
  keyDates: Array<{ type: string; date: string; notes?: string }>;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  const DATE_ICONS: Record<string, string> = {
    birthday: '🎂', anniversary: '💍', eid_gift: '🌙', custom: '📌',
  };

  return (
    <View style={styles.tabContent}>
      <SectionHeader title="Key Dates" icon="📅" />
      {keyDates.length === 0 ? (
        <Text style={styles.textMuted}>No key dates recorded</Text>
      ) : (
        keyDates.map((d, i) => (
          <View key={i} style={styles.dateItem}>
            <Text style={styles.dateIcon}>{DATE_ICONS[d.type] ?? '📌'}</Text>
            <View>
              <Text style={styles.dateType}>{d.type.replace('_', ' ').toUpperCase()}</Text>
              <Text style={styles.dateValue}>{d.date}</Text>
              {d.notes ? <Text style={styles.textMuted}>{d.notes}</Text> : null}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

// ── Hospitality Tab ───────────────────────────────────────────────────────

function HospitalityTab({ blackBook, onUpdate }: {
  blackBook: Record<string, unknown> | undefined;
  onUpdate: (updates: Record<string, unknown>) => void;
}) {
  const [hotelName, setHotelName] = useState(String(blackBook?.['hotelName'] ?? ''));
  const [yachtName, setYachtName] = useState(String(blackBook?.['yachtName'] ?? ''));
  const [jetTail, setJetTail] = useState(String(blackBook?.['privateJetTail'] ?? ''));

  return (
    <View style={styles.tabContent}>
      <SectionHeader title="VIP Logistics" icon="✈️" />
      <Text style={styles.label}>Hotel</Text>
      <TextInput style={styles.input} value={hotelName} onChangeText={setHotelName} placeholder="Burj Al Arab…" placeholderTextColor={COLORS.textMuted} />
      <Text style={[styles.label, { marginTop: 12 }]}>Yacht Name</Text>
      <TextInput style={styles.input} value={yachtName} onChangeText={setYachtName} placeholder="Vessel name" placeholderTextColor={COLORS.textMuted} />
      <Text style={[styles.label, { marginTop: 12 }]}>Private Jet Tail</Text>
      <TextInput style={styles.input} value={jetTail} onChangeText={setJetTail} placeholder="A6-XXX" placeholderTextColor={COLORS.textMuted} />
      <TouchableOpacity style={styles.saveButton} onPress={() => onUpdate({ hotelName, yachtName, privateJetTail: jetTail })}>
        <Text style={styles.saveButtonText}>Save</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Helper Components ─────────────────────────────────────────────────────

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionIcon}>{icon}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: COLORS.bg },
  center:           { alignItems: 'center', justifyContent: 'center' },
  scroll:           { flex: 1 },
  tabContent:       { padding: 16 },
  header:           { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  avatar:           { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  avatarText:       { fontSize: 18, fontWeight: '700' },
  headerInfo:       { flex: 1, marginLeft: 12 },
  headerRow:        { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  customerName:     { fontSize: 17, fontWeight: '600', color: COLORS.text },
  vipBadge:         { marginLeft: 8, fontSize: 12, color: COLORS.amber },
  tierBadge:        { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  tabBar:           { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab:              { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:        { borderBottomColor: COLORS.amber },
  tabText:          { fontSize: 11, color: COLORS.textMuted, fontWeight: '500' },
  tabTextActive:    { color: COLORS.amber },
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 10 },
  sectionIcon:      { fontSize: 16, marginRight: 8 },
  sectionTitle:     { fontSize: 14, fontWeight: '600', color: COLORS.text },
  label:            { fontSize: 12, color: COLORS.textMuted, marginBottom: 4 },
  input:            { backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text, fontSize: 14 },
  row:              { flexDirection: 'row' },
  inputGroup:       { flex: 1 },
  tagRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag:              { backgroundColor: COLORS.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.border },
  tagSmall:         { paddingHorizontal: 6, paddingVertical: 2 },
  tagAvoided:       { borderColor: COLORS.red + '40' },
  tagText:          { fontSize: 12, color: COLORS.text },
  saveButton:       { backgroundColor: COLORS.amber, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24, marginBottom: 32 },
  saveButtonText:   { fontSize: 15, fontWeight: '700', color: '#000' },
  wardrobeItem:     { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 8 },
  wardrobeInfo:     { flex: 1 },
  wardrobeName:     { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 2 },
  rating:           { color: COLORS.amber, fontSize: 14, marginLeft: 8 },
  signatureBadge:   { backgroundColor: COLORS.amberDim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  signatureText:    { color: COLORS.amber, fontSize: 10, fontWeight: '700' },
  dateItem:         { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, marginBottom: 8 },
  dateIcon:         { fontSize: 22, marginRight: 12 },
  dateType:         { fontSize: 10, fontWeight: '700', color: COLORS.amber, letterSpacing: 1 },
  dateValue:        { fontSize: 14, color: COLORS.text, marginTop: 2 },
  textMuted:        { color: COLORS.textMuted, fontSize: 13 },
});
