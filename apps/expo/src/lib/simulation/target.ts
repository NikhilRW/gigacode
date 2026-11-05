export type SimulationTarget =
  | { kind: 'loopback'; origin: string; label: 'Verified local target' }
  | { kind: 'codespaces'; origin: string; workspace: string; label: 'Matching Codespaces workspace' }
  | { kind: 'blocked'; origin: null; label: string };

function loopbackOrigin(input: string): string | null {
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?\/?$/.test(input)) return null;
  try { return new URL(input).origin; } catch { return null; }
}

/** Match the entire origin before normalization can hide credentials, paths or host tricks. */
function codespace(input: string): { origin: string; workspace: string } | null {
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)-([1-9][0-9]{0,4})\.app\.github\.dev\/?$/.exec(input);
  if (!match || Number(match[2]) > 65535) return null;
  try {
    const url = new URL(input);
    if (url.hostname.split('.')[0].length > 63) return null;
    return { origin: url.origin, workspace: match[1] };
  } catch { return null; }
}

export function simulationTarget(input: string, browserOrigin: string | null = null): SimulationTarget {
  const local = loopbackOrigin(input);
  if (local) return { kind: 'loopback', origin: local, label: 'Verified local target' };
  const api = codespace(input);
  if (!api) return { kind: 'blocked', origin: null, label: 'Load target blocked: use canonical loopback or a matching HTTPS Codespaces workspace.' };
  if (!browserOrigin) return { kind: 'blocked', origin: null, label: 'Codespaces workspace cannot be verified without a browser page origin (including native apps).' };
  const page = codespace(browserOrigin);
  if (!page || page.workspace !== api.workspace)
    return { kind: 'blocked', origin: null, label: 'API and browser page must be canonical HTTPS forwarded ports in the exact same Codespaces workspace.' };
  return { kind: 'codespaces', ...api, label: 'Matching Codespaces workspace' };
}

export function simulationOrigin(input: string, browserOrigin: string | null = null): string | null {
  return simulationTarget(input, browserOrigin).origin;
}
