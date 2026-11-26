import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../auth/AuthContext';

const SalesWorkflow: React.FC = () => {
  const { isAdmin } = useAuth();
  const [funnel, setFunnel] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([api.salesWorkflow.funnel(), api.salesWorkflow.scenarios()]);
      setFunnel(f);
      setScenarios(Array.isArray(s) ? s : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (scenario: string) => {
    try {
      const data = await api.salesWorkflow.runScenario(scenario);
      setResult(data);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Simulation failed'); }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sipzy-orange">Sales Ops</p>
        <h2 className="mt-1 text-2xl font-bold text-sipzy-text">Sales Workflow</h2>
        <p className="mt-1 text-sm text-sipzy-muted">Simulation mode only. No real WhatsApp sending.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {funnel && Object.entries(funnel).filter(([k]) => k !== 'totals').map(([k, v]) => (
          <div key={k} className="rounded-xl border border-sipzy-border bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-sipzy-muted">{k}</p>
            <p className="mt-1 text-2xl font-bold text-sipzy-text">{String(v)}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-sipzy-border bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-sipzy-text">Scenarios</h3>
        {isAdmin ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {scenarios.map((s) => (
              <button key={s.id} onClick={() => run(s.id)} className="rounded-lg border border-sipzy-border px-3 py-2 text-sm font-medium">
                {s.id}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-sipzy-muted">Simulation controls are restricted to administrators.</p>
        )}
      </div>
      {result && (
        <div className="rounded-xl border border-sipzy-border bg-white p-5 shadow-sm text-sm">
          <p className="font-semibold">Last simulation: {result.phone}</p>
          <p>Status: {result.conversation?.status}</p>
          <p>Reply: {result.conversation?.ai_reply}</p>
        </div>
      )}
    </div>
  );
};

export default SalesWorkflow;