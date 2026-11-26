import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { leadsApi, outreachApi, type Lead } from '../utils/api';
import { useAuth } from '../auth/AuthContext';

const inputClass =
  'w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text placeholder:text-sipzy-muted/70 focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20';

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-sipzy-muted';

const EmptyState: React.FC = () => (
  <div className="rounded-xl border border-sipzy-border bg-white p-10 shadow-sm text-center">
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">No lead selected</p>
    <h3 className="mt-2 text-lg font-bold text-sipzy-text">Choose a lead to compose</h3>
    <p className="mt-1 text-sm text-sipzy-muted">
      Select a verified, approved lead from the dropdown on the left to generate a personalized intro message.
    </p>
  </div>
);

const LeadSelect: React.FC<{
  leads: Lead[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}> = ({ leads, selectedId, onSelect, loading }) => {
  const grouped = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const lead of leads) {
      const key = lead.verification_status === 'verified' ? 'verified' : 'unverified';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(lead);
    }
    return map;
  }, [leads]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-sipzy-border bg-white px-4 py-3 shadow-sm">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-sipzy-green/30 border-t-sipzy-green" />
        <p className="text-sm text-sipzy-muted">Loading leads…</p>
      </div>
    );
  }

  if (leads.length === 0) return null;

  return (
    <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
      <label className={labelClass} htmlFor="outreach-lead-select">
        Select a lead
      </label>
      <select
        id="outreach-lead-select"
        className={inputClass}
        value={selectedId || ''}
        onChange={(event) => onSelect(event.target.value || null)}
        aria-label="Select a lead for outreach"
      >
        <option value="">— Choose a lead —</option>
        {grouped.get('verified')?.map((lead) => (
          <option key={lead.id} value={lead.id}>
            {lead.business_name} — {lead.city || 'No city'} · {lead.phone || 'No phone'}
          </option>
        ))}
        {grouped.get('unverified')?.map((lead) => (
          <option key={lead.id} value={lead.id} disabled>
            {lead.business_name} — unverified / not approved
          </option>
        ))}
      </select>
      {leads.length > 0 && (
        <p className="mt-1.5 text-[11px] text-sipzy-muted">
          Only verified, approved leads can receive outreach messages.
        </p>
      )}
    </div>
  );
};

const LeadSummary: React.FC<{ lead: Lead }> = ({ lead }) => (
  <dl className="grid gap-3 sm:grid-cols-2">
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Business</dt>
      <dd className="mt-1 text-sm font-medium text-sipzy-text">{lead.business_name}</dd>
      <dd className="text-xs text-sipzy-muted">{lead.business_cat || 'Uncategorised'}</dd>
    </div>
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Contact</dt>
      <dd className="mt-1 text-sm text-sipzy-text">{lead.contact_person || '—'}</dd>
      <dd className="text-xs text-sipzy-muted">{lead.phone || 'No phone'}</dd>
    </div>
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Email</dt>
      <dd className="mt-1 text-sm text-sipzy-text">{lead.email || '—'}</dd>
    </div>
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Location</dt>
      <dd className="mt-1 text-sm text-sipzy-text">{lead.city || '—'}</dd>
      <dd className="text-xs text-sipzy-muted">{lead.address || 'No address'}</dd>
    </div>
  </dl>
);

const WhatsAppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M17.472 14.372c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197-.3-.516-.24-.668-.02-.234.35-.099.79.458.89.16.03.324.05.494.06l.704-.63c.13-.11.243-.243.338-.413l.374-.122c.143-.046.29-.057.437-.057.428 0 .847.13 1.25.42.143.102.286.233.43.394.193.38.222 1.02.261 1.66l.02.3c0 .22-.02.44-.07.65-.06.24-.17.48-.33.69-.32.32-.64.34-.967.17l-.204-.078c-.33-.127-.66-.255-.99-.382-.84-.32-1.26-.45-1.79-.53l-.04-.01h-.01c-.07 0-.36.01-.94.01-.576 0-1.15-.01-1.724-.01-.264 0-.528.01-.792.01-.143 0-.286-.01-.43-.01-1.497.01-1.497.01-2.994.01-1.5 0-2.997-.01-2.997-.01-.144 0-.287.01-.43.01-.264 0-.528-.01-.792-.01-1.094 0-1.668-.01-1.668-.01-.32 0-.64.01-.954.01-1.497 0-1.497 0-2.994 0-1.5 0-2.997 0-2.997 0l-.01-.01h-3.56l-.01.01c-.03 0-.16 0-.51 0-.43 0-.96 0-1.484.01-.264 0-.528-.01-.792-.01-.143 0-.286.01-.43.01-.264 0-.528-.01-.792-.01-1.094 0-1.668-.01-1.668 0-1.497 0-1.497 0-2.994 0-1.5 0-2.997 0-2.997 0l-.01-.01h-3.56l-.01.01c-.03 0-.16 0-.51 0-.43 0-.96 0-1.484.01-.264 0-.528-.01-.792-.01-.143 0-.286.01-.43.01-.264 0-.528-.01-.792-.01-1.094 0-1.668-.01-1.668 0-1.497 0-1.497 0-2.994 0-1.5 0-2.997 0-2.997 0l.01.01h3.56l.01-.01c.03 0 .16 0 .51 0 .43 0 .96 0 1.484.01.264 0 .528-.01.792-.01.143 0 .286.01.43.01.264 0 .528-.01.792-.01 1.094 0 1.668 0 1.668 0 1.497 0 1.497 0 2.994 0 1.5 0 2.997 0 2.997 0l.01-.01h.01c.07 0 .36 0 .94 0 .576 0 1.15 0 1.724 0 .264 0 .528 0 .792 0 .143 0 .286 0 .43-.01.264 0 .528.01.792.01 1.094 0 1.668 0 1.668 0 .32 0 .64 0 .954 0 1.497 0 1.497 0 2.994 0 1.5 0 2.997 0 2.997 0l.01.01h.01c.03 0 .16 0 .51 0 .43 0 .96 0 1.484 0 .264 0 .528 0 .792 0 .143 0 .286 0 .43 0 .01.01.02.02.02.03z"/>
  </svg>
);

const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
  </svg>
);

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5.5 15a7 7 0 0011.9 2.4M18.5 9A7 7 0 006.6 6.6" />
  </svg>
);

