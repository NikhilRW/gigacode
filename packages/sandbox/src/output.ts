import { createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';

export interface CapturedOutput {
  bytes: number;
  truncated: boolean;
}

/**
 * Copy a stream to a file, keeping at most `cap` bytes. Excess output is read and discarded
 * so the sandboxed program never blocks on a full pipe; the run still ends on its time limit.
 */
export function captureCapped(stream: Readable, path: string, cap: number): Promise<CapturedOutput> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(path, { mode: 0o600 });
    let written = 0;
    let truncated = false;
    stream.on('data', (chunk: Buffer) => {
      if (written >= cap) {
        truncated = true;
        return;
      }
      const room = cap - written;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (chunk.length > room) truncated = true;
      written += slice.length;
      file.write(slice);
    });
    stream.on('error', reject);
    stream.on('end', () => file.end(() => resolve({ bytes: written, truncated })));
    file.on('error', reject);
  });
}
