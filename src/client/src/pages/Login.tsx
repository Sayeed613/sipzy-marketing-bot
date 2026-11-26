import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { authApi } from '../utils/api';

/**
 * Login — the only unauthenticated dashboard page.
 *
 * The first account can be created here when the server has no users yet
 * (one-time setup), or via `npm run admin:create` / environment variables.
 */
const Login: React.FC = () => {
  const { user, loading, login, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from || '/';

  if (!loading && user) return <Navigate to={from} replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'setup') {
        await authApi.setup({ username, password, email });
        await refresh();
      } else {
        await login(username, password);
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-sipzy-cream px-4">
      <div className="w-full max-w-md rounded-2xl border border-sipzy-border bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sipzy-orange text-sm font-bold text-white">
            S
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-sipzy-text">SIPZY</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-sipzy-muted">Marketing Bot</p>
          </div>
        </div>

        <h1 className="mt-6 text-xl font-bold text-sipzy-text">
          {mode === 'setup' ? 'Create the first admin account' : 'Sign in'}
        </h1>
        <p className="mt-1 text-sm text-sipzy-muted">
          {mode === 'setup'
            ? 'Setup is only available while no dashboard account exists.'
            : 'Use your SIPZY dashboard credentials.'}
        </p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div>
            <label htmlFor="username" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text"
            />
          </div>

          {mode === 'setup' && (
            <div>
              <label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
                Email (optional)
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text"
              />
            </div>
          )}

          <div>
            <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sipzy-muted">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'setup' ? 8 : undefined}
              className="mt-1 w-full rounded-lg border border-sipzy-border bg-white px-3 py-2 text-sm text-sipzy-text"
            />
            {mode === 'setup' && (
              <p className="mt-1 text-xs text-sipzy-muted">At least 8 characters.</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-sipzy-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-sipzy-green-hover disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'setup' ? 'Create admin account' : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'setup' : 'login');
            setError(null);
          }}
          className="mt-4 text-xs font-medium text-sipzy-muted underline hover:text-sipzy-text"
        >
          {mode === 'login' ? 'First-time setup' : 'Back to sign in'}
        </button>
      </div>
    </div>
  );
};

export default Login;
