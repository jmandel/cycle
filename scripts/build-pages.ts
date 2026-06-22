/**
 * build-pages.ts (bun) — build the GitHub Pages copy of the viewer.
 *
 * The HL7 IG Publisher's publication/QA path is wary of custom JavaScript, so
 * the canonical SMART Health Link *viewer prefix* is hosted on GitHub Pages
 * (independent of the IG build), while the IG itself ships the example Bundle,
 * the encrypted file, and docs. This emits a self-contained, single-file
 * viewer.html (the React app inlined — no separate .js) plus the demo data, to
 * `docs/`, which GitHub Pages serves at https://jmandel.github.io/<repo>/ .
 *
 * Run as part of:  bun scripts/build-all.ts
 */
import * as esbuild from "esbuild";

const root = `${import.meta.dir}/..`;
const docs = `${root}/docs`;
const viewerDir = `${root}/input/images/viewer`;

const result = await esbuild.build({
  entryPoints: [`${root}/viewer-src/app.jsx`],
  bundle: true, format: "iife", platform: "browser", target: "es2020",
  minify: true, jsx: "transform",
  loader: { ".mjs": "js", ".js": "js", ".jsx": "jsx" },
  write: false, outfile: "app.js",
});
const appJs = result.outputFiles[0].text;

const viewerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Period Tracking MVP — clinician viewer</title>
  <meta name="description" content="Open a Period Tracking MVP SMART Health Link: decrypts the FHIR Bundle in your browser and renders a menstrual cycle summary. Append #shlink:/... to view any conformant link." />
  <style>html,body{margin:0;padding:0;background:#EEF1F4}</style>
</head>
<body>
  <div id="root"></div>
  <script>${appJs}</script>
</body>
</html>
`;

const landing = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Period Tracking MVP — SMART Health Link viewer</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#15202E}a{color:#2B4A7A}code{background:#EEF1F4;padding:.1em .3em;border-radius:4px}</style>
</head><body>
<h1>Period Tracking MVP — clinician viewer</h1>
<p>This page hosts a privacy-preserving viewer for <b>Period Tracking MVP</b> SMART Health Links. It decrypts the linked FHIR Bundle <b>in your browser</b> and renders a menstrual-cycle summary; the link's encrypted file and key never leave the client unencrypted.</p>
<ul>
<li><a href="viewer.html">Open the worked demo</a> (a synthetic seven-cycle export)</li>
<li>To view any conformant link, append it to the viewer URL: <code>viewer.html#shlink:/...</code></li>
</ul>
<p>Specification and how-to: <a href="https://build.fhir.org/ig/jmandel/periodicity/">Period Tracking MVP Implementation Guide</a>.</p>
</body></html>
`;

await Bun.write(`${docs}/viewer.html`, viewerHtml);
await Bun.write(`${docs}/index.html`, landing);
await Bun.write(`${docs}/example.jwe`, await Bun.file(`${viewerDir}/example.jwe`).text());
await Bun.write(`${docs}/shl.json`, await Bun.file(`${viewerDir}/shl.json`).text());
await Bun.write(`${docs}/.nojekyll`, "");
console.log(`pages built -> docs/{viewer.html (${(viewerHtml.length/1024).toFixed(0)}kb, self-contained), index.html, example.jwe, shl.json, .nojekyll}`);
