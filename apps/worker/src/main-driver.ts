import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { DockerDriver, NsjailDriver, type SandboxDriver } from '@engine/sandbox';
import type { WorkerConfig } from './config.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export function createDriver(config: WorkerConfig, log: Logger): SandboxDriver {
  if (config.SANDBOX_DRIVER === 'docker') {
    log.warn('DEV ONLY: requires docker socket, weaker isolation');
    console.warn('\n*** DEV ONLY: SANDBOX_DRIVER=docker requires the docker socket and gives weaker isolation ***\n');
    return new DockerDriver({
      seccompProfile: resolve(repoRoot, 'infra/docker/seccomp-dev.json'),
      languages: config.languages,
    });
  }
  return new NsjailDriver({
    nsjailBin: config.NSJAIL_BIN,
    rootfsDir: config.SANDBOX_ROOTFS_DIR,
    seccompDir: resolve(repoRoot, config.SANDBOX_SECCOMP_DIR),
    languages: config.languages,
  });
}
