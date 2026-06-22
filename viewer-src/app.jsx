import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MenstrualSummary from "./summary.jsx";
import { transformBundle } from "./transform.mjs";
import { prepare } from "./viewmodel.mjs";
import { parseShlink, resolveShl } from "./shl.mjs";

/* The viewer: decrypt a SMART Health Link, transform the FHIR Bundle, render.
   Source resolution order:
     1. a shlink:/ in the page URL hash (or ?shlink=)
     2. the committed demo link ./shl.json (relative url -> works anywhere) */

function Banner({ status, label, n }) {
  return (
    <div className="vb">
      <style>{BANNER_CSS}</style>
      <div className="vb-in">
        <div className="vb-l">
          <span className="vb-dot" data-s={status} />
          <span className="vb-title">Period Tracking MVP · clinician viewer</span>
          <span className="vb-sub">{label || "SMART Health Link"}</span>
        </div>
        <div className="vb-r">
          {status === "ok" ? <span className="vb-pill">decrypted · {n} resources</span> : null}
          <span className="vb-note">Patient-generated data · not clinically attested</span>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    (async () => {
      try {
        const fromHash = parseShlink(location.hash) || parseShlink(new URLSearchParams(location.search).get("shlink"));
        let payload = fromHash, label = null;
        if (!payload) {
          const r = await fetch(new URL("./shl.json", document.baseURI).toString());
          if (!r.ok) throw new Error("no SMART Health Link supplied and ./shl.json is missing");
          payload = await r.json();
        }
        label = payload.label || null;
        const { bundle } = await resolveShl(payload, document.baseURI);
        const vm = transformBundle(bundle, { rangeEnd: "2026-06-21" });
        const data = prepare(vm);
        const n = (bundle.entry || []).length;
        setState({ status: "ok", data, label, n });
      } catch (e) {
        setState({ status: "error", error: String(e?.message || e) });
      }
    })();
  }, []);

  return (
    <div>
      <Banner status={state.status} label={state.label} n={state.n} />
      {state.status === "loading" && <Center>Decrypting SMART Health Link…</Center>}
      {state.status === "error" && <Center><b>Could not render.</b><br />{state.error}</Center>}
      {state.status === "ok" && <MenstrualSummary data={state.data} />}
    </div>
  );
}

const Center = ({ children }) => (
  <div style={{ maxWidth: 1040, margin: "40px auto", padding: 24, fontFamily: "Inter,system-ui,sans-serif", color: "#46566A", textAlign: "center" }}>{children}</div>
);

const BANNER_CSS = `
.vb{background:#15202E;color:#fff;font-family:'Inter',system-ui,sans-serif}
.vb-in{max-width:1040px;margin:0 auto;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.vb-l{display:flex;align-items:center;gap:10px;min-width:0}
.vb-dot{width:9px;height:9px;border-radius:50%;background:#caa94a;flex:none}
.vb-dot[data-s=ok]{background:#4fb477}.vb-dot[data-s=error]{background:#d9534f}
.vb-title{font-weight:600;font-size:13px;white-space:nowrap}
.vb-sub{font-size:12px;color:#9fb0c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb-r{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.vb-pill{font:600 11px 'IBM Plex Mono',monospace;background:rgba(79,180,119,.18);color:#9be3b8;border:1px solid rgba(79,180,119,.4);padding:2px 8px;border-radius:20px}
.vb-note{font-size:11px;color:#7c8898}
`;

createRoot(document.getElementById("root")).render(<App />);
