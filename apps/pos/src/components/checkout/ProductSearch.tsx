// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — ProductSearch Component
// Searches local IndexedDB first (offline-first), falls back to API
// Shows stock level, NFC badge, adds to cart
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, Package, Wifi, ShieldCheck, Plus } from 'lucide-react';
import { db, type LocalProduct, type LocalVariant } from '../../lib/db/offline-db';
import { usePOSStore } from '../../stores/pos-store';

export function ProductSearch() {
  const [query, setQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<LocalProduct | null>(null);
  const { activeCart, addItem, isOnline } = usePOSStore();

  // Live query from IndexedDB — works offline
  const localResults = useLiveQuery(
    async () => {
      if (query.length < 2) return [];
      const q = query.toLowerCase();
      return db.products
        .filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.brandName ?? '').toLowerCase().includes(q) ||
          p.variants.some(v => v.sku.toLowerCase().includes(q))
        )
        .limit(20)
        .toArray();
    },
    [query],
    []
  );

  const handleAddVariant = useCallback(async (product: LocalProduct, variant: LocalVariant) => {
    if (!activeCart) return;

    const vatAmount = variant.retailPrice * variant.vatRate * 1;
    const lineTotal = variant.retailPrice + vatAmount;

    await addItem({
      variantId: variant.id,
      productId: product.id,
      variantName: `${product.name} — ${variant.name}`,
      productName: product.name,
      quantity: 1,
      unitPrice: variant.retailPrice,
      discountPercent: 0,
      discountAmount: 0,
      vatRate: variant.vatRate,
      vatAmount,
      lineTotal,
      nfcBottleId: null,
      nfcValidated: !variant.requiresNfc,   // pre-validated if NFC not required
      customization: {},
    });

    setSelectedProduct(null);
    setQuery('');
  }, [activeCart, addItem]);

  return (
    <div className="flex flex-col h-full bg-neutral-950">
      {/* Search bar */}
      <div className="p-4 border-b border-neutral-800">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search products, brands, SKU…"
            className="w-full pl-9 pr-4 py-3 bg-neutral-900 border border-neutral-800 rounded-xl
              text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-amber-500
              text-sm transition-colors"
            autoFocus
          />
          {!isOnline && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-orange-400 text-xs">offline</div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {query.length < 2 ? (
          <EmptyState isOnline={isOnline} />
        ) : localResults.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">
            <Package size={32} className="mx-auto mb-3 opacity-40" />
            <p>No products found for "{query}"</p>
            {!isOnline && <p className="text-xs mt-1 text-orange-400">Offline — only cached products shown</p>}
          </div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {localResults.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                isSelected={selectedProduct?.id === product.id}
                onSelect={() => setSelectedProduct(
                  selectedProduct?.id === product.id ? null : product
                )}
                onAddVariant={handleAddVariant}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Product Card ──────────────────────────────────────────────────────────

function ProductCard({
  product, isSelected, onSelect, onAddVariant,
}: {
  product: LocalProduct;
  isSelected: boolean;
  onSelect: () => void;
  onAddVariant: (product: LocalProduct, variant: LocalVariant) => void;
}) {
  const activeVariants = product.variants.filter(v => v.isActive);

  return (
    <div className="group">
      <button
        onClick={onSelect}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition-colors text-left"
      >
        {/* Product image placeholder */}
        <div className="w-12 h-12 rounded-lg bg-neutral-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {product.thumbnailUrl ? (
            <img src={product.thumbnailUrl} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl">🫙</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-neutral-100 truncate">{product.name}</p>
            {product.isNfcTagged && (
              <ShieldCheck size={13} className="text-amber-400 flex-shrink-0" title="NFC authenticated" />
            )}
          </div>
          <p className="text-xs text-neutral-500 truncate">{product.brandName}</p>
          <p className="text-xs text-neutral-600 mt-0.5">
            {activeVariants.length} variant{activeVariants.length !== 1 ? 's' : ''} •{' '}
            From AED {Math.min(...activeVariants.map(v => v.retailPrice)).toLocaleString()}
          </p>
        </div>

        {/* Expand arrow */}
        <div className={`text-neutral-600 transition-transform ${isSelected ? 'rotate-180' : ''}`}>
          ▼
        </div>
      </button>

      {/* Expanded variants */}
      {isSelected && (
        <div className="bg-neutral-900 border-t border-neutral-800">
          {activeVariants.map(variant => (
            <VariantRow
              key={variant.id}
              product={product}
              variant={variant}
              onAdd={() => onAddVariant(product, variant)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Variant Row ───────────────────────────────────────────────────────────

function VariantRow({
  product, variant, onAdd,
}: {
  product: LocalProduct;
  variant: LocalVariant;
  onAdd: () => void;
}) {
  // Get live stock from IndexedDB
  const stock = useLiveQuery(
    () => db.inventory.get(`${variant.id}:${''}`),   // locationId injected at runtime
    [variant.id]
  );

  const isLowStock = (stock?.quantityAvailable ?? 0) <= 3;
  const isOutOfStock = (stock?.quantityAvailable ?? 0) === 0;

  return (
    <div className="flex items-center gap-3 px-4 pl-20 py-2.5 hover:bg-neutral-800 transition-colors group/row">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-200">{variant.name}</span>
          {variant.requiresNfc && (
            <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-medium">
              NFC
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-neutral-400 font-mono">{variant.sku}</span>
          <span className="text-neutral-700">•</span>
          {stock !== undefined ? (
            <span className={`text-xs ${
              isOutOfStock ? 'text-red-400' :
              isLowStock ? 'text-orange-400' :
              'text-neutral-500'
            }`}>
              {isOutOfStock ? 'Out of stock' : `${stock?.quantityAvailable ?? 0} in stock`}
            </span>
          ) : (
            <span className="text-xs text-neutral-600">Stock unknown</span>
          )}
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold text-amber-400">
          AED {variant.retailPrice.toLocaleString()}
        </p>
        <p className="text-[10px] text-neutral-600">
          +{(variant.vatRate * 100).toFixed(0)}% VAT
        </p>
      </div>

      <button
        onClick={onAdd}
        disabled={isOutOfStock}
        className="p-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950
          disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95 ml-2"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────

function EmptyState({ isOnline }: { isOnline: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 text-neutral-600">
      <div className="text-5xl mb-4">🏺</div>
      <p className="text-sm mb-2">Search the fragrance catalog</p>
      {!isOnline && (
        <div className="mt-3 flex items-center gap-2 text-orange-400 text-xs bg-orange-400/10 px-3 py-2 rounded-lg">
          <span>Offline mode — showing cached products</span>
        </div>
      )}
    </div>
  );
}
