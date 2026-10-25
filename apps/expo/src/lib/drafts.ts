import { z } from 'zod';

export const STORAGE_KEY = 'gigacode:drafts:v1';
export const draftSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(64),
  code: z.string(), updatedAt: z.number().finite(),
});
export const librarySchema = z.object({ version: z.literal(1), files: z.array(draftSchema).min(1), activeId: z.string() });
export type Draft = z.infer<typeof draftSchema>;
export type Library = z.infer<typeof librarySchema>;
export const starterCode = `# Every great idea starts with a little code.\n\ndef greet(name):\n    return f"Hello, {name}!"\n\n\nmessage = greet("universe")\nprint(message)\n\n# Make it yours. Try typing print below.\n`;
export function createLibrary(): Library {
  return { version: 1, activeId: 'hello', files: [{ id: 'hello', name: 'hello_universe.py', code: starterCode, updatedAt: Date.now() }] };
}
export function decodeLibrary(raw: string): Library {
  const library = librarySchema.parse(JSON.parse(raw));
  if (new Set(library.files.map(file => file.id)).size !== library.files.length) throw new Error('Duplicate file IDs');
  if (!library.files.some(file => file.id === library.activeId)) library.activeId = library.files[0].id;
  return library;
}
export function pythonFilename(input: string, files: Draft[], exceptId?: string): string {
  let name = input.trim();
  if (!name) throw new Error('Give your file a name.');
  if (!name.endsWith('.py')) name += '.py';
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_. -]*\.py$/.test(name) || name.length > 64) {
    throw new Error('Use letters, numbers, spaces, dots, or underscores. Maximum 64 characters.');
  }
  if (files.some(file => file.id !== exceptId && file.name.toLowerCase() === name.toLowerCase())) throw new Error('A file with that name already exists.');
  return name;
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
