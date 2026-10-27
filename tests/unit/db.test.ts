import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/core/db/driver';
import { NodeDriver } from '../../src/core/db/node-driver';
import { integrityCheck, LATEST_VERSION, migrate, migrations, splitSql } from '../../src/core/db/migrations';
import { openStore } from '../../src/core/store';
import { docFromParagraphs } from '../../src/core/doc';

describe('migrations', () => {
  it('applies all migrations once and is idempotent', async () => {
    const db = new Database(new NodeDriver());
    expect(await migrate(db)).toBe(migrations.length);
    expect(await migrate(db)).toBe(0);
    const v = await db.get<{ v: number }>('SELECT MAX(version) v FROM schema_migrations');
    expect(v?.v).toBe(LATEST_VERSION);
    const fk = await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
  });

  it('keeps trigger bodies intact when splitting', () => {
    const parts = splitSql(migrations[0].sql);
    const trig = parts.find((p) => p.includes('CREATE TRIGGER chunks_ai'));
    expect(trig).toMatch(/END$/);
  });

  it('refuses to open a database from a newer app version', async () => {
    const db = new Database(new NodeDriver());
    await migrate(db);
    await db.run("INSERT INTO schema_migrations VALUES (999, 'future', 0)");
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });

  it('rolls back a failing migration completely', async () => {
    const db = new Database(new NodeDriver());
    await migrate(db);
    const bad = [...migrations, { version: LATEST_VERSION + 1, name: 'bad', sql: 'CREATE TABLE ok_table(x);\nINSERT INTO missing_table VALUES (1);' }];
    await expect(migrate(db, bad)).rejects.toThrow();
    const t = await db.get("SELECT name FROM sqlite_master WHERE name = 'ok_table'");
    expect(t).toBeUndefined();
    const v = await db.get<{ v: number }>('SELECT MAX(version) v FROM schema_migrations');
    expect(v?.v).toBe(LATEST_VERSION);
  });

  it('passes integrity checks on a populated database', async () => {
    const s = await openStore(new NodeDriver());
    const ws = await s.workspaces.create('Test');
    await s.pages.create({ workspaceId: ws.id, title: 'A' });
    expect((await integrityCheck(s.db)).ok).toBe(true);
  });
});

describe('transactions', () => {
  it('serialises concurrent transactions and rolls back failures', async () => {
    const s = await openStore(new NodeDriver());
    const ws = await s.workspaces.create('T');
    const results = await Promise.allSettled([
      s.db.transaction(async (tx) => {
        await tx.run('INSERT INTO tags(id, workspace_id, name) VALUES (?,?,?)', ['a', ws.id, 'one']);
        await new Promise((r) => setTimeout(r, 20));
        throw new Error('boom');
      }),
      s.db.transaction(async (tx) => {
        await tx.run('INSERT INTO tags(id, workspace_id, name) VALUES (?,?,?)', ['b', ws.id, 'two']);
      }),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    const tags = await s.db.all<{ id: string }>('SELECT id FROM tags');
    expect(tags.map((t) => t.id)).toEqual(['b']);
  });
});

describe('restart persistence', () => {
  it('keeps pages and content after closing and reopening the database file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noesis-'));
    const file = join(dir, 'test.db');
    const d1 = new NodeDriver(file);
    const s1 = await openStore(d1);
    const ws = await s1.workspaces.create('Persist');
    const p = await s1.pages.create({ workspaceId: ws.id, title: 'Kalıcı sayfa' });
    await s1.pages.saveContent(p.id, docFromParagraphs(['Hello **after** restart']));
    await d1.close();

    const d2 = new NodeDriver(file);
    const s2 = await openStore(d2);
    const again = await s2.pages.get(p.id);
    expect(again?.title).toBe('Kalıcı sayfa');
    expect(again?.content_text).toContain('after');
    expect((await s2.workspaces.list()).length).toBe(1);
    await d2.close();
  });
});

describe('migration v3 (timeline views)', () => {
  it('keeps existing database views when upgrading and accepts the timeline type', async () => {
    const { NodeDriver } = await import('../../src/core/db/node-driver');
    const { Database } = await import('../../src/core/db/driver');
    const { migrate, migrations } = await import('../../src/core/db/migrations');
    const db = new Database(new NodeDriver(':memory:'));
    await migrate(db, migrations.slice(0, 2)); // a v2 database
    await db.run("INSERT INTO workspaces(id, name, created_at, updated_at) VALUES ('w','W',0,0)");
    await db.run("INSERT INTO pages(id, workspace_id, kind, title, created_at, updated_at) VALUES ('d','w','database','DB',0,0)");
    await db.run("INSERT INTO db_views(id, database_id, name, type, config_json, sort_order) VALUES ('v','d','Board','board','{\"groupBy\":\"x\"}',1)");
    await expect(db.run("INSERT INTO db_views(id, database_id, name, type) VALUES ('t','d','T','timeline')")).rejects.toThrow();
    await migrate(db);
    expect(await db.get("SELECT name, type, config_json FROM db_views WHERE id = 'v'")).toEqual({ name: 'Board', type: 'board', config_json: '{"groupBy":"x"}' });
    await db.run("INSERT INTO db_views(id, database_id, name, type) VALUES ('t','d','T','timeline')");
    await db.run("DELETE FROM pages WHERE id = 'd'");
    expect(await db.all('SELECT id FROM db_views')).toEqual([]); // cascade still works after the rebuild
  });
});
