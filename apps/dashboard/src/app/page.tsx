// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Manager Dashboard Overview
// Real-time via Socket.IO + TanStack Query + Recharts
// <1s load target via pre-aggregated snapshots
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import {
  TrendingUp, Users, Package, AlertTriangle,
  Wifi, WifiOff, Star, Zap,
} from 'lucide-react';
import { io } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

// ── Main Dashboard ────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [isOnline, setIsOnline] = useState(true);
  const [liveEvents, setLiveEvents] = useState<string[]>([]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const token = typeof window !== 'undefined'
      ? localStorage.getItem('luxe_access_token')
      : null;
    if (!token) return;

    const socket = io(`${API_URL}/ws`, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => setIsOnline(true));
    socket.on('disconnect', () => setIsOnline(false));

    socket.on('inventory:update', (data: { variantId: string; qtyRemaining: number }) => {
      setLiveEvents(prev => [
        `📦 Stock update: ${data.qtyRemaining} remaining`,
        ...prev.slice(0, 4),
      ]);
    });

    socket.on('vip:arrival', () => {
      setLiveEvents(prev => ['⭐ VIP customer arrived', ...prev.slice(0, 4)]);
    });

    return () => { socket.disconnect(); };
  }, []);

  const authHeader = typeof window !== 'undefined'
    ? { Authorization: `Bearer ${localStorage.getItem('luxe_access_token') ?? ''}` }
    : {};

  // Overview data
  const { data: overview } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/dashboard/overview`, { headers: authHeader });
      const { data } = await res.json();
      return data;
    },
    refetchInterval: 30_000,   // refresh every 30s
  });

  // Staff performance
  const { data: staff } = useQuery({
    queryKey: ['dashboard', 'staff'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/dashboard/staff?period=daily`, { headers: authHeader });
      const { data } = await res.json();
      return data;
    },
    refetchInterval: 60_000,
  });

  // Location activity
  const { data: locations } = useQuery({
    queryKey: ['dashboard', 'locations'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/v1/dashboard/locations`, { headers: authHeader });
      const { data } = await res.json();
      return data;
    },
    refetchInterval: 15_000,
  });

  // Revenue period data
  const { data: revenueData } = useQuery({
    queryKey: ['dashboard', 'revenue'],
    queryFn: async () => {
      const to = new Date().toISOString();
      const from = new Date(Date.now() - 30 * 86400000).toISOString();
      const res = await fetch(`${API_URL}/api/v1/finance/revenue/period?from=${from}&to=${to}&groupBy=day`, { headers: authHeader });
      const { data } = await res.json();
      return data;
    },
  });

  const daily = overview?.daily ?? {};
  const monthly = overview?.monthly ?? {};
  const inventory = overview?.inventory ?? {};

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">LUXE Dashboard</h1>
          <p className="text-neutral-500 text-sm mt-0.5">Real-time operations overview</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live events feed */}
          {liveEvents[0] && (
            <div className="text-xs text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded-full animate-pulse">
              {liveEvents[0]}
            </div>
          )}
          <div className={`flex items-center gap-1.5 text-xs ${isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
            {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
            {isOnline ? 'Live' : 'Disconnected'}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Revenue Today"
          value={`AED ${Number(daily['revenueToday'] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          sub={`${daily['transactionsToday'] ?? 0} sales`}
          icon={<TrendingUp size={18} />}
          color="amber"
        />
        <KPICard
          label="Revenue MTD"
          value={`AED ${Number(monthly['revenueMonth'] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          sub={`${monthly['transactionsMonth'] ?? 0} sales`}
          icon={<Zap size={18} />}
          color="emerald"
        />
        <KPICard
          label="Customers Today"
          value={String(daily['uniqueCustomersToday'] ?? 0)}
          sub="unique visitors"
          icon={<Users size={18} />}
          color="blue"
        />
        <KPICard
          label="Low Stock"
          value={String(inventory['lowStockCount'] ?? 0)}
          sub={`of ${inventory['totalSkus'] ?? 0} SKUs`}
          icon={<AlertTriangle size={18} />}
          color={Number(inventory['lowStockCount']) > 5 ? 'red' : 'neutral'}
        />
      </div>

      {/* Revenue Chart + Locations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Revenue area chart */}
        <div className="lg:col-span-2 bg-neutral-900 rounded-2xl p-6 border border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-300 mb-4">Revenue — Last 30 Days</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={revenueData ?? []}>
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }}
                tickFormatter={v => new Date(v).toLocaleDateString('en', { day: 'numeric', month: 'short' })} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }}
                tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
              <Tooltip
                contentStyle={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v: number) => [`AED ${v.toLocaleString()}`, 'Revenue']}
              />
              <Area type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={2}
                fill="url(#revenueGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Location activity */}
        <div className="bg-neutral-900 rounded-2xl p-6 border border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-300 mb-4">Boutique Activity</h2>
          <div className="space-y-3">
            {(locations ?? []).map((loc: Record<string, unknown>) => (
              <LocationTile key={String(loc['id'])} location={loc} />
            ))}
          </div>
        </div>
      </div>

      {/* Staff Performance */}
      <div className="bg-neutral-900 rounded-2xl p-6 border border-neutral-800 mb-8">
        <h2 className="text-sm font-semibold text-neutral-300 mb-4">Staff Performance Today</h2>
        {(staff ?? []).length === 0 ? (
          <p className="text-neutral-600 text-sm">No sales recorded today</p>
        ) : (
          <div className="space-y-2">
            {(staff ?? []).slice(0, 8).map((s: Record<string, unknown>, i: number) => (
              <StaffRow key={String(s['id'])} staff={s} rank={i + 1} />
            ))}
          </div>
        )}
      </div>

      {/* Inventory value card */}
      <div className="bg-neutral-900 rounded-2xl p-6 border border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-300 mb-4">Inventory Overview</h2>
        <div className="grid grid-cols-3 gap-4">
          <InventoryStat label="Total SKUs" value={String(inventory['totalSkus'] ?? 0)} />
          <InventoryStat
            label="Inventory Value"
            value={`AED ${Number(inventory['inventoryValue'] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          />
          <InventoryStat label="Low Stock" value={String(inventory['lowStockCount'] ?? 0)} alert={Number(inventory['lowStockCount']) > 5} />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  amber:   'text-amber-400 bg-amber-400/10',
  emerald: 'text-emerald-400 bg-emerald-400/10',
  blue:    'text-blue-400 bg-blue-400/10',
  red:     'text-red-400 bg-red-400/10',
  neutral: 'text-neutral-400 bg-neutral-400/10',
};

function KPICard({ label, value, sub, icon, color }: {
  label: string; value: string; sub: string;
  icon: React.ReactNode; color: string;
}) {
  const cls = COLOR_MAP[color] ?? COLOR_MAP['neutral']!;
  return (
    <div className="bg-neutral-900 rounded-2xl p-5 border border-neutral-800">
      <div className={`inline-flex p-2 rounded-xl mb-3 ${cls}`}>{icon}</div>
      <p className="text-2xl font-bold text-neutral-100">{value}</p>
      <p className="text-xs text-neutral-500 mt-0.5">{sub}</p>
      <p className="text-xs text-neutral-600 mt-1">{label}</p>
    </div>
  );
}

function LocationTile({ location }: { location: Record<string, unknown> }) {
  return (
    <div className="flex items-center justify-between p-3 bg-neutral-800 rounded-xl">
      <div>
        <p className="text-sm font-medium text-neutral-200">{String(location['name'])}</p>
        <p className="text-xs text-neutral-500">
          {String(location['activeStaff'] ?? 0)} staff · {String(location['openTransactions'] ?? 0)} open
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-amber-400">
          AED {Number(location['revenueToday'] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
        <p className="text-[10px] text-neutral-600">today</p>
      </div>
    </div>
  );
}

function StaffRow({ staff, rank }: { staff: Record<string, unknown>; rank: number }) {
  const target = Number(staff['salesTargetMonthly'] ?? 0);
  const sales = Number(staff['totalSales'] ?? 0);
  const pct = target > 0 ? Math.min(100, (sales / target) * 100) : 0;

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-xs text-neutral-600 w-5 text-right">{rank}</span>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-neutral-200">{String(staff['displayName'])}</span>
          <span className="text-sm font-semibold text-amber-400">
            AED {sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
        {target > 0 && (
          <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      <span className="text-xs text-neutral-500 w-16 text-right">
        {String(staff['transactionCount'] ?? 0)} sales
      </span>
    </div>
  );
}

function InventoryStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="bg-neutral-800 rounded-xl p-4">
      <p className={`text-xl font-bold ${alert ? 'text-red-400' : 'text-neutral-100'}`}>{value}</p>
      <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
    </div>
  );
}
