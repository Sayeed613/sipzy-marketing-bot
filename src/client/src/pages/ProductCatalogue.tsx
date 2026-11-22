import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { productsApi, type Product } from '../utils/api';

const ProductCard: React.FC<{ product: Product }> = ({ product }) => {
  const active = Boolean(product.active);

  return (
    <article className="group relative overflow-hidden rounded-xl border border-sipzy-border bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold ${
            product.product_type === 'Hot'
              ? 'bg-sipzy-orange/10 text-sipzy-orange'
              : 'bg-sipzy-green/10 text-sipzy-green'
          }`}
        >
          {product.cup_size.replace('ml', '')}
          <span className="text-[9px] font-semibold">ml</span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            active ? 'bg-sipzy-green/10 text-sipzy-green' : 'bg-sipzy-muted/10 text-sipzy-muted'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-sipzy-green-light' : 'bg-sipzy-muted'}`}
          />
          {active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <h3 className="mt-4 text-base font-semibold text-sipzy-text">
        {product.product_type} Cup · {product.cup_size}
      </h3>
      <p className="mt-1 text-sm text-sipzy-muted">{product.description || 'SIPZY paper cup'}</p>

      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-sipzy-border pt-3 text-xs">
        <div>
          <dt className="font-semibold uppercase tracking-[0.08em] text-sipzy-muted">Type</dt>
          <dd className="mt-0.5 text-sipzy-text">{product.product_type}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.08em] text-sipzy-muted">Size</dt>
          <dd className="mt-0.5 text-sipzy-text">{product.cup_size}</dd>
        </div>
      </dl>
    </article>
  );
};

const ProductCatalogue: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await productsApi.list();
      setProducts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the product catalogue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const order = ['Hot', 'Cold'];
    return order
      .map((type) => ({
        type,
        items: products
          .filter((product) => product.product_type === type)
          .sort((a, b) => a.cup_size.localeCompare(b.cup_size)),
      }))
      .filter((group) => group.items.length > 0);
  }, [products]);

  const activeCount = products.filter((product) => Boolean(product.active)).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Range</p>
        <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Product catalogue</h2>
        <p className="mt-1 text-sm text-sipzy-muted">
          {products.length} SIPZY variants · {activeCount} active
        </p>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={load}
            className="whitespace-nowrap text-xs font-medium text-red-700 underline"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-56 animate-pulse rounded-xl border border-sipzy-border bg-white"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-sipzy-border bg-white p-10 text-center shadow-sm">
          <p className="text-sm font-medium text-sipzy-text">No products found</p>
          <p className="mt-1 text-sm text-sipzy-muted">
            Run <code className="rounded bg-sipzy-hover px-1.5 py-0.5 text-xs">npm run db:init</code> to
            seed the six cup variants.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.type}>
              <div className="mb-3 flex items-center gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-sipzy-muted">
                  {group.type} cups
                </h3>
                <span className="h-px flex-1 bg-sipzy-border" />
                <span className="text-xs text-sipzy-muted">{group.items.length} sizes</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductCatalogue;
