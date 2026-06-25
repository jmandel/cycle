/**
 * build-viewer.ts (bun) — bundle the viewer SPA for local/deploy use.
 * esbuild bundles React + the render layer + transform + SHL/JWE into one
 * self-contained app.js (no CDN, no runtime transpile), writes a root
 * view.html launch page, and keeps runtime assets in view-assets/.
 * Output defaults to dist/view.html + dist/view-assets; deploy workflows can
 * set VIEWER_PAGE_OUT and VIEWER_OUTDIR.
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, relative } from "node:path";
import * as esbuild from "esbuild";

const root = `${import.meta.dir}/..`;
const outdir = Bun.env.VIEWER_OUTDIR || `${root}/dist/view-assets`;
const pageOut = Bun.env.VIEWER_PAGE_OUT || `${root}/dist/view.html`;
await rm(outdir, { recursive: true, force: true });
await rm(pageOut, { force: true });
if (!Bun.env.VIEWER_OUTDIR) await rm(`${root}/dist/view`, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await mkdir(dirname(pageOut), { recursive: true });

await esbuild.build({
  entryPoints: [`${root}/viewer-src/app.jsx`],
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

const template = await Bun.file(`${root}/viewer-src/index.html`).text();
const scriptSrc = relative(dirname(pageOut), `${outdir}/app.js`).replaceAll("\\", "/");
await Bun.write(pageOut, template.replace('src="app.js"', `src="${scriptSrc}"`));

// A co-located asset index is useful for local debugging, but the public launch
// page is view.html so extensionless /view can work without a /view/ directory.
await Bun.write(`${outdir}/index.html`, template);
console.log(`viewer bundled -> ${pageOut} + ${outdir}/{app.js,index.html}`);
