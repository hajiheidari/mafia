'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { bootstrapGuestSession } from './api';

interface AuthState {
  status: 'loading' | 'ready' | 'error';
  user: { id: string; displayName: string } | null;
}

const AuthContext = createContext<AuthState>({ status: 'loading', user: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  useEffect(() => {
    let cancelled = false;
    // Guests never see a login form (Milestone 6 §20) — the session is
    // created/restored transparently the moment the app loads.
    bootstrapGuestSession()
      .then((user) => {
        if (!cancelled) setState({ status: 'ready', user });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', user: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
