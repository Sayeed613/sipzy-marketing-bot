import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { suppressionsApi, type ContactSuppression } from '../utils/api';

/**
 * Suppressed Contacts — permanent do-not-contact registry.
 *
 * Read-only by design: the backend exposes no delete route, so there is no
 * delete control here. Records enter automatically when an enquiry is
 * classified as opted out.
 */
const Suppressions: React.FC = () => {
  const [records, setRecords] = useState<ContactSuppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await suppressionsApi.list();
      setRecords(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load suppressed contacts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    const digits = q.replace(/\D/g, '');
    return records.filter((record) => {
      const haystack = [
        record.phone,
        record.email,
        record.customer_name,
        record.business_name,
        record.source_message,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q) || (digits.length >= 3 && record.phone.includes(digits));
    });
  }, [records, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Compliance</p>
          <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Suppressed contacts</h2>
          <p className="mt-1 max-w-3xl text-sm text-sipzy-muted">
            Permanent do-not-contact list. A contact is added automatically the moment an enquiry is
            classified as opted out, and is excluded from every outreach-ready list.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-sipzy-border bg-white px-3 py-1 text-xs font-medium text-sipzy-muted">
            {records.length} {records.length === 1 ? 'contact' : 'contacts'}
          </span>
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
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-sipzy-red/25 bg-sipzy-red/5 px-4 py-3">
        <p className="text-sm font-semibold text-sipzy-red">Read-only registry</p>
        <p className="mt-1 text-xs text-sipzy-muted">
          Suppression records cannot be deleted from the dashboard, and deleting an enquiry or lead does
          not remove them. They are kept permanently so an opt-out can never be lost.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="rounded-xl border border-sipzy-border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-sipzy-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sipzy-muted">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-lg border border-sipzy-border bg-white py-2 pl-9 pr-3 text-sm text-sipzy-text placeholder:text-sipzy-muted/70 focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20"
              placeholder="Search phone, email, name or message"
              aria-label="Search suppressed contacts"
            />
          </div>
          <p className="text-xs text-sipzy-muted">
            {filtered.length} of {records.length} shown
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-sipzy-border text-left">
            <thead className="bg-sipzy-hover/70">
              <tr>
                {['Contact', 'Name / business', 'Reason', 'Source message', 'Suppressed on'].map((heading) => (
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
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-sipzy-muted">
                    Loading suppressed contacts…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-sipzy-text">
                      {records.length === 0 ? 'No suppressed contacts' : 'No records match your search'}
                    </p>
                    <p className="mt-1 text-sm text-sipzy-muted">
                      {records.length === 0
                        ? 'Contacts appear here automatically when an enquiry is classified as opted out.'
                        : 'Try a different phone number, email or name.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((record) => (
                  <tr key={record.id} className="align-top transition hover:bg-sipzy-hover/50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-sipzy-text">
                        {record.phone || record.email || 'No contact details'}
                      </p>
                      {record.phone && record.email && (
                        <p className="text-xs text-sipzy-muted">{record.email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-sipzy-text">{record.customer_name || '—'}</p>
                      <p className="text-xs text-sipzy-muted">{record.business_name || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-sipzy-red/10 px-2.5 py-0.5 text-xs font-medium text-sipzy-red">
                        {record.reason === 'opted_out' ? 'Opted out' : record.reason}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-3">
                      {record.source_message ? (
                        <details className="group">
                          <summary className="cursor-pointer list-none text-sm text-sipzy-text marker:hidden">
                            <span className="line-clamp-2 group-open:hidden">{record.source_message}</span>
                            <span className="hidden text-xs font-medium text-sipzy-green group-open:inline">
                              Hide message
                            </span>
                          </summary>
                          <p className="mt-2 whitespace-pre-line rounded-lg bg-sipzy-hover/60 p-2 text-xs text-sipzy-text">
                            {record.source_message}
                          </p>
                        </details>
                      ) : (
                        <span className="text-sm text-sipzy-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-sipzy-muted">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-sipzy-muted">
        Matching is done on normalized phone numbers (digits only) and lower-cased emails. Repeated
        opt-outs from the same contact update the existing record instead of adding a duplicate.
      </p>
    </div>
  );
};

export default Suppressions;
