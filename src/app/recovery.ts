import { openStore } from '../core/store';
import { inspectBackup, restoreBackup, type BlobAccess } from '../core/backup';
import { integrityCheck } from '../core/db/migrations';
import type { SqlDriver } from '../core/db/driver';
import { blobStore, isTauri, packBinary, unpackBinary } from '../lib/platform';
import JSZip from 'jszip';

export interface RecoveryDriver extends SqlDriver { exportBytes(): Promise<Uint8Array> }

/** The failed database is never used to validate or reconstruct a backup. */
export async function stageRecovery(bytes: Uint8Array, create: () => Promise<RecoveryDriver>, blobs: BlobAccess) {
  await inspectBackup(bytes);
  const driver = await create();
  try {
    const store = await openStore(driver);
    await restoreBackup(store.db, bytes, blobs);
    const check = await integrityCheck(store.db);
    if (!check.ok) throw new Error('Restored database failed its integrity check.');
    await store.db.flushNow();
    return await driver.exportBytes();
  } finally { await driver.close?.(); }
}

const browserKey = () => new URLSearchParams(location.search).get('db') ?? 'main';
export async function restoreFromRecovery(bytes: Uint8Array) {
  const { WasmDriver } = await import('../core/db/wasm-driver');
  const snapshot = await stageRecovery(bytes, () => WasmDriver.empty(), blobStore);
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('recovery_install', packBinary({}, snapshot));
  } else await WasmDriver.installSnapshot(browserKey(), snapshot);
}

export async function rawRecoveryArchive() {
  const zip = new JSZip();
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<ArrayBuffer>('recovery_raw');
    const { meta, payload } = unpackBinary<{ files: { name: string; size: number }[] }>(response);
    let offset = 0;
    for (const file of meta.files) { zip.file(file.name, payload.slice(offset, offset + file.size)); offset += file.size; }
  } else {
    const { WasmDriver } = await import('../core/db/wasm-driver');
    const raw = await WasmDriver.readSnapshot(browserKey());
    if (!raw) throw new Error('No stored database file is available.');
    zip.file('noesis.db', raw);
  }
  zip.file('README.txt', 'Raw recovery copy, not a Noesis backup. Preserve database and any WAL/SHM files together. No attachment files are included.');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function openRecoveryBackups() {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('recovery_open_backups');
}
