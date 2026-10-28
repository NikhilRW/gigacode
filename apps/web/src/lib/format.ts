export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function formatPercent(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** "just now", "5 min ago", "3 h ago", "2 d ago"; older than 30 days falls back to the date. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 90 * 60) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 30 * 86400) return `${Math.round(seconds / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
