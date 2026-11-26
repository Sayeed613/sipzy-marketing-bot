import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, type SessionUser, type Role } from '../utils/api';

/**
 * Session state for the dashboard.
 *
 * The backend is the source of truth: every API call is authorised
 * server-side. The role helpers here only decide which controls are
 * worth showing.
 */

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  canWrite: (domain: string) => boolean;
  isAdmin: boolean;
  role: Role | null;
}

const SALES_WRITE_DOMAINS = ['leads', 'enquiries', 'conversations', 'quotations', 'orders'];

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The API layer emits this when a request comes back unauthenticated
  // (expired or revoked session) so the dashboard can redirect to login.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('sipzy:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sipzy:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await authApi.login(username, password);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const role = user?.role ?? null;
    return {
      user,
      loading,
      login,
      logout,
      refresh,
      role,
      isAdmin: role === 'admin',
      canWrite: (domain: string) => {
        if (!user) return false;
        if (role === 'admin') return true;
        if (role === 'viewer') return false;
        return SALES_WRITE_DOMAINS.includes(domain);
      },
    };
  }, [user, loading, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export default AuthContext;
