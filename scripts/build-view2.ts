/**
 * build-view2.ts (bun) — bundle view2 (the fresh, binary-first viewer) into a
 * self-contained SPA, parallel to build-viewer.ts and without touching it.
 * Reuses the existing data layer (transform.mjs / shl.mjs / jwe.mjs) via imports.
 *
 * Output defaults to dist/view2.html + dist/view2-assets/. To share the demo
 * SHL assets produced by gen-shl.ts (dist/view-assets/{example.jwe,shlink.txt}),
 * this copies them next to view2's app.js when present.
 */
import { mkdir, rm, copyFile, access } from "node:fs/promises";
import { dirname, relative } from "node:path";
import * as esbuild from "esbuild";

const root = `${import.meta.dir}/..`;
const outdir = Bun.env.VIEW2_OUTDIR || `${root}/dist/view2-assets`;
const pageOut = Bun.env.VIEW2_PAGE_OUT || `${root}/dist/view2.html`;
await rm(outdir, { recursive: true, force: true });
await rm(pageOut, { force: true });
await mkdir(outdir, { recursive: true });
await mkdir(dirname(pageOut), { recursive: true });

await esbuild.build({
  entryPoints: [`${root}/viewer-src/view2/app2.jsx`],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  sourcemap: false,
  jsx: "transform",
  loader: { ".mjs": "js", ".js": "js", ".jsx": "jsx" },
  outfile: `${outdir}/app.js`,
  logLevel: "info",
});

const template = await Bun.file(`${root}/viewer-src/view2/index.html`).text();
const scriptSrc = relative(dirname(pageOut), `${outdir}/app.js`).replaceAll("\\", "/");
await Bun.write(pageOut, template.replace('src="app.js"', `src="${scriptSrc}"`));
await Bun.write(`${outdir}/index.html`, template);

// Reuse the demo SHL assets if a prior gen-shl.ts run produced them.
for (const name of ["example.jwe", "shlink.txt"]) {
  const src = `${root}/dist/view-assets/${name}`;
  try { await access(src); await copyFile(src, `${outdir}/${name}`); }
  catch { /* demo assets not built yet; the "Load synthetic demo" button will report it */ }
}

console.log(`view2 bundled -> ${pageOut} + ${outdir}/{app.js,index.html}`);
