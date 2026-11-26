import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { whatsappApi } from '../utils/api';

interface WhatsAppMessage {
  id: string;
  external_id: string;
  direction: string;
  phone: string;
  normalized_phone: string;
  contact_name: string;
  body: string;
  message_type: string;
  status: string;
  delivery_status: string;
  analysis_json: string | null;
  enquiry_id: string | null;
  lead_id: string | null;
  draft_reply: string;
  created_at: string;
  updated_at: string;
}

const WhatsAppInbox: React.FC = () => {
  const { isAdmin } = useAuth();
  const mayEdit = isAdmin;
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WhatsAppMessage | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await whatsappApi.messages({ limit: 100 });
      setMessages(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load WhatsApp messages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setDraft(selected?.draft_reply || '');
  }, [selected]);

  const saveDraft = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await whatsappApi.update(selected.id, { draft_reply: draft });
      setSelected(updated);
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">WhatsApp</p>
          <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Inbox</h2>
          <p className="mt-1 text-sm text-sipzy-muted">
            Incoming WhatsApp messages, AI analysis, linked enquiries, and draft replies. Outgoing sending is disabled by default.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm font-medium text-sipzy-text shadow-sm transition hover:bg-sipzy-hover sm:self-auto"
        >
          Refresh
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

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-sipzy-border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-sipzy-border text-left">
              <thead className="bg-sipzy-hover/70">
                <tr>
                  {['From', 'Message', 'Status', 'Received'].map((heading) => (
                    <th key={heading} className="whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-sipzy-border">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-sipzy-muted">Loading messages…</td>
                  </tr>
                ) : messages.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-sm text-sipzy-muted">No WhatsApp messages yet</td>
                  </tr>
                ) : (
                  messages.map((message) => (
                    <tr
                      key={message.id}
                      className={`cursor-pointer transition hover:bg-sipzy-hover/50 ${selected?.id === message.id ? 'bg-sipzy-hover/70' : ''}`}
                      onClick={() => setSelected(message)}
                    >
                      <td className="px-4 py-3 text-sm text-sipzy-text">
                        <p className="font-medium">{message.contact_name || message.phone}</p>
                        <p className="text-xs text-sipzy-muted">{message.phone}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{message.body || '—'}</td>
                      <td className="px-4 py-3 text-xs text-sipzy-muted">{message.status}</td>
                      <td className="px-4 py-3 text-xs text-sipzy-muted">
                        {new Date(message.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-sipzy-border bg-white p-5 shadow-sm">
          {selected ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-sipzy-text">{selected.contact_name || selected.phone}</h3>
                <p className="text-sm text-sipzy-muted">{selected.phone}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Message</p>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-sipzy-border bg-sipzy-hover/50 p-3 text-sm text-sipzy-text">
                  {selected.body || 'No text body'}
                </p>
              </div>
              {selected.analysis_json && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Analysis</p>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-sipzy-border bg-white p-3 text-xs text-sipzy-text">
                    {JSON.stringify(JSON.parse(selected.analysis_json), null, 2)}
                  </pre>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Linked enquiry</p>
                <p className="mt-1 text-sm text-sipzy-text">{selected.enquiry_id || 'None created'}</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Draft reply (manual review only)</label>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  readOnly={!mayEdit}
                  className="mt-1 w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text read-only:bg-sipzy-hover/40"
                  rows={5}
                />
                {mayEdit ? (
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={saving}
                    className="mt-2 rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white hover:bg-sipzy-green-hover disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save draft'}
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-sipzy-muted">Read-only access: your role cannot edit drafts.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-sipzy-muted">Select a message to review it.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default WhatsAppInbox;