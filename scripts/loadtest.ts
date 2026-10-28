// Simple load test: N concurrent clients submit Python jobs and poll to completion.
// Usage: API_KEY=ce_live_... pnpm loadtest [-- --clients 10 --jobs 50]
// Needs a tenant with enough max_exec_per_min (raise it in the admin UI) to avoid 429s.
const base = process.env.API_URL ?? 'http://localhost:3000';
const key = process.env.API_KEY;
if (!key) {
  console.error('API_KEY is required (from the seed output or the API Keys page)');
  process.exit(1);
}
const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const clients = arg('clients', 10);
const jobs = arg('jobs', 50);
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const terminal = new Set(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'DEAD_LETTERED']);

const latencies: number[] = [];
const statuses: Record<string, number> = {};
let rateLimited = 0;
let next = 0;

async function one(): Promise<void> {
  const started = Date.now();
  const res = await fetch(`${base}/v1/executions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      language: 'python',
      files: [{ path: 'main.py', content: 'print(sum(range(100000)))' }],
      entryFile: 'main.py',
    }),
  });
  if (res.status === 429) {
    rateLimited++;
    await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') ?? 1) * 1000));
    return one();
  }
  const { id } = (await res.json()) as { id: string };
  for (;;) {
    const e = (await (await fetch(`${base}/v1/executions/${id}`, { headers })).json()) as { status: string };
    if (terminal.has(e.status)) {
      statuses[e.status] = (statuses[e.status] ?? 0) + 1;
      latencies.push(Date.now() - started);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function client(): Promise<void> {
  while (next < jobs) {
    next++;
    await one();
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: clients }, client));
const secs = (Date.now() - t0) / 1000;
latencies.sort((a, b) => a - b);
const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
console.log(`jobs=${jobs} clients=${clients} elapsed=${secs.toFixed(1)}s throughput=${(jobs / secs).toFixed(2)} jobs/s`);
console.log(`end-to-end latency ms: p50=${pct(50)} p90=${pct(90)} p99=${pct(99)} max=${latencies.at(-1)}`);
console.log(`statuses=${JSON.stringify(statuses)} rate_limited_retries=${rateLimited}`);
