import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LANGUAGES, type LanguageId } from '@engine/shared';

const cache = new Map<string, string>();

/** kafel's lexer rejects CR and is fragile around comments; reviewers get comments, nsjail gets clean text. */
function clean(source: string): string {
  return source
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\n/gm, '');
}

/** Compose the base policy with the language's additions into one kafel program. */
export async function composeSeccompPolicy(dir: string, language: LanguageId, network = false): Promise<string> {
  const key = `${dir}:${language}:${network}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const base = await readFile(join(dir, 'base.kafel'), 'utf8');
  const extraFile = LANGUAGES[language].seccompExtra;
  const extra = extraFile ? await readFile(join(dir, extraFile), 'utf8') : '';
  const networkPolicy = await readFile(join(dir, network ? 'network-on.kafel' : 'network-off.kafel'), 'utf8');
  const use = ['base_allow', 'base_errno', 'base_deny', 'network_access', ...(extraFile ? ['lang_extra'] : [])];
  // kafel's top-level USE takes a single policy, so the parts are wrapped in one.
  const policy = [
    clean(base),
    clean(extra),
    clean(networkPolicy),
    `POLICY sandbox { ${use.map((u) => `USE ${u}`).join(', ')} }`,
    'USE sandbox DEFAULT KILL_PROCESS',
    '',
  ].join('\n');
  cache.set(key, policy);
  return policy;
}
