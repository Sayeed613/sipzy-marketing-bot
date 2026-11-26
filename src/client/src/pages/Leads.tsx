import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { leadsApi, type Lead, type OutreachStatus } from '../utils/api';
import { BUSINESS_CATEGORIES, LEAD_QUALIFICATIONS } from '../../../shared/types';

const STATUSES: OutreachStatus[] = ['new', 'contacted', 'quoted', 'won', 'lost'];

const STATUS_LABEL: Record<OutreachStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
};

const STATUS_BADGE: Record<OutreachStatus, string> = {
  new: 'bg-sipzy-green/10 text-sipzy-green',
  contacted: 'bg-sipzy-blue/10 text-sipzy-blue',
  quoted: 'bg-sipzy-amber/10 text-sipzy-amber',
  won: 'bg-sipzy-green text-white',
  lost: 'bg-sipzy-muted/15 text-sipzy-muted',
};

const LEAD_SOURCES = ['inbound', 'outbound', 'referral', 'social', 'event'];

const VERIFICATION_STATUSES = ['unverified', 'pending_review', 'verified', 'rejected'] as const;

const EMPTY_FORM = {
  business_name: '',
  business_cat: '',
  lead_qualification: 'not_reviewed' as Lead['lead_qualification'],
  verification_status: 'unverified' as Lead['verification_status'],
  website_verified: false,
  phone_verified: false,
  address_verified: false,
  business_active: 'unknown' as 'unknown' | 'true' | 'false',
  verification_source: '',
  verification_notes: '',
  verified_by: '',
  last_verified_at: '',
  approved_for_outreach: false,
  approved_by: '',
  contact_person: '',
  email: '',
  phone: '',
  city: '',
  address: '',
  website: '',
  lead_source: 'inbound',
  permission_notes: '',
  outreach_status: 'new' as OutreachStatus,
};

type LeadFormState = typeof EMPTY_FORM;

interface LeadFormProps {
  initial: Lead | null;
  onCancel: () => void;
  onSaved: () => void;
}

const inputClass =
  'w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text placeholder:text-sipzy-muted/70 focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20';

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-sipzy-muted';

