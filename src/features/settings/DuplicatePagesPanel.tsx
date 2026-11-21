import { useEffect, useState } from 'react';
import { Copy, Search, Trash2 } from 'lucide-react';
import { repos, useApp } from '../../app/state';
import { useT } from '../../i18n';
import { Badge, Button, confirmDialog } from '../../components/ui';
import { reportError } from '../../app/services';
import {
  findAffectedBacklinks,
  findWorkspaceDuplicates,
  trashDuplicateCopies,
  type DuplicateGroup,
} from '../../core/duplicates';

export function DuplicatePagesPanel() {
  const t = useT();
  const workspaceId = useApp((s) => s.workspaceId);
  const lang = useApp((s) => s.lang);
  const navigate = useApp((s) => s.navigate);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleaningKey, setCleaningKey] = useState<string | null>(null);

  useEffect(() => {
    setGroups(null);
  }, [workspaceId]);

  const scan = async () => {
    if (!workspaceId) return;
    setScanning(true);
    try {
      setGroups(await findWorkspaceDuplicates(repos(), workspaceId));
    } catch (e) {
      reportError(e);
    } finally {
      setScanning(false);
    }
  };

  const cleanGroup = async (group: DuplicateGroup) => {
    if (!workspaceId || group.pages.length < 2) return;
    const kept = group.pages[0];
    const extras = group.pages.slice(1);
    const extraIds = extras.map((p) => p.id);
    setCleaningKey(group.key);
    try {
      const affected = await findAffectedBacklinks(repos(), extraIds, kept.id);
      let body = t('duplicates.confirmBody', { title: kept.title, n: extras.length });
      if (affected.length > 0) {
        const names =
          affected
            .slice(0, 5)
            .map((p) => p.title || t('common.untitled'))
            .join(', ') + (affected.length > 5 ? '…' : '');
        body += ' ' + t('duplicates.confirmLinks', { n: affected.length, pages: names });
      }
      if (
        !(await confirmDialog(t('duplicates.confirmTitle'), body, {
          danger: true,
          confirmLabel: t('duplicates.trashExtras'),
        }))
      ) {
        return;
      }
      const res = await trashDuplicateCopies(repos(), kept.id, extraIds);
      useApp.getState().bump();
      setGroups(await findWorkspaceDuplicates(repos(), workspaceId));
      useApp.getState().toast(
        res.redirectedPages > 0
          ? t('duplicates.cleanedWithLinks', { n: res.trashedIds.length, links: res.redirectedPages })
          : t('duplicates.cleaned', { n: res.trashedIds.length }),
        'success',
      );
    } catch (e) {
      reportError(e);
    } finally {
      setCleaningKey(null);
    }
  };

  const totalExtra = groups ? groups.reduce((sum, g) => sum + Math.max(0, g.pages.length - 1), 0) : 0;

  return (
    <div className="border-b border-line py-4">
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-sm font-medium">{t('duplicates.title')}</div>
          <div className="mt-0.5 text-xs text-muted">{t('duplicates.hint')}</div>
        </div>
        <div className="shrink-0">
          <Button
            size="sm"
            icon={<Search className="size-3.5" />}
            loading={scanning}
            disabled={!workspaceId || scanning || cleaningKey !== null}
            onClick={() => void scan()}
          >
            {t('duplicates.scan')}
          </Button>
        </div>
      </div>

      {groups !== null && groups.length === 0 && (
        <p className="mt-3 text-xs text-muted">{t('duplicates.none')}</p>
      )}

      {groups !== null && groups.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs text-muted">
            {t('duplicates.found', { groups: groups.length, extra: totalExtra })}
          </div>
          <ul aria-label={t('duplicates.title')} className="space-y-2">
            {groups.map((group) => (
              <li key={group.key} className="rounded-lg border border-line bg-elevated p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Copy className="size-3.5 shrink-0 text-muted" />
                    <span className="truncate text-sm font-medium">{group.pages[0].title}</span>
                    <Badge color="blue">{t('duplicates.copies', { n: group.pages.length })}</Badge>
                    <Badge color="gray">{t('duplicates.size', { n: group.characters })}</Badge>
                    {!group.sameTitle && <Badge color="amber">{t('duplicates.differentTitles')}</Badge>}
                  </div>
                  <Button
                    size="sm"
                    icon={<Trash2 className="size-3.5" />}
                    loading={cleaningKey === group.key}
                    disabled={cleaningKey !== null}
                    onClick={() => void cleanGroup(group)}
                  >
                    {t('duplicates.trashExtras')}
                  </Button>
                </div>
                <ul className="mt-2 space-y-1 border-t border-line pt-2">
                  {group.pages.map((p, idx) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => navigate({ name: 'page', id: p.id })}
                          className="truncate font-medium text-fg hover:underline"
                        >
                          {p.title}
                        </button>
                        {idx === 0 && <Badge color="green">{t('duplicates.keepOldest')}</Badge>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-faint">
                        <span>{p.parentPath.length ? p.parentPath.join(' / ') : t('duplicates.rootPath')}</span>
                        <span>·</span>
                        <span>{new Date(p.createdAt).toLocaleDateString(lang)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
