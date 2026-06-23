#!/usr/bin/env bun
// Drive the built viewer through the real demo-button and Open-button path.
// This intentionally uses Chromium's DevTools Protocol directly so the IG repo
// does not need a Playwright/Puppeteer dependency just for this smoke check.

const chrome = Bun.env.CHROMIUM || "chromium";
const port = Number(Bun.env.CDP_PORT || "9225");
const viewerUrl = Bun.env.VIEWER_URL || "http://localhost:5525/viewer/";

const proc = Bun.spawn([
  chrome,
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  `--remote-debugging-port=${port}`,
  "about:blank",
], { stdout: "ignore", stderr: "pipe" });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      // Chromium is still starting.
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data || ""}`));
    else resolve(msg.result || {});
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`could not connect to ${wsUrl}`));
  });
  const send = async (method, params = {}) => {
    await ready;
    const msg = { id: ++id, method, params };
    ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => pending.set(msg.id, { resolve, reject }));
  };
  return { ws, send };
}

async function main() {
  try {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!target) throw new Error("no Chromium page target was available");
    const cdp = connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: viewerUrl });
    await evaluate(cdp, waitForExpression("document.body.innerText.includes('Load the synthetic demo')"));

    const loaded = await evaluate(cdp, `(${async () => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Load the synthetic demo"));
      if (!button) throw new Error("demo button not found");
      button.click();
      const ok = await new Promise((resolve) => {
        let tries = 0;
        const tick = () => {
          const link = [...document.querySelectorAll("input")].map((i) => i.value).find((v) => v.includes("shlink:/")) || "";
          if (link.startsWith("shlink:/")) resolve({ ok: true, link, text: document.body.innerText });
          else if (++tries > 80) resolve({ ok: false, link, text: document.body.innerText });
          else setTimeout(tick, 100);
        };
        tick();
      });
      return ok;
    }})()`);
    if (!loaded.ok) throw new Error("demo button did not populate a raw shlink:/ value");
    if (loaded.text.includes("Could not render")) throw new Error("demo button caused an error state");

    const rendered = await evaluate(cdp, `(${async () => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Open link"));
      if (!button) throw new Error("Open link button not found");
      button.click();
      return await new Promise((resolve) => {
        let tries = 0;
        const tick = () => {
          const text = document.body.innerText;
          if (text.includes("Menstrual cycle review")) resolve({ ok: true, text });
          else if (text.includes("Could not render")) resolve({ ok: false, text });
          else if (++tries > 120) resolve({ ok: false, text });
          else setTimeout(tick, 100);
        };
        tick();
      });
    }})()`);
    if (!rendered.ok) throw new Error(`Open link did not render summary:\n${rendered.text}`);

    console.log("  [demo-click] OK — demo button prefilled shlink:/ and Open rendered the summary");
    cdp.ws.close();
  } finally {
    proc.kill();
  }
}

function waitForExpression(expression) {
  return `(${async (expr) => {
    return await new Promise((resolve) => {
      let tries = 0;
      const tick = () => {
        if (eval(expr)) resolve(true);
        else if (++tries > 80) resolve(false);
        else setTimeout(tick, 100);
      };
      tick();
    });
  }})(${JSON.stringify(expression)})`;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed";
    throw new Error(text);
  }
  return result.result.value;
}

main().catch((e) => {
  proc.kill();
  console.error(e?.stack || e);
  process.exit(1);
});
