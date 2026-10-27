import { readFileSync, existsSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const tag = process.env.RELEASE_TAG;
if (!tag || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)) throw new Error('Expected a version tag such as v0.1.0');
if ([pkg.version, tauri.version, cargo].some(version => `v${version}` !== tag)) throw new Error('Tag, package, Tauri and Cargo versions must agree');
if (!existsSync(`docs/releases/${tag}.md`)) throw new Error('Release notes are missing');
console.log(`Validated ${tag}: application versions and release notes agree.`);
