import { z } from 'zod';
import { languageIds, languages } from './languages';
import type { Language, Source, TenantLimits } from './types';

export const STORAGE_KEY = 'gigacode:drafts:v1';
export const draftSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(64),
  code: z.string(), updatedAt: z.number().finite(), language: z.enum(['python', 'node', 'c', 'cpp']).default('python'),
});
export const librarySchema = z.object({
  version: z.literal(1), files: z.array(draftSchema).min(1), activeId: z.string(),
  language: z.enum(['python', 'node', 'c', 'cpp']).default('python'),
  entries: z.object({ python: z.string().optional(), node: z.string().optional(), c: z.string().optional(), cpp: z.string().optional() }).default({}),
  stdin: z.string().default(''), timeoutMs: z.number().int().positive().default(5000), memoryMb: z.number().int().positive().default(256), fontSize: z.number().min(14).max(26).default(17),
});
export type Draft = z.infer<typeof draftSchema>;
export type Library = z.infer<typeof librarySchema>;
export const starterCode = `# Every great idea starts with a little code.\n\ndef greet(name):\n    return f"Hello, {name}!"\n\n\nmessage = greet("universe")\nprint(message)\n\n# Make it yours. Try typing print below.\n`;
export function createLibrary(): Library {
  return librarySchema.parse({ version: 1, activeId: 'hello', entries: { python: 'hello' }, files: [{ id: 'hello', name: 'hello_universe.py', code: starterCode, updatedAt: Date.now() }] });
}
export function decodeLibrary(raw: string): Library {
  const library = librarySchema.parse(JSON.parse(raw));
  if (new Set(library.files.map(file => file.id)).size !== library.files.length) throw new Error('Duplicate file IDs');
  if (!library.files.some(file => file.id === library.activeId)) library.activeId = library.files[0].id;
  library.language = library.files.find(file => file.id === library.activeId)!.language;
  for (const language of languageIds) {
    const files = library.files.filter(file => file.language === language);
    if (!files.some(file => file.id === library.entries[language])) library.entries[language] = files[0]?.id;
    if (new Set(files.map(file => file.name.toLowerCase())).size !== files.length) throw new Error('Duplicate file names');
  }
  return library;
}
export function pythonFilename(input: string, files: Draft[], exceptId?: string): string {
  return sourceFilename(input, files, 'python', exceptId);
}
export function sourceFilename(input: string, files: Draft[], language: Language, exceptId?: string): string {
  let name = input.trim();
  if (!name) throw new Error('Give your file a name.');
  if (!name.includes('.')) name += languages[language].extension;
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_. -]*$/.test(name) || name.includes('..') || name.length > 64) {
    throw new Error('Use a simple relative file name: letters, numbers, spaces, dots, or underscores. Maximum 64 characters.');
  }
  if (files.some(file => file.language === language && file.id !== exceptId && file.name.toLowerCase() === name.toLowerCase())) throw new Error('A file with that name already exists.');
  return name;
}

// Each language keeps its own files and entry point. Switching never destroys guest work.
export function switchLanguage(library: Library, language: Language): Library {
  const existing = library.files.find(file => file.language === language && file.id === library.entries[language]) ?? library.files.find(file => file.language === language);
  if (existing) return { ...library, language, activeId: existing.id };
  const id = `starter-${language}-${Date.now()}`;
  const file: Draft = { id, language, name: languages[language].entry, code: languages[language].starter, updatedAt: Date.now() };
  return { ...library, language, activeId: id, entries: { ...library.entries, [language]: id }, files: [...library.files, file] };
}
export function removeFile(library: Library, id: string): Library {
  const file = library.files.find(item => item.id === id);
  if (!file) throw new Error('File not found.');
  const remaining = library.files.filter(item => item.language === file.language && item.id !== id);
  if (!remaining.length) throw new Error('Keep at least one file per language.');
  return { ...library, files: library.files.filter(item => item.id !== id), activeId: library.activeId === id ? remaining[0].id : library.activeId, entries: { ...library.entries, [file.language]: library.entries[file.language] === id ? remaining[0].id : library.entries[file.language] } };
}
export function executionSource(library: Library, limits: TenantLimits): Source {
  const files = library.files.filter(file => file.language === library.language);
  const entry = files.find(file => file.id === library.entries[library.language]) ?? files[0];
  if (!entry || files.length > 20) throw new Error('A run needs 1–20 files for its language.');
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  if (files.reduce((total, file) => total + bytes(file.code), 0) > limits.maxSourceBytes) throw new Error('Source exceeds your tenant source-size limit.');
  if (bytes(library.stdin) > 256 * 1024) throw new Error('Standard input must be at most 256 KiB.');
  return { language: library.language, entryFile: entry.name, files: files.map(file => ({ path: file.name, content: file.code })), stdin: library.stdin,
    limits: { timeoutMs: Math.max(100, Math.min(library.timeoutMs, limits.maxTimeoutMs, 10000)), memoryMb: Math.max(16, Math.min(library.memoryMb, limits.maxMemoryMb, 512)) } };
}

// A single write queue prevents an older autosave from finishing after a newer manual save.
export function createWriteQueue(write: (value: string) => Promise<void>) {
  let pending: Promise<void> = Promise.resolve();
  return (library: Library) => {
    const snapshot = JSON.stringify(library);
    const next = pending.catch(() => undefined).then(() => write(snapshot));
    pending = next;
    return next;
  };
}