const LeadForm: React.FC<LeadFormProps> = ({ initial, onCancel, onSaved }) => {
  const [form, setForm] = useState<LeadFormState>(() =>
    initial
      ? {
          business_name: initial.business_name,
          business_cat: initial.business_cat,
          lead_qualification: initial.lead_qualification || 'not_reviewed',
          verification_status: initial.verification_status || 'unverified',
          website_verified: Boolean(initial.website_verified),
          phone_verified: Boolean(initial.phone_verified),
          address_verified: Boolean(initial.address_verified),
          business_active:
            initial.business_active === true || initial.business_active === 1
              ? 'true'
              : initial.business_active === false || initial.business_active === 0
                ? 'false'
                : 'unknown',
          verification_source: initial.verification_source || '',
          verification_notes: initial.verification_notes || '',
          verified_by: initial.verified_by || '',
          last_verified_at: initial.last_verified_at || '',
          approved_for_outreach: Boolean(initial.approved_for_outreach),
          approved_by: initial.approved_by || '',
          contact_person: initial.contact_person,
          email: initial.email,
          phone: initial.phone,
          city: initial.city,
          address: initial.address,
          website: initial.website,
          lead_source: initial.lead_source || 'inbound',
          permission_notes: initial.permission_notes,
          outreach_status: initial.outreach_status,
        }
      : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<Partial<Record<keyof LeadFormState | 'form', string>>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof LeadFormState>(key: K, value: LeadFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }));
  };

  const validate = () => {
    const next: typeof errors = {};
    if (!form.business_name.trim()) next.business_name = 'Business name is required';
    if (!form.email.trim()) next.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Enter a valid email address';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validate() || saving) return;

    const payload = {
      ...form,
      business_name: form.business_name.trim(),
      email: form.email.trim(),
    };

    setSaving(true);
    try {
      if (initial) await leadsApi.update(initial.id, payload);
      else await leadsApi.create(payload);
      onSaved();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not save the lead' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {errors.form && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errors.form}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="lead-business">Business name *</label>
          <input
            id="lead-business"
            className={inputClass}
            value={form.business_name}
            onChange={(event) => set('business_name', event.target.value)}
            placeholder="Acme Coffee House"
            autoFocus
          />
          {errors.business_name && <p className="mt-1 text-xs text-red-600">{errors.business_name}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-category">Category</label>
          <select
            id="lead-category"
            className={inputClass}
            value={form.business_cat}
            onChange={(event) => set('business_cat', event.target.value)}
          >
            <option value="">Uncategorised</option>
            {BUSINESS_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
            {form.business_cat && !BUSINESS_CATEGORIES.includes(form.business_cat as (typeof BUSINESS_CATEGORIES)[number]) && (
              <option value={form.business_cat}>{form.business_cat}</option>
            )}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-qualification">Lead qualification</label>
          <select
            id="lead-qualification"
            className={inputClass}
            value={form.lead_qualification}
            onChange={(event) => set('lead_qualification', event.target.value as Lead['lead_qualification'])}
          >
            {LEAD_QUALIFICATIONS.map((qualification) => (
              <option key={qualification} value={qualification}>
                {qualification.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-contact">Contact person</label>
          <input
            id="lead-contact"
            className={inputClass}
            value={form.contact_person}
            onChange={(event) => set('contact_person', event.target.value)}
            placeholder="Jane Doe"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-email">Email *</label>
          <input
            id="lead-email"
            type="email"
            className={inputClass}
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
            placeholder="jane@acme.com"
          />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-phone">Phone</label>
          <input
            id="lead-phone"
            className={inputClass}
            value={form.phone}
            onChange={(event) => set('phone', event.target.value)}
            placeholder="+1 555 010 2030"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-city">City</label>
          <input
            id="lead-city"
            className={inputClass}
            value={form.city}
            onChange={(event) => set('city', event.target.value)}
            placeholder="Austin"
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="lead-address">Address</label>
          <input
            id="lead-address"
            className={inputClass}
            value={form.address}
            onChange={(event) => set('address', event.target.value)}
            placeholder="123 Main Street, Suite 4"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-website">Website</label>
          <input
            id="lead-website"
            className={inputClass}
            value={form.website}
            onChange={(event) => set('website', event.target.value)}
            placeholder="acme.coffee"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-source">Lead source</label>
          <select
            id="lead-source"
            className={inputClass}
            value={form.lead_source}
            onChange={(event) => set('lead_source', event.target.value)}
          >
            {LEAD_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source.charAt(0).toUpperCase() + source.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-status">Outreach status</label>
          <select
            id="lead-status"
            className={inputClass}
            value={form.outreach_status}
            onChange={(event) => set('outreach_status', event.target.value as OutreachStatus)}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <div className="rounded-xl border border-sipzy-border bg-sipzy-hover/40 p-4">
            <h4 className="mb-3 text-sm font-semibold text-sipzy-text">Verification (manual review)</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="lead-verification-status">Verification status</label>
                <select
                  id="lead-verification-status"
                  className={inputClass}
                  value={form.verification_status}
                  onChange={(event) => set('verification_status', event.target.value as Lead['verification_status'])}
                >
                  {VERIFICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>{status.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="lead-business-active">Business active</label>
                <select
                  id="lead-business-active"
                  className={inputClass}
                  value={form.business_active}
                  onChange={(event) => set('business_active', event.target.value as 'unknown' | 'true' | 'false')}
                >
                  <option value="unknown">Unknown</option>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-sipzy-text">
                <input
                  type="checkbox"
                  checked={form.website_verified}
                  onChange={(event) => set('website_verified', event.target.checked)}
                />
                Website verified
              </label>
              <label className="flex items-center gap-2 text-sm text-sipzy-text">
                <input
                  type="checkbox"
                  checked={form.phone_verified}
                  onChange={(event) => set('phone_verified', event.target.checked)}
                />
                Phone verified
              </label>
              <label className="flex items-center gap-2 text-sm text-sipzy-text">
                <input
                  type="checkbox"
                  checked={form.address_verified}
                  onChange={(event) => set('address_verified', event.target.checked)}
                />
                Address verified
              </label>
              <div>
                <label className={labelClass} htmlFor="lead-verification-source">Verification source</label>
                <input
                  id="lead-verification-source"
                  className={inputClass}
                  value={form.verification_source}
                  onChange={(event) => set('verification_source', event.target.value)}
                  placeholder="Google Business Profile, phone call, website"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="lead-verified-by">Reviewed by</label>
                <input
                  id="lead-verified-by"
                  className={inputClass}
                  value={form.verified_by}
                  onChange={(event) => set('verified_by', event.target.value)}
                  placeholder="Reviewer name"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-sipzy-text">
                <input
                  type="checkbox"
                  checked={form.approved_for_outreach}
                  onChange={(event) => set('approved_for_outreach', event.target.checked)}
                />
                Approved for outreach
              </label>
              <div>
                <label className={labelClass} htmlFor="lead-approved-by">Approved by</label>
                <input
                  id="lead-approved-by"
                  className={inputClass}
                  value={form.approved_by}
                  onChange={(event) => set('approved_by', event.target.value)}
                  placeholder="Approver name"
                  disabled={!form.approved_for_outreach}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="lead-verification-notes">Verification notes</label>
                <textarea
                  id="lead-verification-notes"
                  className={inputClass}
                  rows={3}
                  value={form.verification_notes}
                  onChange={(event) => set('verification_notes', event.target.value)}
                  placeholder="What was checked and what evidence was found"
                />
              </div>
              {form.last_verified_at && (
                <p className="sm:col-span-2 text-xs text-sipzy-muted">
                  Last reviewed: {new Date(form.last_verified_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="lead-notes">Permission notes</label>
          <input
            id="lead-notes"
            className={inputClass}
            value={form.permission_notes}
            onChange={(event) => set('permission_notes', event.target.value)}
            placeholder="Consent to contact by email"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-sipzy-border pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-sipzy-border px-4 py-2 text-sm font-medium text-sipzy-text transition hover:bg-sipzy-hover"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white transition hover:bg-sipzy-green-hover disabled:opacity-60"
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add lead'}
        </button>
      </div>
    </form>
  );
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  onClose,
  children,
}) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-sipzy-overlay p-4 sm:items-center">
    <div className="w-full max-w-2xl rounded-2xl border border-sipzy-border bg-white p-5 shadow-xl sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold text-sipzy-text">{title}</h3>
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
      {children}
    </div>
  </div>
);

const DetailField: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div>
    <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">{label}</dt>
    <dd className="mt-1 text-sm text-sipzy-text">{value?.trim() ? value : '—'}</dd>
  </div>
);

const Leads: React.FC = () => {
  const { canWrite } = useAuth();
  const mayEdit = canWrite('leads');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [qualificationFilter, setQualificationFilter] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('');
  const [qualityFilter, setQualityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [duplicateFilter, setDuplicateFilter] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [viewing, setViewing] = useState<Lead | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, duplicates] = await Promise.all([leadsApi.list(), leadsApi.duplicates()]);
      setLeads(data);
      setDuplicateIds(new Set(duplicates.flatMap((group) => group.leads.map((lead) => lead.id))));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cities = useMemo(
    () => Array.from(new Set(leads.map((lead) => lead.city).filter(Boolean))).sort(),
    [leads],
  );
  const categories = useMemo(
    () => Array.from(new Set(leads.map((lead) => lead.business_cat).filter(Boolean))).sort(),
    [leads],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (term && !lead.business_name.toLowerCase().includes(term)) return false;
      if (cityFilter && lead.city !== cityFilter) return false;
      if (categoryFilter && lead.business_cat !== categoryFilter) return false;
      if (qualificationFilter && lead.lead_qualification !== qualificationFilter) return false;
      if (verificationFilter && lead.verification_status !== verificationFilter) return false;
      if (qualityFilter && lead.quality_label !== qualityFilter) return false;
      if (statusFilter && lead.outreach_status !== statusFilter) return false;
      if (duplicateFilter && !duplicateIds.has(lead.id)) return false;
      return true;
    });
  }, [leads, search, cityFilter, categoryFilter, statusFilter]);

  const hasFilters = Boolean(search || cityFilter || categoryFilter || qualificationFilter || verificationFilter || qualityFilter || statusFilter || duplicateFilter);

  const clearFilters = () => {
    setSearch('');
    setCityFilter('');
    setCategoryFilter('');
    setQualificationFilter('');
    setVerificationFilter('');
    setQualityFilter('');
    setStatusFilter('');
    setDuplicateFilter(false);
  };

  const handleDelete = async (lead: Lead) => {
    if (!window.confirm(`Delete "${lead.business_name}"? This cannot be undone.`)) return;
    try {
      await leadsApi.remove(lead.id);
      setViewing((current) => (current?.id === lead.id ? null : current));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the lead');
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const result = await leadsApi.importCsv(text);
      setError(null);
      await load();
      window.alert(`Imported ${result.imported} lead(s); skipped ${result.skipped}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleExport = () => {
    window.location.href = leadsApi.exportUrl();
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const handleSaved = async () => {
    closeForm();
    await load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Pipeline</p>
          <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Business leads</h2>
          <p className="mt-1 text-sm text-sipzy-muted">
            {leads.length} {leads.length === 1 ? 'business' : 'businesses'} stored in the database.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportFile}
          />
          {mayEdit && (
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              className="inline-flex items-center gap-2 rounded-lg border border-sipzy-border px-4 py-2 text-sm font-medium text-sipzy-text transition hover:bg-sipzy-hover disabled:opacity-60"
            >
              {importing ? 'Importing…' : 'Import CSV'}
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg border border-sipzy-border px-4 py-2 text-sm font-medium text-sipzy-text transition hover:bg-sipzy-hover"
          >
            Export CSV
          </button>
          {mayEdit && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sipzy-green-hover"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add lead
            </button>
          )}
        </div>
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

      {/* Verification summary */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Total leads', value: leads.length },
          { label: 'Verified', value: leads.filter((lead) => lead.verification_status === 'verified').length },
          { label: 'Pending review', value: leads.filter((lead) => lead.verification_status === 'pending_review').length },
          { label: 'Rejected', value: leads.filter((lead) => lead.verification_status === 'rejected').length },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-sipzy-border bg-white p-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">{item.label}</p>
            <p className="mt-1 text-xl font-bold text-sipzy-text">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
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
              placeholder="Search business name"
              aria-label="Search business name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:w-auto">
            <select
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by city"
            >
              <option value="">All cities</option>
              {cities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <select
              value={qualificationFilter}
              onChange={(event) => setQualificationFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by qualification"
            >
              <option value="">All qualifications</option>
              {LEAD_QUALIFICATIONS.map((qualification) => (
                <option key={qualification} value={qualification}>{qualification.replace('_', ' ')}</option>
              ))}
            </select>
            <select
              value={verificationFilter}
              onChange={(event) => setVerificationFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by verification status"
            >
              <option value="">All verification</option>
              {VERIFICATION_STATUSES.map((status) => (
                <option key={status} value={status}>{status.replace('_', ' ')}</option>
              ))}
            </select>
            <select
              value={qualityFilter}
              onChange={(event) => setQualityFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by quality"
            >
              <option value="">All quality</option>
              {['High', 'Medium', 'Low'].map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className={inputClass}
              aria-label="Filter by outreach status"
            >
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>{STATUS_LABEL[status]}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs font-medium text-sipzy-muted">
              <input
                type="checkbox"
                checked={duplicateFilter}
                onChange={(event) => setDuplicateFilter(event.target.checked)}
              />
              Duplicates only
            </label>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-start whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium text-sipzy-orange hover:underline lg:self-auto"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-sipzy-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-sipzy-border text-left">
            <thead className="bg-sipzy-hover/70">
              <tr>
                {['Business', 'Contact', 'Email', 'City', 'Qualification', 'Status', 'Added', 'Actions'].map((heading) => (
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
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-sipzy-muted">
                    Loading leads…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium text-sipzy-text">
                      {leads.length === 0 ? 'No leads yet' : 'No leads match your filters'}
                    </p>
                    <p className="mt-1 text-sm text-sipzy-muted">
                      {leads.length === 0
                        ? 'Add your first business lead to get started.'
                        : 'Try clearing the search or choosing a different filter.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (leads.length === 0) {
                          setEditing(null);
                          setFormOpen(true);
                        } else {
                          clearFilters();
                        }
                      }}
                      className="mt-4 inline-flex rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white hover:bg-sipzy-green-hover"
                    >
                      {leads.length === 0 ? 'Add lead' : 'Clear filters'}
                    </button>
                  </td>
                </tr>
              ) : (
                filtered.map((lead) => (
                  <tr key={lead.id} className="transition hover:bg-sipzy-hover/50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-sipzy-text">{lead.business_name}</p>
                      <p className="text-xs text-sipzy-muted">{lead.business_cat || 'Uncategorised'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-sipzy-text">{lead.contact_person || '—'}</p>
                      <p className="text-xs text-sipzy-muted">{lead.phone || 'No phone'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-sipzy-muted">{lead.email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-sipzy-muted">{lead.city || '—'}</td>
                    <td className="px-4 py-3 text-xs text-sipzy-muted">
                      <div>{lead.lead_qualification?.replace('_', ' ') || 'not reviewed'}</div>
                      {lead.quality_label && (
                        <span className="mt-1 inline-flex rounded-full bg-sipzy-blue/10 px-2 py-0.5 text-[10px] font-medium text-sipzy-blue">
                          {lead.quality_label} ({lead.quality_score})
                        </span>
                      )}
                      {duplicateIds.has(lead.id) && (
                        <span className="ml-1 rounded-full bg-sipzy-amber/10 px-2 py-0.5 text-[10px] font-medium text-sipzy-amber">
                          Duplicate
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[lead.outreach_status]}`}
                      >
                        {STATUS_LABEL[lead.outreach_status]}
                      </span>
                      <span className="mt-1 block w-fit rounded-full bg-sipzy-muted/10 px-2.5 py-0.5 text-[10px] font-medium text-sipzy-muted">
                        {lead.verification_status?.replace('_', ' ') || 'unverified'}
                      </span>
                      {lead.approved_for_outreach ? (
                        <span className="mt-1 block w-fit rounded-full bg-sipzy-green/10 px-2.5 py-0.5 text-[10px] font-medium text-sipzy-green">
                          Approved
                        </span>
                      ) : (
                        <span className="mt-1 block w-fit rounded-full bg-sipzy-amber/10 px-2.5 py-0.5 text-[10px] font-medium text-sipzy-amber">
                          Not approved
                        </span>
                      )}
                      {lead.suppressed && (
                        <span
                          className="mt-1 block w-fit rounded-full bg-sipzy-red/10 px-2.5 py-0.5 text-xs font-medium text-sipzy-red"
                          title="On the permanent do-not-contact list — excluded from outreach-ready lists"
                        >
                          Suppressed
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-sipzy-muted">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 text-xs font-medium">
                        <button
                          type="button"
                          onClick={() => setViewing(lead)}
                          className="text-sipzy-text hover:underline"
                        >
                          View
                        </button>
                        {mayEdit && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(lead);
                                setFormOpen(true);
                              }}
                              className="text-sipzy-green hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(lead)}
                              className="text-sipzy-red hover:underline"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="border-t border-sipzy-border bg-sipzy-hover/40 px-4 py-2 text-xs text-sipzy-muted">
            Showing {filtered.length} of {leads.length} leads
          </div>
        )}
      </div>

      {formOpen && (
        <Modal title={editing ? 'Edit business lead' : 'New business lead'} onClose={closeForm}>
          <LeadForm initial={editing} onCancel={closeForm} onSaved={handleSaved} />
        </Modal>
      )}

      {viewing && (
        <Modal title={viewing.business_name} onClose={() => setViewing(null)}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Category" value={viewing.business_cat} />
            <DetailField label="Contact person" value={viewing.contact_person} />
            <DetailField label="Email" value={viewing.email} />
            <DetailField label="Phone" value={viewing.phone} />
            <DetailField label="City" value={viewing.city} />
            <DetailField label="Website" value={viewing.website} />
            <div className="sm:col-span-2">
              <DetailField label="Address" value={viewing.address} />
            </div>
            <DetailField label="Lead source" value={viewing.lead_source} />
            <DetailField label="Outreach status" value={STATUS_LABEL[viewing.outreach_status]} />
            <div className="sm:col-span-2">
              <DetailField label="Permission notes" value={viewing.permission_notes} />
            </div>
            <DetailField label="Added" value={new Date(viewing.created_at).toLocaleString()} />
          </dl>
          {viewing.quality_label && (
            <div className="mt-4 rounded-xl border border-sipzy-border bg-sipzy-hover/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Lead quality</p>
              <p className="mt-1 text-sm font-semibold text-sipzy-text">
                {viewing.quality_label} ({viewing.quality_score}/100)
              </p>
              {viewing.quality_reasons && viewing.quality_reasons.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-sipzy-muted">
                  {viewing.quality_reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="mt-4 rounded-xl border border-sipzy-border bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Verification</p>
            <dl className="mt-2 grid gap-3 sm:grid-cols-2">
              <DetailField label="Status" value={viewing.verification_status?.replace('_', ' ')} />
              <DetailField label="Business active" value={viewing.business_active === true || viewing.business_active === 1 ? 'Active' : viewing.business_active === false || viewing.business_active === 0 ? 'Inactive' : 'Unknown'} />
              <DetailField label="Website verified" value={viewing.website_verified ? 'Yes' : 'No'} />
              <DetailField label="Phone verified" value={viewing.phone_verified ? 'Yes' : 'No'} />
              <DetailField label="Address verified" value={viewing.address_verified ? 'Yes' : 'No'} />
              <DetailField label="Verification source" value={viewing.verification_source} />
              <DetailField label="Reviewed by" value={viewing.verified_by} />
              <DetailField label="Last reviewed" value={viewing.last_verified_at ? new Date(viewing.last_verified_at).toLocaleString() : undefined} />
              <div className="sm:col-span-2">
                <DetailField label="Verification notes" value={viewing.verification_notes} />
              </div>
            </dl>
          </div>
          <div className="mt-6 flex justify-end gap-2 border-t border-sipzy-border pt-4">
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="rounded-lg border border-sipzy-border px-4 py-2 text-sm font-medium text-sipzy-text hover:bg-sipzy-hover"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(viewing);
                setViewing(null);
                setFormOpen(true);
              }}
              className="rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white hover:bg-sipzy-green-hover"
            >
              Edit lead
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Leads;
