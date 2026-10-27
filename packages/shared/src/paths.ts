/**
 * A user-supplied relative file path is safe when it cannot escape the workspace:
 * no absolute paths, no `..`, no empty segments, no NUL or backslash, plain characters only.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false;
  if (path.includes('\0') || path.includes('\\')) return false;
  if (path.startsWith('/') || path.startsWith('~')) return false;
  const parts = path.split('/');
  if (parts.length > 8) return false;
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..' && /^[A-Za-z0-9._-]+$/.test(part));
}
