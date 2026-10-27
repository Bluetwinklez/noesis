import { Database, type SqlDriver } from './db/driver';
import { migrate } from './db/migrations';
import { DatabaseRepo } from './repos/databases';
import { PageRepo, WorkspaceRepo } from './repos/pages';
import { AttachmentRepo, NotebookRepo, SemanticLinkRepo, SettingsRepo, SourceRepo } from './repos/research';
import { TaskRepo } from './repos/tasks';

export interface Repos {
  db: Database;
  workspaces: WorkspaceRepo;
  pages: PageRepo;
  databases: DatabaseRepo;
  tasks: TaskRepo;
  notebooks: NotebookRepo;
  sources: SourceRepo;
  attachments: AttachmentRepo;
  links: SemanticLinkRepo;
  settings: SettingsRepo;
}

export async function openStore(driver: SqlDriver): Promise<Repos> {
  const db = new Database(driver);
  await migrate(db);
  return createRepos(db);
}

export function createRepos(db: Database): Repos {
  return {
    db,
    workspaces: new WorkspaceRepo(db),
    pages: new PageRepo(db),
    databases: new DatabaseRepo(db),
    tasks: new TaskRepo(db),
    notebooks: new NotebookRepo(db),
    sources: new SourceRepo(db),
    attachments: new AttachmentRepo(db),
    links: new SemanticLinkRepo(db),
    settings: new SettingsRepo(db),
  };
}
