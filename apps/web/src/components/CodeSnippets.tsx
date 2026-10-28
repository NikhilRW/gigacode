import { CopyButton } from '@/components/CopyButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** Ready-to-run examples for submitting a run and reading its result. `key` is the key or a placeholder. */
export function buildSnippets(origin: string, key: string) {
  return {
    curl: `curl -s -X POST ${origin}/v1/executions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"language":"python","files":[{"path":"main.py","content":"print(6*7)"}],"entryFile":"main.py"}'

# The response contains an id. Fetch the result with it:
curl -s ${origin}/v1/executions/<id> -H "Authorization: Bearer ${key}"
curl -s "${origin}/v1/executions/<id>/logs?stream=stdout&inline=true" -H "Authorization: Bearer ${key}"`,
    javascript: `const headers = { Authorization: "Bearer ${key}", "Content-Type": "application/json" };

const submit = await fetch("${origin}/v1/executions", {
  method: "POST",
  headers,
  body: JSON.stringify({
    language: "python",
    files: [{ path: "main.py", content: "print(6*7)" }],
    entryFile: "main.py",
  }),
});
const { id } = await submit.json();

// Poll until the run finishes, then read its output.
let run;
do {
  await new Promise((r) => setTimeout(r, 500));
  run = await (await fetch(\`${origin}/v1/executions/\${id}\`, { headers })).json();
} while (!["SUCCESS", "FAILED", "TIMEOUT", "CANCELLED", "DEAD_LETTERED"].includes(run.status));

const out = await fetch(\`${origin}/v1/executions/\${id}/logs?stream=stdout&inline=true\`, { headers });
console.log(run.status, await out.text());`,
    python: `import time
import requests

headers = {"Authorization": "Bearer ${key}"}
r = requests.post(
    "${origin}/v1/executions",
    headers=headers,
    json={
        "language": "python",
        "files": [{"path": "main.py", "content": "print(6*7)"}],
        "entryFile": "main.py",
    },
)
run_id = r.json()["id"]

# Poll until the run finishes, then read its output.
while True:
    run = requests.get(f"${origin}/v1/executions/{run_id}", headers=headers).json()
    if run["status"] in ("SUCCESS", "FAILED", "TIMEOUT", "CANCELLED", "DEAD_LETTERED"):
        break
    time.sleep(0.5)

out = requests.get(f"${origin}/v1/executions/{run_id}/logs", params={"stream": "stdout", "inline": "true"}, headers=headers)
print(run["status"], out.text)`,
  };
}

const LABELS = { curl: 'curl', javascript: 'JavaScript', python: 'Python' } as const;

export function CodeSnippets({ origin, apiKey }: { origin: string; apiKey: string }) {
  const snippets = buildSnippets(origin, apiKey);
  return (
    <Tabs defaultValue="curl">
      <TabsList>
        {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
          <TabsTrigger key={k} value={k}>
            {LABELS[k]}
          </TabsTrigger>
        ))}
      </TabsList>
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
        <TabsContent key={k} value={k} className="mt-3">
          <div className="relative rounded-md border bg-muted/50">
            <div className="absolute right-2 top-2">
              <CopyButton text={snippets[k]} label="Copy snippet" />
            </div>
            <pre tabIndex={0} aria-label={`${LABELS[k]} example`} className="max-h-80 overflow-auto p-4 pr-28 font-mono text-xs leading-relaxed">
              {snippets[k]}
            </pre>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
