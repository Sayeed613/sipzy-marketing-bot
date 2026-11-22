import React from 'react';
import type { DashboardStats } from '../utils/api';

interface StatDefinition {
  key: keyof DashboardStats;
  label: string;
  hint: string;
  accent: 'green' | 'orange' | 'cream';
}

const STATS: StatDefinition[] = [
  { key: 'totalLeads', label: 'Total Leads', hint: 'Businesses in the pipeline', accent: 'green' },
  { key: 'totalEnquiries', label: 'Total Enquiries', hint: 'All customer enquiries', accent: 'cream' },
  { key: 'newEnquiries', label: 'New Enquiries', hint: 'Awaiting first response', accent: 'orange' },
  { key: 'interestedCustomers', label: 'Interested', hint: 'Interested or asked for info', accent: 'green' },
  { key: 'quoteRequests', label: 'Quote Requests', hint: 'Quote, sample or quotation', accent: 'orange' },
  { key: 'confirmedOrders', label: 'Confirmed Orders', hint: 'Negotiation or confirmed', accent: 'green' },
  { key: 'outreachReadyLeads', label: 'Outreach Ready', hint: 'Leads not on the suppression list', accent: 'cream' },
  { key: 'suppressedContacts', label: 'Suppressed', hint: 'Permanent do-not-contact contacts', accent: 'orange' },
];

const ACCENT_CLASSES: Record<StatDefinition['accent'], { bar: string; icon: string }> = {
  green: { bar: 'bg-sipzy-green', icon: 'bg-sipzy-green/10 text-sipzy-green' },
  orange: { bar: 'bg-sipzy-orange', icon: 'bg-sipzy-orange/10 text-sipzy-orange' },
  cream: { bar: 'bg-sipzy-cream-border', icon: 'bg-sipzy-hover text-sipzy-text' },
};

const StatCard: React.FC<{ definition: StatDefinition; value: number }> = ({ definition, value }) => {
  const accent = ACCENT_CLASSES[definition.accent];
  return (
    <article className="relative overflow-hidden rounded-xl border border-sipzy-border bg-white p-4 shadow-sm transition hover:shadow-md">
      <span className={`absolute inset-y-0 left-0 w-1 ${accent.bar}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 pl-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-sipzy-muted">
            {definition.label}
          </p>
          <p className="mt-2 text-3xl font-bold leading-none text-sipzy-text tabular-nums">{value}</p>
          <p className="mt-2 truncate text-xs text-sipzy-muted">{definition.hint}</p>
        </div>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${accent.icon}`}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 8-8" />
          </svg>
        </span>
      </div>
    </article>
  );
};

const DashboardStatsCards: React.FC<{ stats: DashboardStats | null; loading: boolean }> = ({
  stats,
  loading,
}) => {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: STATS.length }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm"
            aria-hidden="true"
          >
            <div className="h-3 w-20 animate-pulse rounded bg-sipzy-border" />
            <div className="mt-3 h-7 w-12 animate-pulse rounded bg-sipzy-border" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded-xl border border-sipzy-border bg-white p-5 text-sm text-sipzy-muted shadow-sm">
        Statistics are unavailable right now.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {STATS.map((definition) => (
        <StatCard key={definition.key} definition={definition} value={stats[definition.key]} />
      ))}
    </div>
  );
};

export default DashboardStatsCards;
