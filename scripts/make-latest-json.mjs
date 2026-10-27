// Writes the updater manifest the desktop app polls (latest.json) for a Windows build.
// Usage: node scripts/make-latest-json.mjs <tag> <out-dir> [notes]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [tag, outDir, notes = ''] = process.argv.slice(2);
if (!tag || !outDir) throw new Error('Usage: node scripts/make-latest-json.mjs <tag> <out-dir> [notes]');
const setup = readdirSync(outDir).find((f) => f.endsWith('-setup.exe'));
if (!setup) throw new Error('NSIS installer not found');
const signature = readFileSync(join(outDir, `${setup}.sig`), 'utf8').trim();
const manifest = {
  version: tag.replace(/^v/, ''),
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/Bluetwinklez/noesis/releases/download/${tag}/${encodeURIComponent(setup)}`,
    },
  },
};
writeFileSync(join(outDir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`latest.json → ${manifest.version}`);
