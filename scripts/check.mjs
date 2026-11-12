import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', '.qa', 'dist', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (/\.(m?js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      count++;
    } else if (/\.html$/.test(entry.name)) {
      const html = await readFile(path, 'utf8');
      if (/\b(?:src|href)=["']\//i.test(html)) throw new Error(`Root-relative asset in ${path}`);
      if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\son\w+=/i.test(html)) throw new Error(`Inline script in ${path}`);
    }
  }
}
await check(root);
console.log(`Syntax checked ${count} JavaScript files; HTML assets use subdirectory-safe paths.`);
