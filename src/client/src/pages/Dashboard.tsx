import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { statsApi, type DashboardStats } from '../utils/api';
import DashboardStatsCards from '../components/DashboardStats';

const QUICK_LINKS = [
  {
    to: '/leads',
    title: 'Business Leads',
    description: 'Search, filter and maintain the businesses you are targeting.',
    cta: 'Open leads',
  },
  {
    to: '/enquiries',
    title: 'Enquiries',
    description: 'Follow each customer from first message to confirmed order.',
    cta: 'Open enquiries',
  },
  {
    to: '/catalogue',
    title: 'Product Catalogue',
    description: 'The six SIPZY cup variants — cold and hot, three sizes.',
    cta: 'View catalogue',
  },
];

/**
 * Dashboard — live overview of everything in the SQLite database.
 */
const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await statsApi.get();
      setStats(data);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard statistics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Overview</p>
          <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Your sales pipeline at a glance</h2>
          <p className="mt-1 text-sm text-sipzy-muted">
            Every number below is read live from the SIPZY database.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="text-xs text-sipzy-muted">
              Updated {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={() => load()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm font-medium text-sipzy-text shadow-sm transition hover:bg-sipzy-hover disabled:opacity-60"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h5M20 20v-5h-5M5.5 15a7 7 0 0011.9 2.4M18.5 9A7 7 0 006.6 6.6"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">Could not load statistics</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
        </div>
      )}

      <DashboardStatsCards stats={stats} loading={loading} />

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-sipzy-muted">
          Jump back in
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="group rounded-xl border border-sipzy-border bg-white p-5 shadow-sm transition hover:border-sipzy-green/40 hover:shadow-md"
            >
              <h4 className="text-base font-semibold text-sipzy-text">{link.title}</h4>
              <p className="mt-1 text-sm text-sipzy-muted">{link.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-sipzy-green">
                {link.cta}
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
