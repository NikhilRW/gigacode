import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError } from './api/client.ts';
import { RequireAuth } from './auth.tsx';
import { Layout } from './components/Layout.tsx';
import { AdminPage } from './pages/Admin.tsx';
import { ApiKeysPage } from './pages/ApiKeys.tsx';
import { LoginPage, RegisterPage } from './pages/Auth.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { DashboardPage } from './pages/Dashboard.tsx';
import { ExecutionDetailPage } from './pages/ExecutionDetail.tsx';
import { ExecutionsPage } from './pages/Executions.tsx';
import { Skeleton } from '@/components/ui/skeleton';
import './index.css';

// Monaco is large: the Playground (the only page with an editor) loads on demand.
const PlaygroundPage = lazy(() => import('./pages/Playground.tsx').then((m) => ({ default: m.PlaygroundPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't hammer the API on client errors (401/404/429); retry transient failures once.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route
              path="new"
              element={
                <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                  <PlaygroundPage />
                </Suspense>
              }
            />
            <Route path="executions" element={<ExecutionsPage />} />
            <Route path="executions/:id" element={<ExecutionDetailPage />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route
              path="admin"
              element={
                <RequireAuth admin>
                  <AdminPage />
                </RequireAuth>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
