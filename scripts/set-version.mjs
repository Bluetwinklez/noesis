// Stamps one version into package.json, package-lock.json, tauri.conf.json, Cargo.toml and Cargo.lock.
// Used by CI for continuous builds: `node scripts/set-version.mjs 0.1.42`.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Usage: node scripts/set-version.mjs <major.minor.patch>');

const json = (path, edit) => {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};
json('package.json', (p) => (p.version = version));
json('package-lock.json', (l) => {
  l.version = version;
  if (l.packages?.['']) l.packages[''].version = version;
});
json('src-tauri/tauri.conf.json', (t) => (t.version = version));

const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
writeFileSync('src-tauri/Cargo.toml', cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`));
const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8');
writeFileSync('src-tauri/Cargo.lock', cargoLock.replace(/(\[\[package\]\]\nname = "noesis"\nversion = )"[^"]+"/, `$1"${version}"`));

console.log(`Version set to ${version}`);
