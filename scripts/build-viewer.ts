/**
 * build-viewer.ts (bun) — bundle the viewer SPA into the IG's static assets.
 * esbuild bundles React + the render layer + transform + SHL/JWE into one
 * self-contained app.js (no CDN, no runtime transpile) and copies index.html.
 * Output goes to input/images/viewer/, which the IG Publisher copies verbatim
 * to output/viewer/. Run ahead of the publisher:  bun scripts/build-viewer.ts
 */
import * as esbuild from "esbuild";

const root = `${import.meta.dir}/..`;
const outdir = `${root}/input/images/viewer`;

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

await Bun.write(`${outdir}/index.html`, await Bun.file(`${root}/viewer-src/index.html`).text());
console.log("viewer bundled -> input/images/viewer/{app.js,index.html}");
