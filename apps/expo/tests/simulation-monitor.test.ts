import { describe, expect, test } from 'bun:test';
import { simulationTarget } from '../src/lib/simulation/target';

const pageOrigin = 'https://gentle-space-abc123-8081.app.github.dev';
const apiOrigin = 'https://gentle-space-abc123-3000.app.github.dev';

describe('Codespaces target boundaries (no network)', () => {
  test('allows different forwarded ports only in the same canonical workspace', () => {
    expect(simulationTarget(apiOrigin, pageOrigin)).toEqual({
      kind: 'codespaces', origin: apiOrigin, workspace: 'gentle-space-abc123', label: 'Matching Codespaces workspace',
    });
    expect(simulationTarget(`${apiOrigin}/`, pageOrigin).origin).toBe(apiOrigin);
  });

  test('blocks absent, native, local and mismatched browser origins', () => {
    for (const page of [null, '', 'http://localhost:8081', 'https://other-space-8081.app.github.dev', 'https://example.com'])
      expect(simulationTarget(apiOrigin, page).kind).toBe('blocked');
  });

  test('rejects forwarded origin lookalikes and normalization tricks on either side', () => {
    for (const origin of [
      'http://gentle-space-abc123-3000.app.github.dev',
      `${apiOrigin}.evil.test`, `${apiOrigin}:443`, `${apiOrigin}/v1`, `${apiOrigin}/../`,
      `${apiOrigin}?target=local`, `${apiOrigin}#fragment`, ` ${apiOrigin}`,
      'https://user@gentle-space-abc123-3000.app.github.dev',
      'https://gentle-space-abc123-3000.app.github.dev@evil.test',
      'https://GENTLE-space-abc123-3000.app.github.dev',
      'https://gentle-space-abc123-03000.app.github.dev',
      'https://gentle-space-abc123-0.app.github.dev',
      'https://gentle-space-abc123-65536.app.github.dev',
      'https://gentle-space-abc123-3000.app.github.dev.',
      'https://gentle-space-abc123-3000.app.github.dev\\@evil.test',
      `https://${'a'.repeat(64)}-3000.app.github.dev`,
    ]) {
      expect(simulationTarget(origin, pageOrigin).kind).toBe('blocked');
      expect(simulationTarget(apiOrigin, origin).kind).toBe('blocked');
    }
  });

  test('loopback remains independently supported and canonical-only', () => {
    expect(simulationTarget('http://localhost:3000', pageOrigin).kind).toBe('loopback');
    for (const origin of ['http://127.1:3000', 'http://LOCALHOST:3000', 'http://localhost:03000', 'http://localhost:65536'])
      expect(simulationTarget(origin, pageOrigin).kind).toBe('blocked');
  });
});
