import { describe, expect, test } from 'bun:test';
import { createLibrary, createWriteQueue, decodeLibrary, pythonFilename } from '../src/lib/drafts';

describe('device draft library', () => {
  test('round trips code and selection without executing code', () => {
    const library = createLibrary();
    library.files[0].code = 'print("🌌")\n';
    expect(decodeLibrary(JSON.stringify(library))).toEqual(library);
  });
  test('rejects corrupt or unsupported storage rather than silently replacing it', () => {
    expect(() => decodeLibrary('{broken')).toThrow();
    expect(() => decodeLibrary(JSON.stringify({ ...createLibrary(), version: 2 }))).toThrow();
    expect(() => decodeLibrary(JSON.stringify({ version: 1, files: [], activeId: '' }))).toThrow();
  });
  test('repairs a missing selection but rejects ambiguous file identities', () => {
    const library = createLibrary();
    library.activeId = 'missing';
    expect(decodeLibrary(JSON.stringify(library)).activeId).toBe('hello');
    library.files.push(library.files[0]);
    expect(() => decodeLibrary(JSON.stringify(library))).toThrow('Duplicate file IDs');
  });
  test('normalizes Python names and allows renaming the same file', () => {
    const files = createLibrary().files;
    expect(pythonFilename('  solar_system  ', files)).toBe('solar_system.py');
    expect(pythonFilename('hello_universe.py', files, 'hello')).toBe('hello_universe.py');
  });
  test('rejects blank, path-like, overlong and case-insensitive duplicate names', () => {
    const files = createLibrary().files;
    for (const name of ['', '../secret', 'folder/file', 'folder\\file', 'a'.repeat(65), 'HELLO_UNIVERSE.py']) {
      expect(() => pythonFilename(name, files)).toThrow();
    }
  });
  test('serializes writes and snapshots each request at enqueue time', async () => {
    const writes: string[] = [];
    const write = createWriteQueue(async value => { await Promise.resolve(); writes.push(value); });
    const library = createLibrary();
    const first = write(library);
    library.files[0].code = '# newest';
    const second = write(library);
    await Promise.all([first, second]);
    expect(JSON.parse(writes[0]).files[0].code).not.toBe('# newest');
    expect(JSON.parse(writes[1]).files[0].code).toBe('# newest');
  });
  test('reports a failed write and permits a subsequent retry', async () => {
    let attempts = 0;
    const write = createWriteQueue(async () => { if (++attempts === 1) throw new Error('storage denied'); });
    await expect(write(createLibrary())).rejects.toThrow('storage denied');
    await write(createLibrary());
    expect(attempts).toBe(2);
  });
});
