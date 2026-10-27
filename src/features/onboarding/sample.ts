import type { Repos } from '../../core/store';
import type { DocNode } from '../../core/doc';
import type { IngestionPipeline } from '../../ingestion/pipeline';

const p = (text: string): DocNode => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined });
const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const bullets = (items: string[]): DocNode => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) });
const todos = (items: [string, boolean][]): DocNode => ({
  type: 'taskList',
  content: items.map(([text, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] })),
});

const SAMPLE_SOURCE = {
  en: {
    title: 'The Honeybee Colony — field primer',
    text: `The Honeybee Colony

A honeybee colony typically contains one queen, a few hundred drones and between 20,000 and 60,000 worker bees in summer.

Workers are sterile females. During their first weeks they clean cells, feed larvae and build comb; later they guard the entrance and finally become foragers.

Foragers communicate the direction and distance of food with the waggle dance. The angle of the dance relative to vertical encodes the direction relative to the sun, and the duration of the waggle run encodes distance.

Honey is produced from nectar. Bees add the enzyme invertase and fan their wings to evaporate water until the moisture content falls below about 18 percent.

In winter the colony forms a cluster and keeps the core near 33 °C by shivering flight muscles, consuming stored honey as fuel.`,
  },
  tr: {
    title: 'Bal Arısı Kolonisi — saha notları',
    text: `Bal Arısı Kolonisi

Bir bal arısı kolonisi yazın genellikle bir kraliçe, birkaç yüz erkek arı ve 20.000 ile 60.000 arasında işçi arı içerir.

İşçi arılar kısır dişilerdir. İlk haftalarında hücreleri temizler, larvaları besler ve petek örerler; daha sonra girişi korur ve en sonunda tarlacı olurlar.

Tarlacı arılar besin kaynağının yönünü ve uzaklığını sallanma dansı ile bildirir. Dansın dikeyle yaptığı açı güneşe göre yönü, sallanma süresi ise mesafeyi kodlar.

Bal, nektardan üretilir. Arılar invertaz enzimi ekler ve nem oranı yaklaşık yüzde 18'in altına inene kadar kanat çırparak suyu buharlaştırır.

Kışın koloni bir salkım oluşturur ve uçuş kaslarını titreterek merkezi yaklaşık 33 °C'de tutar; yakıt olarak depoladığı balı tüketir.`,
  },
};

/** Creates a small, realistic starter workspace. Everything is local; no AI is needed. */
export async function seedSampleContent(r: Repos, workspaceId: string, lang: 'en' | 'tr', pipeline: IngestionPipeline) {
  const tr = lang === 'tr';
  const projects = await r.pages.create({ workspaceId, title: tr ? 'Projeler' : 'Projects', icon: '🚀' });
  const tour = await r.pages.create({
    workspaceId,
    title: tr ? 'Noesis turu' : 'Welcome tour',
    icon: '👋',
    content: {
      type: 'doc',
      content: [
        p(tr ? 'Bu sayfa düzenleyiciyi tanıtır. Her şeyi değiştirebilirsin.' : 'This page shows the editor. Change anything you like.'),
        h(2, tr ? 'Bloklar' : 'Blocks'),
        bullets(
          tr
            ? ["Yeni blok eklemek için '/' yaz", 'Bir sayfaya bağlantı için @ yaz', 'Blokları soldaki tutamaçla sürükle', 'Metni seçip AI menüsünü kullan']
            : ["Type '/' to insert any block", 'Type @ to link another page', 'Drag blocks with the handle on the left', 'Select text to use the AI menu'],
        ),
        h(2, tr ? 'Yapılacaklar' : 'To-do'),
        todos([
          [tr ? 'Bir sayfa oluştur' : 'Create a page', true],
          [tr ? 'Bir PDF içe aktar ve deftere ekle' : 'Import a PDF and add it to a notebook', false],
          [tr ? 'Kaynaklara dayalı bir soru sor' : 'Ask a source-grounded question', false],
        ]),
        { type: 'callout', attrs: { tone: 'info' }, content: [p(tr ? 'Notların yalnızca bu bilgisayarda saklanır.' : 'Your notes are stored only on this computer.')] },
        { type: 'blockMath', attrs: { latex: 'e^{i\\pi} + 1 = 0' } },
      ],
    },
  });
  await r.pages.create({
    workspaceId,
    parentId: projects.id,
    title: tr ? 'Tez planı' : 'Thesis plan',
    icon: '🎓',
    content: {
      type: 'doc',
      content: [
        p(''),
        { type: 'paragraph', content: [{ type: 'text', text: tr ? 'İlgili: ' : 'Related: ' }, { type: 'pageMention', attrs: { id: tour.id, label: tour.title } }] },
        h(2, tr ? 'Hedefler' : 'Goals'),
        bullets(tr ? ['Literatür taraması', 'Yöntem seçimi', 'İlk taslak'] : ['Literature review', 'Choose methods', 'First draft']),
      ],
    },
  });
  await r.pages.addTag(tour.id, tr ? 'başlangıç' : 'getting-started', 'violet');

  const db = await r.databases.createDatabase(workspaceId, tr ? 'Okuma listesi' : 'Reading list', projects.id);
  const props = await r.databases.properties(db.id);
  const title = props.find((x) => x.type === 'title')!;
  const status = props.find((x) => x.type === 'status')!;
  const author = await r.databases.addProperty(db.id, tr ? 'Yazar' : 'Author', 'text');
  const pages = await r.databases.addProperty(db.id, tr ? 'Sayfa' : 'Pages', 'number');
  const due = await r.databases.addProperty(db.id, tr ? 'Tarih' : 'Date', 'date');
  const today = new Date();
  const iso = (d: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + d).toISOString().slice(0, 10);
  await r.databases.addRow(db.id, { [title.id]: 'The Structure of Scientific Revolutions', [author.id]: 'Thomas Kuhn', [pages.id]: 264, [status.id]: 'in_progress', [due.id]: iso(3) });
  await r.databases.addRow(db.id, { [title.id]: 'Thinking, Fast and Slow', [author.id]: 'Daniel Kahneman', [pages.id]: 499, [status.id]: 'not_started', [due.id]: iso(10) });
  await r.databases.addRow(db.id, { [title.id]: 'Kürk Mantolu Madonna', [author.id]: 'Sabahattin Ali', [pages.id]: 160, [status.id]: 'done', [due.id]: iso(-4) });
  await r.databases.addView(db.id, tr ? 'Pano' : 'Board', 'board', { groupBy: status.id });
  await r.databases.addView(db.id, tr ? 'Takvim' : 'Calendar', 'calendar', { dateProperty: due.id });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const t1 = await r.tasks.create({ workspaceId, title: tr ? 'Literatür taramasını bitir' : 'Finish literature review', priority: 3, dueAt: tomorrow.getTime(), projectPageId: projects.id });
  await r.tasks.create({ workspaceId, title: tr ? '5 makale seç' : 'Pick 5 papers', parentId: t1.id });
  await r.tasks.create({ workspaceId, title: tr ? 'Haftalık gözden geçirme' : 'Weekly review', recurrence: 'weekly', dueAt: tomorrow.getTime() + 3 * 86400000 });

  const nb = await r.notebooks.create(workspaceId, tr ? 'Arıcılık araştırması' : 'Beekeeping research', tr ? 'Örnek defter' : 'Sample notebook');
  const sample = SAMPLE_SOURCE[lang];
  const src = await pipeline.importText(workspaceId, sample.title, sample.text);
  await pipeline.process(src.id);
  await r.notebooks.addSource(nb.id, src.id);
  return { tour, notebook: nb };
}
