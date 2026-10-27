import { execFile } from 'node:child_process';
import { chown, mkdir, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { isSafeRelativePath, s3Keys, sha256Hex, withRetry, type SourceManifest } from '@engine/shared';
import type { ClaimedJob } from '@engine/db';
import type { Storage } from '@engine/storage';

const run = promisify(execFile);

export interface RunDir {
  root: string;
  workspace: string;
  stdinPath: string;
  manifest: SourceManifest;
  mountedTmpfs: boolean;
}

const isRoot = () => process.getuid?.() === 0;

/**
 * Fresh per-run directory: <runs>/<executionId>-<attempt>, mode 0711. The workspace is a
 * size-capped tmpfs (when running as root) owned by the slot's sandbox uid, so a run can never
 * fill the host disk or see another run's files.
 */
export async function prepareRunDir(
  runsDir: string,
  job: ClaimedJob,
  storage: Storage,
  hostUid: number,
  workspaceMb: number,
): Promise<RunDir> {
  const root = join(runsDir, `${job.id}-${job.attempt}`);
  await rm(root, { recursive: true, force: true });
  // 0711: traversable but not listable. nsjail bind-mounts the workspace from inside its user
  // namespace, which needs search permission on every parent directory.
  await mkdir(root, { mode: 0o711 });
  await chmod(root, 0o711);
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { mode: 0o700 });
  let mountedTmpfs = false;
  if (isRoot()) {
    try {
      await run('mount', ['-t', 'tmpfs', '-o', `size=${workspaceMb}m,mode=0700,nosuid,nodev`, 'tmpfs', workspace]);
      mountedTmpfs = true;
    } catch {
      // fall back to a plain directory (runs dir itself is a capped tmpfs in compose / worker VM)
    }
  }

  const manifest = await withRetry(() =>
    storage.getJson<SourceManifest>(s3Keys.manifest(job.tenantId, job.id)),
  );
  for (const f of manifest.files) {
    if (!isSafeRelativePath(f.path)) throw new Error('unsafe path in manifest');
    const target = join(workspace, f.path);
    await mkdir(dirname(target), { recursive: true });
    const body = await withRetry(() => storage.getBuffer(s3Keys.sourceFile(job.tenantId, job.id, f.path)));
    if (body.length !== f.bytes || sha256Hex(body) !== f.sha256) throw new Error('source checksum mismatch');
    await writeFile(target, body, { mode: 0o644 });
  }
  const stdinPath = join(root, 'stdin');
  const stdin = await withRetry(() => storage.getBuffer(s3Keys.stdin(job.tenantId, job.id)));
  if (stdin.length !== manifest.stdin.bytes || sha256Hex(stdin) !== manifest.stdin.sha256)
    throw new Error('stdin checksum mismatch');
  await writeFile(stdinPath, stdin, { mode: 0o600 });

  if (isRoot()) await chownTree(workspace, hostUid);
  else await chmod(workspace, 0o777);
  return { root, workspace, stdinPath, manifest, mountedTmpfs };
}

async function chownTree(dir: string, uid: number) {
  await run('chown', ['-R', `${uid}:${uid}`, dir]).catch(async () => chown(dir, uid, uid));
}

export async function cleanupRunDir(dir: RunDir | null, root?: string) {
  const target = dir?.root ?? root;
  if (!target) return;
  if (dir?.mountedTmpfs) await run('umount', ['-l', dir.workspace]).catch(() => {});
  await rm(target, { recursive: true, force: true }).catch(() => {});
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path).catch(() => ({ size: 0 }))).size;
}

export const readSmall = (path: string) => readFile(path).catch(() => Buffer.alloc(0));
