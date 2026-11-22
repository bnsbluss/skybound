#!/usr/bin/env node
/**
 * Builds SKYBOUND.html — a single self-contained file with the bundled CSS and
 * JavaScript inlined. Handy on Android: no server, no folder structure, just
 * copy one HTML file to the device and open it with any browser.
 *
 *   node scripts/build-standalone.mjs
 *
 * Run `npm run build` first (or use `npm run build:all`).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  template: resolve(root, 'index.html'),
  css: resolve(root, 'dist/game.css'),
  js: resolve(root, 'dist/game.js'),
  out: resolve(root, 'SKYBOUND.html'),
};

const stripSourceMap = (source) =>
  source
    .replace(/\/\*[#@]\s*sourceMappingURL=[^*]*\*\//g, '')
    .replace(/\/\/[#@]\s*sourceMappingURL=\S*/g, '')
    .trim();

function escapeForScript(source) {
  // `</script>` inside a JS string would close the inline element early.
  // `<\/script>` is the same string at runtime and safe for the HTML parser.
  return source.replace(/<\/script/gi, '<\\/script');
}

function escapeForStyle(source) {
  return source.replace(/<\/style/gi, '<\\/style');
}

const [template, rawCss, rawJs] = await Promise.all([
  readFile(paths.template, 'utf8'),
  readFile(paths.css, 'utf8'),
  readFile(paths.js, 'utf8'),
]);

const css = escapeForStyle(stripSourceMap(rawCss));
const js = escapeForScript(stripSourceMap(rawJs));

if (js.includes('<!--')) {
  console.warn('warning: bundle contains "<!--"; HTML script parsing may be affected.');
}

const styleTag = `<style>\n${css}\n</style>`;
const scriptTag = `<script>\n${js}\n</script>`;

let html = template;
const linkPattern = /<link\b[^>]*href="dist\/game\.css"[^>]*>\s*/i;
const scriptPattern = /<script\b[^>]*src="dist\/game\.js"[^>]*>\s*<\/script>\s*/i;

if (!linkPattern.test(html)) throw new Error('index.html does not reference dist/game.css');
if (!scriptPattern.test(html)) throw new Error('index.html does not reference dist/game.js');

// Replacement *functions* keep `$&`, `$'`, `` $` `` and `$$` inside the
// minified bundle literal; string replacements would expand them.
html = html.replace(linkPattern, () => `${styleTag}\n`);
html = html.replace(scriptPattern, () => `${scriptTag}\n`);

// Self-check: the inlined payloads must appear byte-for-byte. A plain string
// replacement would expand `$&` / `$'` inside the minified bundle and silently
// inject the original <script src> tag into the middle of the JS.
if (!html.includes(styleTag)) throw new Error('standalone CSS inline was corrupted');
if (!html.includes(scriptTag)) throw new Error('standalone JS inline was corrupted');
if (html.includes('src="dist/game.js"')) throw new Error('standalone still references dist/game.js');
if (html.includes('href="dist/game.css"')) throw new Error('standalone still references dist/game.css');

await writeFile(paths.out, html, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`SKYBOUND.html written — ${kb(Buffer.byteLength(html))} (css ${kb(css.length)}, js ${kb(js.length)})`);
