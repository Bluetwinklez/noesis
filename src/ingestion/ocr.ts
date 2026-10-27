/**
 * Offline OCR with Tesseract (WebAssembly). Engine and English/Turkish models are
 * shipped with the app (public/ocr), so recognising images and scanned PDFs needs
 * no network and no AI provider. Browser/WebView only.
 */
import type { PageText } from './chunker';

type TesseractWorker = { recognize(image: Blob | HTMLCanvasElement): Promise<{ data: { text: string; confidence: number } }>; terminate(): Promise<unknown> };

const BASE = `${import.meta.env.BASE_URL ?? '/'}ocr/`;
let workerPromise: Promise<TesseractWorker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function worker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const abs = (f: string) => new URL(BASE + f, location.href).href;
      return (await createWorker(['eng', 'tur'], OEM.LSTM_ONLY, {
        workerPath: abs('worker.min.js'),
        corePath: abs('tesseract-core-simd-lstm.wasm.js'),
        langPath: abs('').replace(/\/$/, ''),
        gzip: true,
        cacheMethod: 'none',
        workerBlobURL: false,
      })) as unknown as TesseractWorker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  // The engine holds ~100 MB; release it after a minute without work.
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const w = workerPromise;
    workerPromise = null;
    void w?.then((x) => x.terminate());
  }, 60_000);
  return workerPromise;
}

export const ocrAvailable = () => typeof Worker !== 'undefined' && typeof document !== 'undefined';

export async function ocrImage(image: Blob | HTMLCanvasElement, signal?: AbortSignal): Promise<{ text: string; confidence: number }> {
  const w = await worker();
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const { data } = await w.recognize(image);
  return { text: data.text.replace(/[ \t]+\n/g, '\n').trim(), confidence: data.confidence };
}

/** Renders each PDF page (≈200 dpi) and runs OCR on it — for scanned documents without a text layer. */
export async function ocrPdf(
  bytes: Uint8Array,
  loadPdfJs: () => Promise<{ getDocument(src: unknown): { promise: Promise<PdfDoc> } }>,
  signal?: AbortSignal,
  onPage?: (page: number, total: number) => void,
): Promise<PageText[]> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const pages: PageText[] = [];
  const total = Math.min(doc.numPages, 300);
  for (let i = 1; i <= total; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    onPage?.(i, total);
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 200 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
    const { text } = await ocrImage(canvas, signal);
    pages.push({ pageNumber: i, text });
    canvas.width = canvas.height = 0;
    page.cleanup?.();
  }
  await doc.destroy?.();
  return pages;
}

interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: unknown): { promise: Promise<void> };
  cleanup?(): void;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy?(): Promise<void>;
}
