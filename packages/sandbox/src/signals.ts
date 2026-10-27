import { constants } from 'node:os';

const byNumber = new Map<number, string>(Object.entries(constants.signals).map(([name, num]) => [num, name]));

export function signalName(num: number): string {
  return byNumber.get(num) ?? `SIG${num}`;
}
