import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../auth/AuthContext';

const AIConversations: React.FC = () => {
  const { canWrite } = useAuth();
  const mayEdit = canWrite('conversations');
  const [conversations, setConversations] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [enquiry, setEnquiry] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.conversations.list();
      setConversations(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDraft(selected?.ai_reply || ''); }, [selected]);
  useEffect(() => {
    let cancelled = false;
    if (!selected?.linked_enquiry_id) {
      setEnquiry(null);
      return () => { cancelled = true; };
    }
    api.enquiries.get(selected.linked_enquiry_id)
      .then((data) => { if (!cancelled) setEnquiry(data); })
      .catch(() => { if (!cancelled) setEnquiry(null); });
    return () => { cancelled = true; };
  }, [selected?.linked_enquiry_id]);

  const selectConversation = async (conversation: any) => {
    try {
      const full = await api.conversations.get(conversation.id);
      setSelected(full);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    }
  };

  const approve = async () => {
    if (!selected) return;
    try {
      const updated = await api.conversations.approve(selected.id);
      setSelected(updated);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Approve failed'); }
  };

  const reject = async () => {
    if (!selected) return;
    try {
      const updated = await api.conversations.reject(selected.id, 'Rejected by reviewer');
      setSelected(updated);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Reject failed'); }
  };

  const regenerate = async () => {
    if (!selected) return;
    try {
      const updated = await api.conversations.regenerate(selected.id);
      setSelected(updated);
      setDraft(updated.ai_reply || '');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Regenerate failed'); }
  };

  const saveDraft = async () => {
    if (!selected) return;
    try {
      const updated = await api.conversations.update(selected.id, { ai_reply: draft });
      setSelected(updated);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">AI Sales</p>
        <h2 className="mt-1 text-2xl font-bold text-sipzy-text">AI Conversations</h2>
        <p className="mt-1 text-sm text-sipzy-muted">Draft-first WhatsApp sales conversations. Sending remains disabled.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-sipzy-border bg-white shadow-sm">
          <table className="min-w-full divide-y divide-sipzy-border text-left">
            <thead className="bg-sipzy-hover/70">
              <tr>
                {['Customer', 'Status', 'Missing', 'Updated'].map((h) => (
                  <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-sipzy-border">
              {loading ? <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-sipzy-muted">Loading…</td></tr> :
                conversations.length === 0 ? <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-sipzy-muted">No conversations yet</td></tr> :
                conversations.map((c) => (
                  <tr key={c.id} className={`cursor-pointer ${selected?.id === c.id ? 'bg-sipzy-hover/70' : ''}`} onClick={() => selectConversation(c)}>
                    <td className="px-4 py-3 text-sm text-sipzy-text">{c.customer_name || c.phone}</td>
                    <td className="px-4 py-3 text-sm text-sipzy-muted">{c.status}</td>
                    <td className="px-4 py-3 text-sm text-sipzy-muted">{Array.isArray(c.missing_info) ? c.missing_info.join(', ') : ''}</td>
                    <td className="px-4 py-3 text-sm text-sipzy-muted">{new Date(c.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-sipzy-border bg-white p-5 shadow-sm">
          {selected ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-sipzy-text">{selected.customer_name || selected.phone}</h3>
                <p className="text-sm text-sipzy-muted">{selected.business_name} {selected.phone}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-semibold">Product:</span> {selected.product_type || '—'}</div>
                <div><span className="font-semibold">Size:</span> {selected.cup_size || '—'}</div>
                <div><span className="font-semibold">Quantity:</span> {selected.quantity || '—'}</div>
                <div><span className="font-semibold">Location:</span> {selected.delivery_location || '—'}</div>
                <div><span className="font-semibold">Budget:</span> {selected.budget || '—'}</div>
                <div><span className="font-semibold">Timeline:</span> {selected.purchase_timeline || '—'}</div>
              </div>
              {enquiry && (
                <div className="rounded-lg border border-sipzy-border bg-sipzy-hover/30 p-3 text-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">Linked enquiry</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div><span className="font-semibold">Status:</span> {enquiry.enquiry_status || '—'}</div>
                    <div><span className="font-semibold">Product:</span> {enquiry.product_type || '—'} {enquiry.cup_size || ''}</div>
                    <div><span className="font-semibold">Quantity:</span> {enquiry.quantity || '—'}</div>
                    <div><span className="font-semibold">Location:</span> {enquiry.delivery_location || '—'}</div>
                    <div className="col-span-2 text-sipzy-muted">{enquiry.ai_summary || ''}</div>
                  </div>
                </div>
              )}
              {Array.isArray(selected.messages) && (
                <div className="max-h-64 overflow-auto rounded-lg border border-sipzy-border bg-sipzy-hover/40 p-3 text-sm">
                  {selected.messages.map((m: any) => (
                    <div key={m.id} className="mb-2">
                      <span className="font-semibold">{m.direction}:</span> {m.body}
                    </div>
                  ))}
                </div>
              )}
              {(() => {
                const latestAi = Array.isArray(selected.messages)
                  ? [...selected.messages].reverse().find((m: any) => m.direction === 'outbound' && m.source === 'ai_draft')
                  : null;
                const proposed = latestAi?.metadata?.proposed_actions || [];
                const applied = latestAi?.metadata?.applied_actions || [];
                if (!proposed.length && !applied.length) return null;
                return (
                  <div className="rounded-lg border border-sipzy-border bg-white p-3 text-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">AI proposed actions</p>
                    {proposed.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-sipzy-text">
                        {proposed.map((action: any, index: number) => (
                          <li key={`${action.type}-${index}`}>{action.type}{action.status ? ` (${action.status})` : ''}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-sipzy-muted">Applied: {applied.length ? applied.join(', ') : 'none'}</p>
                  </div>
                );
              })()}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">AI draft reply</label>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  readOnly={!mayEdit}
                  className="mt-1 w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm read-only:bg-sipzy-hover/40"
                  rows={5}
                />
              </div>
              {mayEdit ? (
                <div className="flex gap-2">
                  <button onClick={saveDraft} className="rounded-lg border border-sipzy-border px-4 py-2 text-sm font-medium">Save draft</button>
                  <button onClick={approve} className="rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white">Approve</button>
                  <button onClick={reject} className="rounded-lg bg-sipzy-red px-4 py-2 text-sm font-medium text-white">Reject</button>
                  <button onClick={regenerate} className="rounded-lg border border-sipzy-border px-4 py-2 text-sm font-medium">Regenerate</button>
                </div>
              ) : (
                <p className="text-xs text-sipzy-muted">Read-only access: your role cannot edit conversation drafts.</p>
              )}
              <p className="text-xs text-sipzy-muted">Reply status: {selected.reply_status}. Linked enquiry: {selected.linked_enquiry_id || 'none'}. Sending is disabled.</p>
            </div>
          ) : <p className="text-sm text-sipzy-muted">Select a conversation.</p>}
        </div>
      </div>
    </div>
  );
};

export default AIConversations;