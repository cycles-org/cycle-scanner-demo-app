import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

// Copy FintaChart runtime asset folders into /public BEFORE Vite starts its dev
// middleware, so the library can fetch them via plain HTTP at /vendor/fintachart/...
// This MUST run synchronously at config load time — a buildStart() hook fires too
// late: Vite's static-file middleware initializes its publicDir scan before the
// rollup build hooks fire, so requests on first page load race the copy and 404.
function copyDirRecursive(s, d) {
  mkdirSync(d, { recursive: true });
  for (const entry of readdirSync(s)) {
    const sp = path.join(s, entry);
    const dp = path.join(d, entry);
    if (statSync(sp).isDirectory()) copyDirRecursive(sp, dp);
    else copyFileSync(sp, dp);
  }
}

const FC_SRC = path.resolve('node_modules/@fintatech/fintachart');
const FC_DST = path.resolve('public/vendor/fintachart');
if (existsSync(FC_SRC)) {
  for (const f of ['localization', 'htmldialogs', 'img', 'css', 'scripts', 'fonts']) {
    const src = path.join(FC_SRC, f);
    if (existsSync(src)) copyDirRecursive(src, path.join(FC_DST, f));
  }
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, open: true },
});
