import { cp, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export const publicFiles = ['index.html', 'config.js', 'styles.css', 'app.js', 'auth.js', 'genesys-api.js', 'profiles.js', 'controller.js', 'demo.js', 'i18n.js', 'favicon.svg', '.nojekyll', 'oauth'];
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'dist');
await mkdir(output, { recursive: true });
// Only this known build directory is managed here; never copy credentials, tests or repository metadata.
for (const name of await readdir(output)) {
  if (!publicFiles.includes(name)) throw new Error(`Unexpected build file: ${name}. Review dist before publishing.`);
}
for (const name of publicFiles) await cp(join(root, name), join(output, name), { recursive: true });
console.log(`Static site prepared in ${output}`);
