#!/usr/bin/env bun
// Serve the built viewer and drive headless Chromium against chooser, direct
// SHLink resolve, and demo-button paths.

import { mkdirSync } from "node:fs";
import { join, normalize } from "node:path";
import { parseShlink, resolveShl } from "../viewer-src/shl.mjs";

const root = process.cwd();
const port = Number(Bun.env.PORT || "5525");
const viewerDir = Bun.env.VIEWER_DIR || "dist";
const viewerRoot = join(root, viewerDir, "view-assets");
const baseUrl = `http://localhost:${port}/view`;
const shotDir = "/tmp/viewer-verify";

async function serveFile(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const urlPath = decoded === "/view" || decoded === "/view.html"
    ? "/view.html"
    : decoded === "/" || decoded.endsWith("/")
      ? `${decoded}index.html`
      : decoded;
  const fsPath = normalize(join(root, viewerDir, urlPath));
  const rootDir = normalize(join(root, viewerDir));
  if (!fsPath.startsWith(rootDir)) return new Response("not found", { status: 404 });
  const file = Bun.file(fsPath);
  if (!(await file.exists())) return new Response("not found", { status: 404 });
  return new Response(file);
}

async function runChromium(label: string, url: string) {
  const html = `${shotDir}/${label}.html`;
  const png = `${shotDir}/${label}.png`;
  const proc = Bun.spawn([
    Bun.env.CHROMIUM || "chromium",
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--virtual-time-budget=4000",
    "--window-size=1200,1400",
    `--screenshot=${png}`,
    "--dump-dom",
    url,
  ], { stdout: "pipe", stderr: "ignore" });
  const dom = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${label} chromium exited ${code}`);
  await Bun.write(html, dom);
  return dom;
}

async function checkChooser() {
  const dom = await runChromium("chooser", baseUrl);
  for (const text of ["Your name", "Example User", "Link to load", "Paste a SMART Health Link", "Open link", "Load the synthetic demo"]) {
    if (!dom.includes(text)) throw new Error(`[chooser] missing ${text}`);
  }
  console.log(`  [chooser] OK - chooser rendered (${dom.length} bytes DOM)`);
}

async function checkPrefilled() {
  const link = (await Bun.file(join(viewerRoot, "_shlink-local-ig.txt")).text()).trim();
  const dom = await runChromium("shlink", link);
  for (const text of ["Your name", "Example User", "Link to load", "Open link", "shlink:/"]) {
    if (!dom.includes(text)) throw new Error(`[shlink] missing ${text}`);
  }
  if (dom.includes("Menstrual cycle review")) throw new Error("[shlink] rendered before explicit Open");
  console.log(`  [shlink] OK - link prefilled (${dom.length} bytes DOM)`);
}

async function checkResolve() {
  const shlink = (await Bun.file(join(viewerRoot, "_shlink-local.txt")).text()).trim();
  const payload = parseShlink(shlink);
  const { bundle } = await resolveShl(payload, baseUrl, "Example User");
  if (bundle?.resourceType !== "Bundle") throw new Error("resolved payload was not a FHIR Bundle");
  if (!Array.isArray(bundle.entry) || bundle.entry.length < 100) throw new Error("resolved Bundle was unexpectedly small");
  console.log(`  [resolve] OK - decrypted ${bundle.entry.length} resources as Example User`);
}

async function main() {
  mkdirSync(shotDir, { recursive: true });
  await Bun.write(`${shotDir}/.keep`, "");
  const server = Bun.serve({ port, fetch: (req) => serveFile(new URL(req.url).pathname) });
  let rc = 0;
  try {
    console.log("1) chooser:");
    await checkChooser();
    console.log("2) canonical shlink:/ link:");
    await checkPrefilled();
    console.log("3) recipient-aware resolve:");
    await checkResolve();
    console.log("4) demo button and Open link:");
    const proc = Bun.spawn(["bun", "scripts/verify-viewer-clicks.ts"], {
      env: { ...Bun.env, VIEWER_URL: baseUrl },
      stdout: "inherit",
      stderr: "inherit",
    });
    rc = await proc.exited;
  } catch (error: any) {
    rc = 1;
    console.error(error?.stack || error);
  } finally {
    server.stop(true);
  }
  console.log("");
  console.log(rc === 0 ? "VIEWER VERIFICATION PASSED" : "VIEWER VERIFICATION FAILED");
  return rc;
}

process.exit(await main());
