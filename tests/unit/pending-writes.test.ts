import { describe, expect, it } from 'vitest';
import { Database, type SqlDriver } from '../../src/core/db/driver';
import { debounce } from '../../src/lib/util';
import { flushAllWrites, registerFlusher } from '../../src/app/pendingWrites';
import { useApp } from '../../src/app/state';
import { memoryStore } from '../helpers';

/** Like the desktop driver: every statement is an async round trip, no snapshot flush. */
function slowDriver(log: string[]): SqlDriver {
  return {
    kind: 'native',
    async exec(sql: string) {
      await new Promise((r) => setTimeout(r, 30));
      log.push(sql);
      return { rows: [], changes: 1, lastInsertRowid: 0 };
    },
  } as unknown as SqlDriver;
}

describe('finishing writes before quit', () => {
  it('flushNow waits for statements already queued (desktop driver has no flush)', async () => {
    const log: string[] = [];
    const db = new Database(slowDriver(log));
    void db.run('A');
    void db.run('B');
    await db.flushNow();
    expect(log).toEqual(['A', 'B']);
  });

  it('debounce.settle runs the pending call and waits for it', async () => {
    const done: string[] = [];
    const save = debounce(async (v: string) => {
      await new Promise((r) => setTimeout(r, 20));
      done.push(v);
    }, 10_000);
    save('a');
    save('b');
    await save.settle();
    expect(done).toEqual(['b']);
  });

  it('debounce.settle also waits for a call that is already running', async () => {
    const done: string[] = [];
    const save = debounce(async (v: string) => {
      await new Promise((r) => setTimeout(r, 40));
      done.push(v);
    }, 1);
    save('x');
    await new Promise((r) => setTimeout(r, 10)); // timer fired, save in flight
    await save.settle();
    expect(done).toEqual(['x']);
  });

  it('flushAllWrites saves a delayed page edit before returning', async () => {
    const repos = await memoryStore();
    useApp.setState({ repos });
    const ws = (await repos.workspaces.create('W')).id;
    const page = await repos.pages.create({ workspaceId: ws, title: 'Draft' });
    const saveTitle = debounce((title: string) => repos.pages.updateMeta(page.id, { title }), 10_000);
    const unregister = registerFlusher(() => saveTitle.settle());
    saveTitle('Typed just before quitting');
    await flushAllWrites();
    unregister();
    expect((await repos.pages.get(page.id))?.title).toBe('Typed just before quitting');
  });
});
