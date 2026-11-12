import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
export function serve(port = 4173) {
  return createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const prefix = '/Genesys_Cloud-Custom-Queue-Activation';
      if (pathname === prefix) { res.writeHead(302, { Location: `${prefix}/` }); res.end(); return; }
      if (pathname.startsWith(`${prefix}/`)) pathname = pathname.slice(prefix.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const path = resolve(root, `.${pathname}`);
      if (!path.startsWith(root + sep) || /(?:^|[\\/])\./.test(pathname) || !types[extname(path)]) throw new Error('Not public');
      const content = await readFile(path);
      res.writeHead(200, { 'Content-Type': types[extname(path)], 'Cache-Control': 'no-store' });
      res.end(content);
    } catch { res.writeHead(404); res.end('Not found'); }
  }).listen(port, '127.0.0.1');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  serve(Number(process.env.PORT || 4173));
  console.log(`Local: http://127.0.0.1:${process.env.PORT || 4173}/Genesys_Cloud-Custom-Queue-Activation/?demo=1`);
}
