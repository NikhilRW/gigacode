import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

export function forwardedUrl(port, env = process.env) {
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
  if (!name || !/^[a-z0-9-]+$/.test(name) || !/^[a-z0-9.-]+$/.test(domain)) {
    throw new Error('Run inside a Codespace with CODESPACE_NAME set (see docs/CODESPACES.md).');
  }
  return `https://${name}-${port}.${domain}`;
}

export async function setup(root = repoRoot, env = process.env) {
  const path = resolve(root, '.devcontainer/.env.codespaces');
  const secret = () => randomBytes(32).toString('hex');
  const content = [
    '# Local development only. Do not commit or share. Created once; never overwritten.',
    `JWT_SECRET=${secret()}`,
    `WORKER_DB_PASSWORD=${secret()}`,
    `SEED_ADMIN_PASSWORD=${secret()}`,
    `SEED_DEMO_PASSWORD=${secret()}`,
    `CODESPACES_WEB_ORIGIN=${forwardedUrl(8081, env)}`,
    '',
  ].join('\n');
  try {
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    return 'Created .devcontainer/.env.codespaces (secrets not printed).';
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return 'Preserved existing .devcontainer/.env.codespaces; check its origin if the Codespace changed.';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'api-url') console.log(forwardedUrl(3000));
    else if (process.argv.length === 2) console.log(await setup());
    else throw new Error('Usage: node .devcontainer/setup.mjs [api-url]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
