import type { DatabaseSync } from 'node:sqlite';

export const LARGE_DATA_COUNTS: Readonly<{ pages: number; databases: number; rowsPerDatabase: number; sources: number }>;
export const LARGE_WORKSPACE_ID: string;
export function seedLargeData(db: DatabaseSync, counts?: typeof LARGE_DATA_COUNTS): {
  pages: number;
  databases: number;
  rowsPerDatabase: number;
  sources: number;
  databaseRows: number;
};
