import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { activityApi, type Activity as ActivityRecord } from '../utils/api';

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
};

const ACTIVITY_LABEL: Record<string, string> = {
  call: 'Call',
  email: 'Email',
  message: 'Message',
  meeting: 'Meeting',
  follow_up: 'Follow-up',
  demo: 'Demo',
};

const DELIVERY_LABEL: Record<string, string> = {
  pending: 'Pending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
};

const DELIVERY_BADGE: Record<string, string> = {
  pending: 'bg-sipzy-muted/10 text-sipzy-muted',
  sent: 'bg-sipzy-blue/10 text-sipzy-blue',
  delivered: 'bg-sipzy-green/10 text-sipzy-green',
  failed: 'bg-sipzy-red/10 text-sipzy-red',
};

const CHANNEL_BADGE: Record<string, string> = {
  email: 'bg-sipzy-blue/10 text-sipzy-blue',
  whatsapp: 'bg-sipzy-green/10 text-sipzy-green',
  manual: 'bg-sipzy-hover text-sipzy-text',
};

const inputClass =
  'w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20';

const Activity: React.FC = () => {
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await activityApi.list();
      setActivities(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load outreach activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return activities.filter((activity) => {
      if (term) {
        const haystack = `${activity.business_name ?? ''} ${activity.notes}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (channelFilter && activity.channel !== channelFilter) return false;
      if (statusFilter && activity.delivery_status !== statusFilter) return false;
      return true;
    });
  }, [activities, search, channelFilter, statusFilter]);

  const handleDelete = async (activity: ActivityRecord) => {
    const label = activity.business_name || 'this outreach record';
    if (!window.confirm(`Delete the activity for "${label}"?`)) return;
    setDeletingId(activity.id);
    try {
      await activityApi.remove(activity.id);
      setActivities((current) => current.filter((item) => item.id !== activity.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the activity');
    } finally {
      setDeletingId(null);
    }
  };

  const hasFilters = Boolean(search || channelFilter || statusFilter);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Outreach</p>
          <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Outreach activity</h2>
          <p className="mt-1 text-sm text-sipzy-muted">
            {activities.length} {activities.length === 1 ? 'record' : 'records'} of contact history.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm font-medium text-sipzy-text shadow-sm transition hover:bg-sipzy-hover sm:self-auto"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {error && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-medium text-red-700 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-xl border border-sipzy-border bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sipzy-muted">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={`${inputClass} pl-9`}
              placeholder="Search business name or notes"
              aria-label="Search business name or notes"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:w-80">
            <select
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by channel"
            >
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="manual">Manual</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by delivery status"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setChannelFilter('');
                setStatusFilter('');
              }}
              className="self-start whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium text-sipzy-orange hover:underline lg:self-auto"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-sipzy-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-sipzy-border text-left">
            <thead className="bg-sipzy-hover/70">
              <tr>
                {['Business', 'Channel', 'Activity', 'Delivery', 'Date', 'Notes', ''].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-sipzy-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-sipzy-muted">
                    Loading activity…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-sipzy-text">
                      {activities.length === 0 ? 'No outreach activity yet' : 'No records match your filters'}
                    </p>
                    <p className="mt-1 text-sm text-sipzy-muted">
                      {activities.length === 0
                        ? 'Emails, messages and calls logged by the bot will show up here.'
                        : 'Try a different search term or clear the filters.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((activity) => (
                  <tr key={activity.id} className="transition hover:bg-sipzy-hover/50">
                    <td className="px-4 py-3 text-sm font-medium text-sipzy-text">
                      {activity.business_name || 'Unlinked lead'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          CHANNEL_BADGE[activity.channel] ?? 'bg-sipzy-hover text-sipzy-text'
                        }`}
                      >
                        {CHANNEL_LABEL[activity.channel] ?? activity.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-sipzy-muted">
                      {ACTIVITY_LABEL[activity.activity_type] ?? (activity.activity_type || '—')}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          DELIVERY_BADGE[activity.delivery_status] ?? 'bg-sipzy-hover text-sipzy-text'
                        }`}
                      >
                        {DELIVERY_LABEL[activity.delivery_status] ?? activity.delivery_status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-sipzy-muted">
                      {new Date(activity.activity_date).toLocaleString([], {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="max-w-[16rem] px-4 py-3 text-sm text-sipzy-muted">
                      <span className="line-clamp-2 break-words">{activity.notes || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(activity)}
                        disabled={deletingId === activity.id}
                        className="text-xs font-medium text-sipzy-red hover:underline disabled:opacity-50"
                      >
                        {deletingId === activity.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="border-t border-sipzy-border bg-sipzy-hover/40 px-4 py-2 text-xs text-sipzy-muted">
            Showing {filtered.length} of {activities.length} records
          </div>
        )}
      </div>
    </div>
  );
};

export default Activity;
