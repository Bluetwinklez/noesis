import { Star } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { EmptyState, IconButton, PageHeader, useAsync, cx } from '../../components/ui';
import { toggleFavorite } from '../actions';

export default function FavoritesPage() {
  const t = useT();
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const { data } = useAsync(() => repos().pages.listFavorites(wsId()), [version]);
  return (
    <div className="mx-auto max-w-[820px] px-8 py-10">
      <PageHeader icon={<Star className="size-5" />} title={t('fav.title')} />
      {!data?.length ? (
        <EmptyState icon={<Star className="size-5" />} title={t('fav.empty')} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-elevated">
          {data.map((p, i) => (
            <div key={p.id} className={cx('flex items-center gap-3 px-4 py-2', i > 0 && 'border-t border-line')}>
              <button className="flex flex-1 items-center gap-3 text-left text-sm hover:underline" onClick={() => navigate({ name: 'page', id: p.id })}>
                <span>{p.icon ?? '📄'}</span>
                {p.title || t('common.untitled')}
              </button>
              <IconButton label={t('page.unfavorite')} onClick={() => void toggleFavorite(p.id, true)}>
                <Star className="size-4 fill-amber-400 text-amber-400" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
