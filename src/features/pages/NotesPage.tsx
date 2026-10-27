import { useMemo, useState } from 'react';
import { FileText, Plus, LayoutTemplate } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { Button, EmptyState, Input, PageHeader, Select, useAsync, cx } from '../../components/ui';
import { createPage } from '../actions';
import { relativeTime } from '../../lib/util';
import type { DocNode } from '../../core/doc';

type SortKey = 'updated' | 'created' | 'title';

export default function NotesPage() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [tag, setTag] = useState('');
  const { data } = useAsync(async () => {
    const ws = wsId();
    const [pages, tags, templates] = await Promise.all([repos().pages.listTree(ws), repos().pages.listTags(ws), repos().pages.listTemplates(ws)]);
    const tagged = tag ? new Set((await repos().pages.pagesWithTag(tag)).map((p) => p.id)) : null;
    return { pages: pages.filter((p) => p.kind === 'page' && (!tagged || tagged.has(p.id))), tags, templates };
  }, [version, tag]);
  const list = useMemo(() => {
    const items = (data?.pages ?? []).filter((p) => (p.title || '').toLocaleLowerCase().includes(q.toLocaleLowerCase()));
    return items.sort((a, b) => (sort === 'title' ? (a.title || '').localeCompare(b.title || '') : sort === 'created' ? b.created_at - a.created_at : b.updated_at - a.updated_at));
  }, [data, q, sort]);
  return (
    <div className="mx-auto max-w-[980px] px-8 py-10">
      <PageHeader
        icon={<FileText className="size-5" />}
        title={t('nav.notes')}
        subtitle={`${list.length}`}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => void createPage()}>
            {t('nav.newPage')}
          </Button>
        }
      />
      {data?.templates.length ? (
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
            <LayoutTemplate className="size-3.5" /> {t('page.fromTemplate')}
          </div>
          <div className="flex flex-wrap gap-2">
            {data.templates.map((tpl) => (
              <Button
                key={tpl.id}
                size="sm"
                onClick={() => void createPage(null, tpl.title.replace(/template|şablon/i, '').trim(), tpl.content_json ? (JSON.parse(tpl.content_json) as DocNode) : null)}
              >
                {tpl.icon ?? '📄'} {tpl.title || t('common.untitled')}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          value={sort}
          onChange={setSort}
          ariaLabel={t('db.sort')}
          options={[
            { value: 'updated', label: t('home.edited') },
            { value: 'created', label: t('common.create') },
            { value: 'title', label: t('common.name') },
          ]}
        />
        <Select value={tag} onChange={setTag} ariaLabel={t('page.tags')} options={[{ value: '', label: `${t('page.tags')}: ${t('common.all')}` }, ...(data?.tags ?? []).map((tg) => ({ value: tg.id, label: `#${tg.name}` }))]} />
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<FileText className="size-5" />} title={t('home.empty')} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-elevated">
          {list.map((p, i) => (
            <button key={p.id} onClick={() => navigate({ name: 'page', id: p.id })} className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover', i > 0 && 'border-t border-line')}>
              <span>{p.icon ?? '📄'}</span>
              <span className="flex-1 truncate text-sm">{p.title || t('common.untitled')}</span>
              {p.is_template ? <span className="text-xs text-accent">template</span> : null}
              <span className="text-xs text-faint">{relativeTime(p.updated_at, lang)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