const Composer: React.FC = () => {
  const { canWrite } = useAuth();
  const mayCompose = canWrite('leads');

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  // Composer result state
  const [lead, setLead] = useState<Lead | null>(null);
  const [message, setMessage] = useState('');
  const [waLink, setWaLink] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [recordedActivity, setRecordedActivity] = useState<any>(null);
  const [recordNotes, setRecordNotes] = useState('');

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const data = await leadsApi.list({ exclude_suppressed: true });
      setLeads(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const handleSelect = useCallback(
    async (id: string) => {
      if (!id) return;
      setSelectedId(id);
      setComposeError(null);
      setBlockedReason(null);
      setLead(null);
      setMessage('');
      setWaLink('');
      setRecordedActivity(null);
      setRecordNotes('');

      setComposing(true);
      try {
        const result = await outreachApi.compose(id);
        if (result.allowed) {
          setAllowed(true);
          setLead(result.lead);
          setMessage(result.message || '');
          setWaLink(result.wa_link || '');
        } else {
          setAllowed(false);
          setBlockedReason(result.reason || 'Not allowed');
          setLead(result.lead || null);
        }
      } catch (err) {
        setComposeError(err instanceof Error ? err.message : 'Failed to compose message');
        setAllowed(false);
      } finally {
        setComposing(false);
      }
    },
    [],
  );

  const handleMessageChange = (text: string) => {
    setMessage(text);
    // Rebuild the wa.me link with the edited message.
    if (lead?.phone) {
      const cleaned = lead.phone.replace(/[^\d+]/g, '');
      const waPhone = cleaned.startsWith('+')
        ? cleaned
        : cleaned.startsWith('91')
          ? `+${cleaned}`
          : cleaned.length === 10 && /^[6-9]/.test(cleaned)
            ? `+91${cleaned}`
            : `+${cleaned}`;
      const encoded = encodeURIComponent(text);
      setWaLink(`https://wa.me/${waPhone}?text=${encoded}`);
    } else {
      setWaLink('');
    }
  };

  const handleOpenWhatsApp = useCallback(() => {
    if (!waLink) return;
    window.open(waLink, '_blank', 'noopener,noreferrer');
  }, [waLink]);

  const handleRecord = async () => {
    if (!lead || !message) return;
    setRecording(true);
    try {
      const activity = await outreachApi.record({
        lead_id: lead.id,
        message,
        notes: recordNotes || undefined,
        delivery_status: 'pending',
        activity_type: 'message',
      });
      setRecordedActivity(activity);
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : 'Failed to record outreach activity');
    } finally {
      setRecording(false);
    }
  };

  const handleRefresh = () => {
    setSelectedId(null);
    setLead(null);
    setMessage('');
    setWaLink('');
    setAllowed(false);
    setBlockedReason(null);
    setRecordedActivity(null);
    setRecordNotes('');
    loadLeads();
  };

  if (!mayCompose) {
    return (
      <div className="rounded-xl border border-sipzy-border bg-white p-10 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-muted">Permission required</p>
        <h3 className="mt-2 text-lg font-bold text-sipzy-text">You cannot compose outreach messages</h3>
        <p className="mt-1 text-sm text-sipzy-muted">
          Only users with lead-writing permission can use the outreach composer.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Outreach</p>
          <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Outreach Message Composer</h2>
          <p className="mt-1 text-sm text-sipzy-muted">
            Pick a lead, review the generated intro message, edit it, then open WhatsApp to send it yourself.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm font-medium text-sipzy-text shadow-sm transition hover:bg-sipzy-hover sm:self-auto"
        >
          <RefreshIcon className="h-4 w-4" />
          Refresh leads
        </button>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={() => setError(null)} className="text-xs font-medium text-red-700 underline">
            Dismiss
          </button>
        </div>
      )}

      {composeError && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{composeError}</p>
          <button type="button" onClick={() => setComposeError(null)} className="text-xs font-medium text-red-700 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Lead selection */}
        <div className="lg:col-span-2 space-y-4">
          <LeadSelect
            leads={leads}
            selectedId={selectedId}
            onSelect={handleSelect}
            loading={loading}
          />

          {lead && (
            <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sipzy-muted mb-3">Selected lead</p>
              <LeadSummary lead={lead} />

              {recordedActivity && (
                <div className="mt-4 rounded-lg border border-sipzy-green/20 bg-sipzy-green/5 p-3 text-sm text-sipzy-green">
                  <p className="font-medium">Outreach recorded</p>
                  <p className="mt-1 text-xs text-sipzy-muted">
                    Activity {recordedActivity.id} · {recordedActivity.channel} ·{' '}
                    {recordedActivity.delivery_status}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer panel */}
        <div className="lg:col-span-3 space-y-4">
          {!selectedId ? (
            <EmptyState />
          ) : composing ? (
            <div className="flex items-center gap-3 rounded-xl border border-sipzy-border bg-white px-4 py-3 shadow-sm">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-sipzy-green/30 border-t-sipzy-green" />
              <p className="text-sm text-sipzy-muted">Checking safeguards and generating message…</p>
            </div>
          ) : !allowed ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <p className="text-sm font-semibold text-red-700">Outreach not allowed for this lead</p>
              <p className="mt-2 text-sm text-red-600">
                {blockedReason === 'not_verified' &&
                  'This lead has not been verified yet. Mark it as verified before composing.'}
                {blockedReason === 'not_approved_for_outreach' &&
                  'This lead has not been approved for outreach. Approve it in the lead editor first.'}
                {blockedReason === 'contact_suppressed' &&
                  'This contact is on the suppression list and must not be contacted.'}
                {blockedReason === 'lead_opted_out' &&
                  'This lead has an opted-out enquiry and must not be contacted.'}
                {blockedReason === 'no_phone' && 'This lead has no phone number on file.'}
                {blockedReason === 'lead_not_found' && 'The selected lead could not be found.'}
                {blockedReason === 'unknown' && 'This lead is not eligible for outreach.'}
              </p>
              <button
                type="button"
                onClick={handleRefresh}
                className="mt-4 rounded-lg border border-sipzy-border bg-white px-4 py-2 text-sm font-medium text-sipzy-text transition hover:bg-sipzy-hover"
              >
                Choose a different lead
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Message editor */}
              <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <label className={labelClass}>Introductory message</label>
                  <span className="text-[11px] text-sipzy-muted">
                    {message.length}/4096
                  </span>
                </div>
                <textarea
                  value={message}
                  onChange={(event) => handleMessageChange(event.target.value)}
                  className={`${inputClass} min-h-[200px] resize-y`}
                  placeholder="SIPZY will generate a personalized intro here…"
                  aria-label="Outreach message"
                />
                {message.length > 4096 && (
                  <p className="mt-1 text-xs text-red-600">Message exceeds WhatsApp's 4096 character limit.</p>
                )}
              </div>

              {/* Prefilled message preview */}
              <div className="rounded-xl border border-sipzy-border bg-sipzy-hover/40 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sipzy-muted mb-2">
                  What WhatsApp will show
                </p>
                <p className="text-sm text-sipzy-text whitespace-pre-wrap">{message || '—'}</p>
              </div>

              {/* WhatsApp link */}
              {waLink && (
                <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sipzy-muted mb-3">
                    Send via WhatsApp
                  </p>
                  <p className="text-sm text-sipzy-muted mb-3">
                    This opens a WhatsApp chat with the prefilled message. Review it in WhatsApp and press send yourself — nothing is sent automatically.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleOpenWhatsApp}
                      className="inline-flex items-center gap-2 rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sipzy-green-hover"
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                      Open WhatsApp chat
                    </a>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(waLink)}
                      className="inline-flex items-center gap-2 rounded-lg border border-sipzy-border bg-white px-4 py-2 text-sm font-medium text-sipzy-text transition hover:bg-sipzy-hover"
                    >
                      <CopyIcon className="h-4 w-4" />
                      Copy link
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-sipzy-muted">
                    Phone: {lead.phone} →{' '}
                    <code className="rounded bg-sipzy-hover px-1 py-0.5 text-[10px] text-sipzy-text">
                      {lead.phone.replace(/[^\d+]/g, '')}
                    </code>
                  </p>
                </div>
              )}

              {/* Record activity */}
              <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-sipzy-muted mb-3">
                  Record this outreach attempt
                </p>
                <p className="text-sm text-sipzy-muted mb-3">
                  Log the outreach in the activity feed so the team can see it was attempted.
                </p>
                <div className="flex flex-col gap-3">
                  <textarea
                    value={recordNotes}
                    onChange={(event) => setRecordNotes(event.target.value)}
                    className={`${inputClass} resize-y`}
                    rows={2}
                    placeholder="Optional note (e.g. 'Sent after follow-up call')"
                    aria-label="Outreach notes"
                  />
                  <button
                    type="button"
                    onClick={handleRecord}
                    disabled={recording || !message}
                    className="rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white transition hover:bg-sipzy-green-hover disabled:opacity-60"
                  >
                    {recording ? 'Recording…' : 'Record outreach activity'}
                  </button>
                </div>
              </div>

              {/* Tips */}
              <div className="rounded-xl border border-sipzy-border bg-sipzy-cream p-4 text-sm text-sipzy-muted">
                <p className="font-medium text-sipzy-text">How it works</p>
                <ul className="mt-2 space-y-1 list-disc list-inside">
                  <li>The message is generated from the lead's business name, category, city and contact person — local logic only, no AI.</li>
                  <li>Edit the message freely before opening WhatsApp.</li>
                  <li>The wa.me link opens WhatsApp with the message prefilled. You review and press send.</li>
                  <li>Recording the activity logs the attempt in the outreach activity feed — it does not send the message.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Composer;
