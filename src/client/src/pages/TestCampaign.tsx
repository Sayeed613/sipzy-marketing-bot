import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../auth/AuthContext';

const inputClass =
  'w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20';

const TestCampaign: React.FC = () => {
  const { canWrite } = useAuth();
  const mayEdit = canWrite('campaigns');
  const [state, setState] = useState<any | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, templateRows] = await Promise.all([
        api.testCampaign.get(),
        api.templates.list({ channel: 'whatsapp', status: 'approved' }),
      ]);
      const approvedTemplates = (Array.isArray(templateRows) ? templateRows : []).filter(
        (template) => template.whatsapp_template_status === 'approved' && template.whatsapp_template_name
      );
      setState(data);
      setTemplates(approvedTemplates);
      setTemplateId((current) => current || approvedTemplates[0]?.id || '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load test campaign');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (action: () => Promise<any>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const addContact = () =>
    runAction(async () => {
      if (!phone.trim()) throw new Error('Phone number is required');
      await api.testCampaign.upsertContact({
        phone: phone.trim(),
        name: name.trim(),
        authorized: true,
      });
      setPhone('');
      setName('');
    });

  const start = () =>
    runAction(async () => {
      if (!templateId) throw new Error('Choose an approved WhatsApp template');
      await api.testCampaign.start({ template_id: templateId });
    });

  const cfg = state?.config || {};
  const run = state?.run;
  const contacts = state?.contacts || [];
  const activity = state?.recent_activity || [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Controlled test</p>
        <h2 className="mt-1 text-2xl font-bold text-sipzy-text">WhatsApp Test Campaign</h2>
        <p className="mt-1 text-sm text-sipzy-muted">
          Dedicated end-to-end test mode. General campaigns, bulk sending and the background scheduler are not used.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Mode', cfg.enabled ? 'enabled' : 'disabled'],
          ['WhatsApp sending', cfg.sending_enabled ? 'enabled' : 'disabled'],
          ['Dry run', cfg.dry_run ? 'yes' : 'no'],
          ['Scheduler', cfg.scheduler_enabled ? 'enabled (not used)' : 'disabled'],
          ['AI provider', cfg.ai_provider || 'local'],
          ['AI paid calls', cfg.ai_paid_calls_enabled ? 'enabled' : 'disabled'],
          ['Allowed numbers', String(cfg.allowed_test_numbers ?? 0)],
          ['WhatsApp config', cfg.whatsapp_configured ? 'configured' : 'missing'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-sipzy-border bg-white p-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sipzy-muted">{label}</p>
            <p className="mt-1 text-sm font-semibold text-sipzy-text">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-sipzy-text">Authorised test contacts</h3>
          <p className="mt-1 text-xs text-sipzy-muted">
            A number must be in TEST_ALLOWED_NUMBERS and marked authorised here. Suppressed contacts are always excluded.
          </p>
          {mayEdit && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input className={inputClass} placeholder="Phone (e.g. 9198...)" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input className={inputClass} placeholder="Contact name" value={name} onChange={(e) => setName(e.target.value)} />
              <button
                type="button"
                disabled={busy}
                onClick={addContact}
                className="rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:col-span-2"
              >
                Add authorised test contact
              </button>
            </div>
          )}
          <div className="mt-3 overflow-hidden rounded-lg border border-sipzy-border">
            <table className="min-w-full divide-y divide-sipzy-border text-left text-xs">
              <thead className="bg-sipzy-hover/70">
                <tr>{['Number', 'Name', 'Authorised', ''].map((h) => <th key={h} className="px-3 py-2 font-semibold text-sipzy-muted">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-sipzy-border">
                {contacts.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-sipzy-muted">No test contacts yet</td></tr>
                ) : contacts.map((contact: any) => (
                  <tr key={contact.id}>
                    <td className="px-3 py-2 text-sipzy-text">{contact.phone}</td>
                    <td className="px-3 py-2 text-sipzy-muted">{contact.name || '—'}</td>
                    <td className="px-3 py-2">{contact.authorized ? 'yes' : 'no'}</td>
                    <td className="px-3 py-2 text-right">
                      {mayEdit && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => runAction(() => api.testCampaign.authorize(contact.id, !contact.authorized))}
                            className="rounded border border-sipzy-border px-2 py-1"
                          >
                            {contact.authorized ? 'Revoke' : 'Authorise'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => runAction(() => api.testCampaign.removeContact(contact.id))}
                            className="rounded border border-sipzy-border px-2 py-1"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-sipzy-text">Manual control</h3>
          <p className="mt-1 text-xs text-sipzy-muted">Start sends one approved template to eligible contacts. Stop does not change AI, sending or scheduler settings.</p>
          {mayEdit && (
            <div className="mt-3 space-y-2">
              <select className={inputClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Select an approved WhatsApp template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.whatsapp_template_name})
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || run?.status === 'running'}
                  onClick={start}
                  className="rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Start test
                </button>
                <button
                  type="button"
                  disabled={busy || run?.status !== 'running'}
                  onClick={() => runAction(() => api.testCampaign.stop())}
                  className="rounded-lg bg-sipzy-red px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Stop test
                </button>
              </div>
            </div>
          )}
          {run ? (
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div><span className="font-semibold">Status:</span> {run.status}</div>
              <div><span className="font-semibold">Template:</span> {run.template_name}</div>
              <div><span className="font-semibold">Recipients:</span> {run.recipients_total}</div>
              <div><span className="font-semibold">Sent:</span> {run.recipients_sent}</div>
              <div><span className="font-semibold">Dry run:</span> {run.recipients_dry_run}</div>
              <div><span className="font-semibold">Failed:</span> {run.recipients_failed}</div>
              <div className="col-span-2 text-xs text-sipzy-muted">Started: {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}</div>
              {run.last_error && <div className="col-span-2 text-xs text-red-600">{run.last_error}</div>}
            </div>
          ) : <p className="mt-4 text-sm text-sipzy-muted">No test run yet.</p>}
          <Link to="/ai-conversations" className="mt-4 inline-block text-sm font-medium text-sipzy-green underline">
            Open AI Conversations
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-sipzy-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-sipzy-border px-4 py-3">
          <h3 className="text-sm font-semibold text-sipzy-text">Test activity log</h3>
          <span className="text-xs text-sipzy-muted">{activity.length} recent entries</span>
        </div>
        <table className="min-w-full divide-y divide-sipzy-border text-left text-xs">
          <thead className="bg-sipzy-hover/70">
            <tr>{['Time', 'Direction', 'Phone', 'Status', 'Message / AI response'].map((h) => <th key={h} className="px-3 py-2 font-semibold text-sipzy-muted">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-sipzy-border">
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sipzy-muted">Loading…</td></tr>
            ) : activity.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sipzy-muted">No test activity yet</td></tr>
            ) : activity.map((entry: any) => {
              const notes = entry.notes_json || {};
              return (
                <tr key={entry.id}>
                  <td className="px-3 py-2 text-sipzy-muted">{new Date(entry.activity_date).toLocaleString()}</td>
                  <td className="px-3 py-2">{notes.direction || '—'}</td>
                  <td className="px-3 py-2 text-sipzy-text">{notes.phone || '—'}</td>
                  <td className="px-3 py-2">{notes.status || entry.delivery_status}</td>
                  <td className="px-3 py-2 text-sipzy-muted">
                    {notes.direction === 'inbound' ? notes.body : notes.template_preview}
                    {notes.ai_reply && <div className="mt-1 text-sipzy-text">AI: {notes.ai_reply}</div>}
                    {Array.isArray(notes.proposed_actions) && notes.proposed_actions.length > 0 && (
                      <div className="mt-1">Proposed: {notes.proposed_actions.map((a: any) => a.type).join(', ')}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TestCampaign;