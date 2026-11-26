import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../auth/AuthContext';

const inputClass =
  'w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text focus:border-sipzy-green focus:outline-none focus:ring-2 focus:ring-sipzy-green/20';

const Campaigns: React.FC = () => {
  const { canWrite } = useAuth();
  const mayEdit = canWrite('campaigns');
  const [tab, setTab] = useState<'campaigns' | 'templates' | 'queue' | 'settings'>('campaigns');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [campaignName, setCampaignName] = useState('');
  const [campaignCity, setCampaignCity] = useState('');
  const [campaignChannel, setCampaignChannel] = useState('whatsapp');

  const [templateName, setTemplateName] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [templateType, setTemplateType] = useState('introduction');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, t, q, s] = await Promise.all([
        api.campaigns.list(),
        api.templates.list(),
        api.queue.list(),
        api.campaignSettings.get(),
      ]);
      setCampaigns(Array.isArray(c) ? c : []);
      setTemplates(Array.isArray(t) ? t : []);
      setQueue(Array.isArray(q) ? q : []);
      setSettings(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createCampaign = async () => {
    if (!campaignName.trim()) return;
    try {
      await api.campaigns.create({
        name: campaignName.trim(),
        target_city: campaignCity.trim(),
        channel: campaignChannel,
        status: 'draft',
      });
      setCampaignName('');
      setCampaignCity('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create campaign');
    }
  };

  const createTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      await api.templates.create({
        name: templateName.trim(),
        template_type: templateType,
        body: templateBody,
        channel: 'whatsapp',
        status: 'draft',
      });
      setTemplateName('');
      setTemplateBody('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create template');
    }
  };

  const processQueue = async () => {
    try {
      await api.queue.process({ force: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Queue processing failed');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Outbound</p>
        <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Campaigns</h2>
        <p className="mt-1 text-sm text-sipzy-muted">
          Draft-first outbound campaign engine. Sending, scheduler and follow-ups remain disabled by default.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="flex gap-2">
        {(['campaigns', 'templates', 'queue', 'settings'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === item ? 'bg-sipzy-green text-white' : 'border border-sipzy-border bg-white text-sipzy-text'}`}
          >
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'campaigns' && (
        <div className="space-y-4">
          {mayEdit && (
          <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-sipzy-text">Create campaign</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <input className={inputClass} placeholder="Campaign name" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
              <input className={inputClass} placeholder="Target city" value={campaignCity} onChange={(e) => setCampaignCity(e.target.value)} />
              <select className={inputClass} value={campaignChannel} onChange={(e) => setCampaignChannel(e.target.value)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <button type="button" onClick={createCampaign} className="mt-3 rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white">
              Create draft campaign
            </button>
          </div>
          )}

          <div className="overflow-hidden rounded-xl border border-sipzy-border bg-white shadow-sm">
            <table className="min-w-full divide-y divide-sipzy-border text-left">
              <thead className="bg-sipzy-hover/70">
                <tr>
                  {['Name', 'City', 'Channel', 'Status', 'Created'].map((h) => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-sipzy-border">
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-sipzy-muted">Loading…</td></tr>
                ) : campaigns.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-sipzy-muted">No campaigns yet</td></tr>
                ) : (
                  campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td className="px-4 py-3 text-sm font-medium text-sipzy-text">{campaign.name}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{campaign.target_city || '—'}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{campaign.channel}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{campaign.status}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{new Date(campaign.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div className="space-y-4">
          {mayEdit && (
          <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-sipzy-text">Create template</h3>
            <div className="grid gap-3">
              <input className={inputClass} placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
              <select className={inputClass} value={templateType} onChange={(e) => setTemplateType(e.target.value)}>
                <option value="introduction">Introduction</option>
                <option value="product_information">Product information</option>
                <option value="follow_up">Follow-up</option>
                <option value="price_enquiry_response">Price enquiry response</option>
                <option value="sample_enquiry_response">Sample enquiry response</option>
                <option value="custom">Custom</option>
              </select>
              <textarea className={inputClass} rows={4} placeholder="Template body with {{business_name}}" value={templateBody} onChange={(e) => setTemplateBody(e.target.value)} />
            </div>
            <button type="button" onClick={createTemplate} className="mt-3 rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white">
              Save draft template
            </button>
          </div>
          )}

          <div className="overflow-hidden rounded-xl border border-sipzy-border bg-white shadow-sm">
            <table className="min-w-full divide-y divide-sipzy-border text-left">
              <thead className="bg-sipzy-hover/70">
                <tr>
                  {['Name', 'Type', 'Status', 'WhatsApp approval'].map((h) => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-sipzy-border">
                {templates.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-sipzy-muted">No templates yet</td></tr>
                ) : (
                  templates.map((template) => (
                    <tr key={template.id}>
                      <td className="px-4 py-3 text-sm font-medium text-sipzy-text">{template.name}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{template.template_type}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{template.status}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{template.whatsapp_template_status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'queue' && (
        <div className="space-y-4">
          {mayEdit && (
            <button type="button" onClick={processQueue} className="rounded-lg bg-sipzy-green px-4 py-2 text-sm font-medium text-white">
              Run dry-run queue cycle
            </button>
          )}
          <div className="overflow-hidden rounded-xl border border-sipzy-border bg-white shadow-sm">
            <table className="min-w-full divide-y divide-sipzy-border text-left">
              <thead className="bg-sipzy-hover/70">
                <tr>
                  {['Campaign', 'Lead', 'Status', 'Scheduled', 'Attempts'].map((h) => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-sipzy-border">
                {queue.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-sipzy-muted">Queue is empty</td></tr>
                ) : (
                  queue.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{item.campaign?.name || item.campaign_id}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-text">{item.lead?.business_name || item.lead_id}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{item.delivery_status}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{new Date(item.scheduled_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-sipzy-muted">{item.attempt_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
          <pre className="overflow-auto text-xs text-sipzy-text">{JSON.stringify(settings, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default Campaigns;