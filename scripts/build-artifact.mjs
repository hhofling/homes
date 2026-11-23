// Bygger en sida (index.html eller byggprojekt.html) till EN fristående HTML-fil
// med all JavaScript och CSS inbäddad – används för att publicera som Claude-artefakt.
// Användning: node scripts/build-artifact.mjs byggprojekt.html artefakt/byggplaneraren.html
import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const [page = 'index.html', out = `artefakt/${page}`] = process.argv.slice(2);
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const tmp = join(root, 'node_modules/.artefakt-build');
rmSync(tmp, { recursive: true, force: true });

await build({
  root,
  logLevel: 'warn',
  build: {
    outDir: tmp,
    emptyOutDir: true,
    modulePreload: false,
    assetsInlineLimit: 100000000,
    rollupOptions: { input: resolve(root, page), output: { inlineDynamicImports: true } },
  },
});

let html = readFileSync(join(tmp, page), 'utf8');
const read = (src) => readFileSync(join(tmp, src.replace(/^\.?\//, '')), 'utf8');
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => {
  return `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${read(href)}</style>`);
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('Alla filer kunde inte bäddas in');
mkdirSync(dirname(resolve(root, out)), { recursive: true });
writeFileSync(resolve(root, out), html);
rmSync(tmp, { recursive: true, force: true });
console.log(`Skrev ${out} (${Math.round(html.length / 1024)} kB)`);
