import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import type { Me } from '@engine/shared';
import { ApiError } from './api/client.ts';
import { api } from './api/endpoints.ts';
import { ErrorNotice } from './components/ui.tsx';

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

/** Returns the signed-in user; only call inside <RequireAuth>. */
export function useRequiredMe(): Me {
  const { data } = useMe();
  if (!data) throw new Error('useRequiredMe used outside RequireAuth');
  return data;
}

export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (me.isError) return <div className="p-6"><ErrorNotice error={me.error} /></div>;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && me.data.user.role !== 'platform_admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}
