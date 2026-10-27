// Copies the offline OCR engine and language data into public/ocr so the app never
// fetches them from a CDN. Runs before `dev` and `build`.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const out = 'public/ocr';
mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/tur/4.0.0_best_int/tur.traineddata.gz', 'tur.traineddata.gz'],
];
for (const [from, to] of files) {
  const dest = join(out, to);
  if (existsSync(dest) && statSync(dest).size === statSync(from).size) continue;
  copyFileSync(from, dest);
}
console.log('OCR assets ready in public/ocr');
