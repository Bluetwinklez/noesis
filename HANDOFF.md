# Noesis — devir notu (başka bilgisayarda devam etmek için)

Tarih: 2026-10-27. Proje klasörü: `C:\Users\dofle\Desktop\desktopp\noesis`

## Durum özeti (2026-10-27, bulut oturumu güncellemesi)
Ayrıntılı ve güncel durum: `docs/implementation-status.md`.

| Alan | Durum |
|---|---|
| Vitest | 51/51 geçti (Linux, Node 22). `node:sqlite` artık `process.getBuiltinModule` ile yükleniyor; jsdom ortamındaki entegrasyon paketi Node 22'de bu yüzden kırılıyordu |
| `cargo test` | 10/10 geçti |
| E2E (Playwright, Chromium) | 10/10 geçti (yeni: markdown yapıştırma) |
| Linux release derlemesi | `Noesis_0.1.0_amd64.deb` üretildi; gerçek masaüstü ikilisi Xvfb altında açıldı, SIGKILL sonrası veri korundu |
| Windows yükleyici | Bu oturumda Windows yok. `.github/workflows/ci.yml` her push'ta `windows-latest` üzerinde imzasız NSIS+MSI ve SHA-256 üretir |
| Dokümanlar, CI, REA raporları | Yazıldı (`README.md`, `docs/`) |
| REA | Kuruldu (Node 24 ile), Noesis paketinin kendisi analiz edildi. Notion/NotebookLM hedefleri ağ politikası nedeniyle engellendi |

## Yeni bilgisayarda kurulum
Gerekenler: Node 24+, Rust (rustup, MSVC), Visual Studio 2022 Build Tools (C++ iş yükü), WebView2 (Win11'de var).
```
npm install
npm test                 # Vitest
npx playwright test      # E2E (Edge kullanır; mock AI sunucusunu kendisi başlatır)
npm run dev              # tarayıcı önizlemesi: http://localhost:1420
npx tauri dev            # masaüstü uygulaması
npx tauri build          # NSIS + MSI yükleyici -> src-tauri/target/release/bundle/
cd src-tauri && cargo test
node scripts/make-fixtures.mjs   # test dosyalarını yeniden üretir
node scripts/mock-ai-server.mjs  # sahte OpenAI-uyumlu sunucu, anahtar: test-key
```
Taşırken `node_modules/`, `dist/`, `src-tauri/target/` kopyalamaya gerek yok.

## Dosya haritası
- `src/core/` — veri katmanı
  - `db/driver.ts` (işlem kuyruğu), `db/migrations.ts` (şema + FTS5), `db/node-driver.ts` (testler), `db/wasm-driver.ts` (tarayıcı önizleme, IndexedDB), `db/tauri-driver.ts` (masaüstü)
  - `repos/` — pages, databases, tasks, research (notebooks/sources/chat/attachments/settings), search-index
  - `backup.ts` (zip yedek, SHA-256 doğrulama, geri yükleme), `formula.ts` (güvenli formül motoru), `doc.ts`
- `src/ai/` — `providers.ts` (OpenAI-uyumlu, Gemini, Anthropic, Ollama; hata eşleme, SSE akış, TTS), `rag.ts` (hibrit arama, alıntı doğrulama, "kaynak yetersiz" cevabı), `assistant.ts` (yazma eylemleri, özet/rehber/SSS/kart/test/ses metni)
- `src/ingestion/` — `pipeline.ts` (İçe aktar→Doğrula→Çıkar→Normalleştir→Parçala→Göm→Dizinle), `extractors.ts` (PDF, DOCX, TXT, MD, HTML, CSV, URL; görsel OCR/ses için AI gerekir; YouTube bilinçli olarak desteklenmiyor), `chunker.ts`
- `src/search/` — `search.ts` (anahtar kelime/tam metin/anlamsal/hibrit), `vectors.ts` (çevrimdışı yerel vektörler)
- `src/editor/` — `Editor.tsx` (Tiptap, slash menü, @bahsetme, sürükle tutamacı, AI balon menüsü), `nodes.tsx` (Callout, PageMention, Bookmark, FileAttachment), `markdown.ts`, `serialize.ts`
- `src/features/` — home, pages (PageView, Notes, Workspace, Favorites, Trash), notebooks (NotebookView, AudioStudio), sources, databases (DatabaseView), tasks, graph, search, settings, onboarding (+ örnek içerik)
- `src/components/` — `ui/` (bileşen kiti), `shell/` (Sidebar, TopBar, CommandPalette, Overlays)
- `src/i18n/` — `en.ts`, `tr.ts`
- `src/app/` — `boot.ts`, `state.ts` (zustand), `services.ts` (sağlayıcı, onay penceresi, hatırlatıcılar)
- `src-tauri/` — `src/lib.rs` (komutlar), `src/db.rs`, `src/files.rs`, `tauri.conf.json`, `capabilities/default.json`, `icons/`
- `tests/` — `unit/`, `integration/`, `e2e/app.spec.ts`, `fixtures/`
- `docs/tasks/agy-tauri-backend.md` — Antigravity'ye verilen görev (kullanılmadı; backend elle yazıldı)

## Sıradaki işler (güncel)
1. CI'nin ilk koşusundan çıkan Windows yükleyicisini temiz bir Windows'a kurup test et (kabul senaryosu 1 ve 15).
2. Gerçek bir AI anahtarıyla elle test.
3. Ağ izni verilirse REA ile Notion/NotebookLM herkese açık sayfalarını yeniden analiz et.

## Eski sıradaki işler (ilk devir)
1. Tüm E2E'yi birlikte tekrar koş (`npx playwright test`).
2. Yükleyiciyi Smart App Control engellemeyen bir makinede derle; kur, aç, kapat-aç ile veri kalıcılığını kontrol et. Yükleyici imzasız olacak.
3. README, `docs/implementation-status.md`, mimari, şema, gizlilik, AI yapılandırma dokümanları, sürüm notları, SHA-256 değerleri.
4. `.github/workflows/` altında Windows CI (npm test, cargo test, tauri build).
5. Gerçek bir AI anahtarıyla elle test (şimdiye kadar sadece mock sunucu kullanıldı).
6. Bilinen eksikler: PDF dışa aktarma sistem yazdırma penceresiyle yapılıyor; otomatik güncelleme yok; bulut eşitleme yok; YouTube transkripti yok; ana JS paketi ~1.4 MB.
