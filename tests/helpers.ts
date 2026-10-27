import { NodeDriver } from '../src/core/db/node-driver';
import { openStore, type Repos } from '../src/core/store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function memoryStore(path = ':memory:'): Promise<Repos> {
  return openStore(new NodeDriver(path));
}

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', name)));
}

export function memoryBlobs() {
  const m = new Map<string, Uint8Array>();
  let n = 0;
  return {
    map: m,
    async put(name: string, bytes: Uint8Array) {
      const key = `${String(++n).padStart(8, '0')}-0000-0000-0000-000000000000-${name}`.slice(0, 200);
      m.set(key, bytes);
      return key;
    },
    async get(key: string) {
      const v = m.get(key);
      if (!v) throw new Error('missing');
      return v;
    },
  };
}
