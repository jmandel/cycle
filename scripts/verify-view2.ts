#!/usr/bin/env bun
// Smoke-test view2: serve dist/, drive headless Chromium through the
// demo -> Open flow, assert the binary-first summary renders, and fail on any
// uncaught console exception. Mirrors verify-viewer-clicks.ts but for view2.

import { join, normalize } from "node:path";

const root = process.cwd();
const port = Number(Bun.env.PORT || "5526");
const cdpPort = Number(Bun.env.CDP_PORT || "9226");
const viewerDir = Bun.env.VIEWER_DIR || "dist";
const pageUrl = `http://localhost:${port}/view2`;

async function serveFile(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const urlPath = decoded === "/view2" || decoded === "/view2.html" ? "/view2.html"
    : decoded === "/" || decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const fsPath = normalize(join(root, viewerDir, urlPath));
  const rootDir = normalize(join(root, viewerDir));
  if (!fsPath.startsWith(rootDir)) return new Response("not found", { status: 404 });
  const file = Bun.file(fsPath);
  if (!(await file.exists())) return new Response("not found", { status: 404 });
  return new Response(file);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitForJson(url: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function connect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e?: any) => void }>();
  const errors: string[] = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "exception");
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      errors.push("console.error: " + (msg.params.args || []).map((a: any) => a.value || a.description || "").join(" "));
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data || ""}`));
    else resolve(msg.result || {});
  };
  const ready = new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error(`cannot connect ${wsUrl}`)); });
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    await ready; const m = { id: ++id, method, params }; ws.send(JSON.stringify(m));
    return new Promise<any>((resolve, reject) => pending.set(m.id, { resolve, reject }));
  };
  return { ws, send, errors };
}

async function evaluate(cdp: ReturnType<typeof connect>, expression: string) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluate failed");
  return result.result.value;
}

async function main() {
  const server = Bun.serve({ port, fetch: (req) => serveFile(new URL(req.url).pathname) });
  const chrome = Bun.spawn([
    Bun.env.CHROMIUM || "chromium", "--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${cdpPort}`, "about:blank",
  ], { stdout: "ignore", stderr: "ignore" });
  let rc = 0;
  try {
    const targets = await waitForJson(`http://127.0.0.1:${cdpPort}/json/list`);
    const target = targets.find((t: any) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!target) throw new Error("no Chromium page target");
    const cdp = connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: pageUrl });
    await evaluate(cdp, `(${async () => { for (let i = 0; i < 80; i++) { if (document.body.innerText.includes("Load synthetic demo")) return true; await new Promise((r) => setTimeout(r, 100)); } throw new Error("landing did not render"); }})()`);

    const loaded = await evaluate(cdp, `(${async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Load synthetic demo"))?.click();
      for (let i = 0; i < 80; i++) {
        const link = [...document.querySelectorAll("input")].map((i) => i.value).find((v) => v.includes("shlink:/")) || "";
        if (link.startsWith("shlink:/")) return { ok: true, link };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ok: false };
    }})()`);
    if (!loaded.ok) throw new Error("demo did not prefill a shlink:/");

    const rendered = await evaluate(cdp, `(${async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open link"))?.click();
      for (let i = 0; i < 120; i++) {
        const t = document.body.innerText;
        if (t.includes("Menstrual summary") && t.includes("Cycle length")) return { ok: true, t };
        if (t.includes("Could not render")) return { ok: false, t };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ok: false, t: document.body.innerText };
    }})()`);
    if (!rendered.ok) throw new Error(`view2 did not render summary:\n${rendered.t?.slice(0, 600)}`);

    // assert the derived, binary-first content is present
    const must = ["complete cycle", "Regularity", "Bleeding duration", "Last period", "Cycle timeline", "Layers in this export", "from bleeding + date"];
    const hay = rendered.t.toLowerCase();
    const missing = must.filter((s) => !hay.includes(s.toLowerCase()));
    if (missing.length) throw new Error(`rendered summary missing: ${missing.join(", ")}`);

    await delay(200);
    if (cdp.errors.length) throw new Error(`console errors during render:\n - ${cdp.errors.join("\n - ")}`);

    if (Bun.env.SHOT) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1040, height: 1600, deviceScaleFactor: 2, mobile: false });
      await delay(150);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await Bun.write(Bun.env.SHOT, Buffer.from(shot.data, "base64"));
      console.log("  [view2] screenshot ->", Bun.env.SHOT);
    }

    console.log("  [view2] OK — demo prefilled shlink:/, Open rendered the binary-first summary");
    console.log("  [view2] present:", must.join(" · "));
    cdp.ws.close();
  } catch (e: any) {
    rc = 1; console.error(e?.stack || e);
  } finally {
    chrome.kill(); server.stop(true);
  }
  console.log(rc === 0 ? "\nVIEW2 VERIFICATION PASSED" : "\nVIEW2 VERIFICATION FAILED");
  return rc;
}

process.exit(await main());
