import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { enquiriesApi, type Enquiry, type EnquiryStatus } from '../utils/api';
import { useAuth } from '../auth/AuthContext';

const ENQUIRY_STATUSES: EnquiryStatus[] = [
  'new',
  'interest-requested',
  'more-info-requested',
  'quote-requested',
  'quotation-sent',
  'sample-requested',
  'negotiation',
  'confirmed-order',
  'not-interested',
  'opted-out',
];

const STATUS_LABEL: Record<EnquiryStatus, string> = {
  new: 'New',
  'interest-requested': 'Interested',
  'more-info-requested': 'More Information Requested',
  'quote-requested': 'Quote Requested',
  'quotation-sent': 'Quotation Sent',
  'sample-requested': 'Sample Requested',
  negotiation: 'Negotiation',
  'confirmed-order': 'Confirmed Order',
  'not-interested': 'Not Interested',
  'opted-out': 'Opted Out',
};

const STATUS_BADGE: Record<EnquiryStatus, string> = {
  new: 'bg-sipzy-green/10 text-sipzy-green border-sipzy-green/20',
  'interest-requested': 'bg-sipzy-green/10 text-sipzy-green border-sipzy-green/20',
  'more-info-requested': 'bg-sipzy-blue/10 text-sipzy-blue border-sipzy-blue/20',
  'quote-requested': 'bg-sipzy-purple/10 text-sipzy-purple border-sipzy-purple/20',
  'quotation-sent': 'bg-sipzy-amber/10 text-sipzy-amber border-sipzy-amber/20',
  'sample-requested': 'bg-sipzy-teal/10 text-sipzy-teal border-sipzy-teal/20',
  negotiation: 'bg-sipzy-indigo/10 text-sipzy-indigo border-sipzy-indigo/20',
  'confirmed-order': 'bg-sipzy-green text-white border-sipzy-green',
  'not-interested': 'bg-sipzy-red/10 text-sipzy-red border-sipzy-red/20',
  'opted-out': 'bg-sipzy-muted/15 text-sipzy-muted border-sipzy-border',
};

const inputClass =
  'w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text placeholder:text-sipzy-muted/70 focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20';

const EnquiryDetails: React.FC<{ enquiry: Enquiry; onClose: () => void }> = ({ enquiry, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-sipzy-overlay p-4 sm:items-center">
    <div className="w-full max-w-xl rounded-2xl border border-sipzy-border bg-white p-5 shadow-xl sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-sipzy-text">
            {enquiry.customer_name || enquiry.business_name || 'Enquiry'}
          </h3>
          <p className="mt-1 text-sm text-sipzy-muted">
            {enquiry.business_name || 'No business name'} · Received{' '}
            {new Date(enquiry.created_at).toLocaleDateString()}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-sipzy-muted transition hover:bg-sipzy-hover hover:text-sipzy-text"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <span
        className={`mt-4 inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[enquiry.enquiry_status]}`}
      >
        {STATUS_LABEL[enquiry.enquiry_status]}
      </span>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Email</dt>
          <dd className="mt-1 text-sm text-sipzy-text">{enquiry.email || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Phone</dt>
          <dd className="mt-1 text-sm text-sipzy-text">{enquiry.phone || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Product</dt>
          <dd className="mt-1 text-sm text-sipzy-text">
            {enquiry.product_type} · {enquiry.cup_size}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Quantity</dt>
          <dd className="mt-1 text-sm text-sipzy-text">{enquiry.quantity.toLocaleString()} units</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
            Delivery location
          </dt>
          <dd className="mt-1 text-sm text-sipzy-text">{enquiry.delivery_location || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
            Follow-up date
          </dt>
          <dd className="mt-1 text-sm text-sipzy-text">
            {enquiry.follow_up_date
              ? new Date(enquiry.follow_up_date).toLocaleDateString()
              : 'Not scheduled'}
          </dd>
        </div>
      </dl>

      <div className="mt-5 space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
            Original message
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg border border-sipzy-border bg-sipzy-hover/50 p-3 text-sm text-sipzy-text">
            {enquiry.original_message || 'No message recorded.'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
            AI summary
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg border border-sipzy-border bg-white p-3 text-sm text-sipzy-text">
            {enquiry.ai_summary || 'No summary available yet.'}
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end border-t border-sipzy-border pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-sipzy-border px-4 py-2 text-sm font-medium text-sipzy-text hover:bg-sipzy-hover"
        >
          Close
        </button>
      </div>
    </div>
  </div>
);

const Enquiries: React.FC = () => {
  const { canWrite } = useAuth();
  const mayEdit = canWrite('enquiries');
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [detail, setDetail] = useState<Enquiry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await enquiriesApi.list();
      setEnquiries(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load enquiries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return enquiries.filter((enquiry) => {
      if (term) {
        const haystack = `${enquiry.customer_name} ${enquiry.business_name}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (statusFilter && enquiry.enquiry_status !== statusFilter) return false;
      if (productFilter && enquiry.product_type !== productFilter) return false;
      if (sizeFilter && enquiry.cup_size !== sizeFilter) return false;
      return true;
    });
  }, [enquiries, search, statusFilter, productFilter, sizeFilter]);

  const counts = useMemo(() => {
    const open = enquiries.filter(
      (enquiry) => !['confirmed-order', 'not-interested', 'opted-out'].includes(enquiry.enquiry_status),
    ).length;
    return { total: enquiries.length, open };
  }, [enquiries]);

  const handleStatusChange = async (enquiry: Enquiry, status: EnquiryStatus) => {
    if (status === enquiry.enquiry_status) return;
    const previous = enquiry.enquiry_status;
    setSavingId(enquiry.id);
    setEnquiries((current) =>
      current.map((item) => (item.id === enquiry.id ? { ...item, enquiry_status: status } : item)),
    );
    setDetail((current) =>
      current && current.id === enquiry.id ? { ...current, enquiry_status: status } : current,
    );
    try {
      await enquiriesApi.updateStatus(enquiry.id, status);
      setError(null);
    } catch (err) {
      setEnquiries((current) =>
        current.map((item) => (item.id === enquiry.id ? { ...item, enquiry_status: previous } : item)),
      );
      setDetail((current) =>
        current && current.id === enquiry.id ? { ...current, enquiry_status: previous } : current,
      );
      setError(err instanceof Error ? err.message : 'Failed to update the enquiry status');
    } finally {
      setSavingId(null);
    }
  };

  const hasFilters = Boolean(search || statusFilter || productFilter || sizeFilter);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Customers</p>
          <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Enquiries</h2>
          <p className="mt-1 text-sm text-sipzy-muted">
            {counts.total} total · {counts.open} still open
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
              placeholder="Search customer or business name"
              aria-label="Search customer or business name"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-auto">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {ENQUIRY_STATUSES.map((status) => (
                <option key={status} value={status}>{STATUS_LABEL[status]}</option>
              ))}
            </select>
            <select
              value={productFilter}
              onChange={(event) => setProductFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by product type"
            >
              <option value="">All products</option>
              <option value="Hot">Hot cups</option>
              <option value="Cold">Cold cups</option>
            </select>
            <select
              value={sizeFilter}
              onChange={(event) => setSizeFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by cup size"
            >
              <option value="">All sizes</option>
              <option value="250ml">250ml</option>
              <option value="350ml">350ml</option>
              <option value="450ml">450ml</option>
            </select>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setProductFilter('');
                setSizeFilter('');
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
                {['Customer', 'Product', 'Quantity', 'Delivery location', 'Status', 'Updated', ''].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-sipzy-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-sipzy-muted">
                    Loading enquiries…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-sipzy-text">
                      {enquiries.length === 0 ? 'No enquiries yet' : 'No enquiries match your filters'}
                    </p>
                    <p className="mt-1 text-sm text-sipzy-muted">
                      {enquiries.length === 0
                        ? 'Enquiries captured by the bot will appear here.'
                        : 'Try a different search term or clear the filters.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((enquiry) => (
                  <tr key={enquiry.id} className="transition hover:bg-sipzy-hover/50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-sipzy-text">
                        {enquiry.customer_name || 'Unknown customer'}
                      </p>
                      <p className="text-xs text-sipzy-muted">{enquiry.business_name || enquiry.email || '—'}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-sipzy-muted">
                      {enquiry.product_type} · {enquiry.cup_size}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-sipzy-muted">
                      {enquiry.quantity.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-sipzy-muted">
                      {enquiry.delivery_location || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[enquiry.enquiry_status]} ${mayEdit ? 'hidden xl:inline-flex' : ''}`}
                        >
                          {STATUS_LABEL[enquiry.enquiry_status]}
                        </span>
                        {mayEdit && (
                          <select
                            value={enquiry.enquiry_status}
                            onChange={(event) =>
                              handleStatusChange(enquiry, event.target.value as EnquiryStatus)
                            }
                            disabled={savingId === enquiry.id}
                            aria-label={`Status for ${enquiry.customer_name || 'enquiry'}`}
                            className="rounded-lg border border-sipzy-border bg-white px-2 py-1 text-xs font-medium text-sipzy-text focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20 disabled:opacity-60"
                          >
                            {ENQUIRY_STATUSES.map((status) => (
                              <option key={status} value={status}>{STATUS_LABEL[status]}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-sipzy-muted">
                      {new Date(enquiry.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDetail(enquiry)}
                        className="text-xs font-medium text-sipzy-green hover:underline"
                      >
                        Details
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
            Showing {filtered.length} of {enquiries.length} enquiries
          </div>
        )}
      </div>

      {detail && <EnquiryDetails enquiry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
};

export default Enquiries;
