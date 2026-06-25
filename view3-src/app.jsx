import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { transformBundle } from "../viewer-src/transform.mjs";
import { prepare } from "../viewer-src/viewmodel.mjs";
import { DEFAULT_RECIPIENT, extractShlinkURI, parseShlink, resolveShl, shlinkFromPayload } from "../viewer-src/shl.mjs";

const DAY_MS = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY_MS);
const fmt = (s) => {
  if (!s) return "unknown";
  const d = toDate(s);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const rangeText = (values, unit = "d") => values.length ? `${Math.min(...values)}-${Math.max(...values)} ${unit}` : "not enough data";

function assetUrl(name) {
  const script = [...document.scripts].reverse().find((s) => /\/app\.js($|\?)/.test(s.src || ""));
  return new URL(name, script?.src ? new URL("./", script.src).toString() : document.baseURI).toString();
}

function setURLFragment(shlinkURI) {
  if (!shlinkURI || window.location.hash === `#${shlinkURI}`) return;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = shlinkURI;
  window.history.replaceState({}, "", url.toString());
}

function normalizeDemoLink(link) {
  const payload = parseShlink(link);
  if (!payload) throw new Error("demo shlink.txt did not contain shlink:/");
  payload.url = assetUrl("example.jwe");
  return shlinkFromPayload(payload);
}

function App() {
  const [state, setState] = useState({ status: "choose" });
  const [draftLink, setDraftLink] = useState("");
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT);

  useEffect(() => {
    const shlinkURI = extractShlinkURI(location.hash);
    if (shlinkURI) {
      setURLFragment(shlinkURI);
      setDraftLink(shlinkURI);
    }
  }, []);

  async function openText(text) {
    const shlinkURI = extractShlinkURI(text);
    if (!shlinkURI) {
      setState({ status: "choose", msg: "Paste a SMART Health Link or a viewer URL containing shlink:/." });
      return;
    }
    try {
      setState({ status: "loading" });
      setURLFragment(shlinkURI);
      const payload = parseShlink(shlinkURI);
      const { bundle } = await resolveShl(payload, document.baseURI, recipient.trim() || DEFAULT_RECIPIENT);
      const transformed = transformBundle(bundle);
      setState({
        status: "ok",
        bundle,
        data: prepare(transformed),
        label: payload.label || null,
        resources: (bundle.entry || []).length,
      });
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error) });
    }
  }

  async function loadDemo() {
    try {
      const response = await fetch(assetUrl("shlink.txt"));
      if (!response.ok) throw new Error("demo link is not available next to this viewer");
      const link = normalizeDemoLink(await response.text());
      setDraftLink(link);
      setState({ status: "choose", msg: "Synthetic demo link loaded. Open it when ready." });
    } catch (error) {
      setState({ status: "error", error: String(error?.message || error) });
    }
  }

  if (state.status === "ok") return <LayerZeroViewer state={state} onBack={() => setState({ status: "choose" })} />;

  return (
    <main className="v3">
      <style>{CSS}</style>
      <section className="launch">
        <div className="brand">Period Tracking MVP</div>
        <h1>Bleeding-first clinical summary</h1>
        <p>
          Starts from the universal core: calendar day plus menstrual bleeding yes/no.
          Optional facts are shown after the bleeding-derived clinical picture is clear.
        </p>
        <div className="launch-grid">
          <label>
            <span>Recipient name</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={DEFAULT_RECIPIENT} />
          </label>
          <label className="wide">
            <span>SMART Health Link</span>
            <input value={draftLink} onChange={(e) => setDraftLink(e.target.value)} placeholder="shlink:/... or a viewer-prefixed URL" spellCheck={false} />
          </label>
        </div>
        {state.msg ? <div className="notice">{state.msg}</div> : null}
        {state.status === "error" ? <div className="error">{state.error}</div> : null}
        {state.status === "loading" ? <div className="notice">Decrypting and deriving the Layer 0 summary...</div> : null}
        <div className="launch-actions">
          <button className="primary" disabled={!draftLink.trim() || state.status === "loading"} onClick={() => openText(draftLink)}>Open link</button>
          <button onClick={loadDemo} disabled={state.status === "loading"}>Load the synthetic demo</button>
          <a href="view.html">Open original viewer</a>
          <a href="view2.html">Open view2</a>
        </div>
      </section>
    </main>
  );
}

function LayerZeroViewer({ state, onBack }) {
  const model = useMemo(() => deriveLayerZero(state.data, state.bundle), [state.data, state.bundle]);
  return (
    <main className="v3">
      <style>{CSS}</style>
      <header className="topbar">
        <div>
          <div className="brand">Period Tracking MVP</div>
          <h1>Bleeding-first clinical summary</h1>
        </div>
        <div className="top-actions">
          <span>{state.resources} FHIR resources</span>
          <button onClick={onBack}>Open another link</button>
        </div>
      </header>

      <section className="identity">
        <Info label="Patient" value={model.patient.name || "not supplied"} sub={model.patient.birthDate ? `DOB ${model.patient.birthDate}` : "anonymous or not included"} />
        <Info label="Source" value={model.source} sub={state.label || "patient-generated tracking export"} />
        <Info label="Range" value={`${fmt(model.start)} - ${fmt(model.end)}`} sub={`${model.totalDays} calendar days`} />
        <Info label="Layer 0 coverage" value={`${model.coveragePct}%`} sub={`${model.knownBleedingDays} days explicit yes/no; ${model.missingDays} missing`} />
      </section>

      <section className="hero-grid">
        <Metric label="Latest bleeding episode" value={model.latestEpisode ? fmt(model.latestEpisode.start) : "none"} sub={model.latestEpisode ? `${model.latestEpisode.days} bleeding days, ended ${fmt(model.latestEpisode.end)}` : "No bleeding=true facts"} />
        <Metric label="Cycle interval" value={model.intervalMedian != null ? `${Math.round(model.intervalMedian)} d` : "insufficient"} sub={rangeText(model.intervals)} />
        <Metric label="Bleeding duration" value={model.durationMedian != null ? `${Math.round(model.durationMedian)} d` : "insufficient"} sub={rangeText(model.durations)} />
        <Metric label="Current status" value={model.current.label} sub={model.current.detail} />
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Bleeding pattern summary</h2>
            <p>Derived from dated menstrual-bleeding booleans and missingness.</p>
          </div>
        </div>
        <ul className="inferences">
          {model.inferences.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Calendar truth table</h2>
            <p>Bleeding, explicit no bleeding, and missing are separate states.</p>
          </div>
          <Legend />
        </div>
        <Calendar model={model} />
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Bleeding episodes</h2>
              <p>Contiguous calendar runs of bleeding=true.</p>
            </div>
          </div>
          <EpisodeTable episodes={model.episodes} />
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <h2>Review cues</h2>
              <p>Configurable prompts, not clinical diagnoses.</p>
            </div>
          </div>
          <CueList cues={model.cues} />
        </section>
      </div>

      <section className="panel muted-panel">
        <div className="section-head">
          <div>
            <h2>Layer 1 overlays</h2>
            <p>Optional facts enrich the timeline but do not replace the bleeding boolean core.</p>
          </div>
        </div>
        <div className="overlay-grid">
          <Metric label="Flow facts" value={model.overlays.flowDays} sub={`${model.overlays.heavyDays} heavy-rated days`} />
          <Metric label="Pain facts" value={model.overlays.painDays} sub={`peak ${model.overlays.peakPain}/10`} />
          <Metric label="Symptom facts" value={model.overlays.symptomDays} sub={model.overlays.topSymptoms || "none recognized"} />
          <Metric label="Temperature facts" value={model.overlays.temperatureDays} sub="basal/body temperature layer" />
        </div>
      </section>
    </main>
  );
}

function deriveLayerZero(data, bundle) {
  const patient = patientSummary(bundle);
  const daily = data.daily || [];
  const byDate = data.byDate || Object.fromEntries(daily.map((d) => [d.date, d]));
  const start = data.ctx?.spanStart || daily[0]?.date;
  const end = data.ctx?.today || daily[daily.length - 1]?.date || start;
  const totalDays = start && end ? diffDays(start, end) + 1 : daily.length;
  const knownBleedingDays = daily.filter((d) => d.bleeding === true || d.bleeding === false).length;
  const missingDays = Math.max(0, totalDays - knownBleedingDays);
  const coveragePct = totalDays ? Math.round((knownBleedingDays / totalDays) * 100) : 0;
  const bleedingDays = daily.filter((d) => d.bleeding === true).length;
  const noBleedingDays = daily.filter((d) => d.bleeding === false).length;
  const episodes = buildEpisodes(start, end, byDate);
  const intervals = episodes.slice(1).map((e, i) => diffDays(episodes[i].start, e.start));
  const durations = episodes.map((e) => e.days);
  const latestEpisode = episodes[episodes.length - 1] || null;
  const durationMedian = median(durations);
  const intervalMedian = median(intervals);
  const current = currentStatus(end, byDate);
  const source = data.ctx?.sourceApp || "tracking app";
  const cues = reviewCues({ episodes, intervals, durations, missingDays, totalDays, coveragePct });
  const overlays = overlaySummary(daily);
  const inferences = [
    `${episodes.length} bleeding episode${episodes.length === 1 ? "" : "s"} can be identified from ${bleedingDays} bleeding=true day${bleedingDays === 1 ? "" : "s"}.`,
    intervalMedian != null ? `Start-to-start cycle interval is about ${Math.round(intervalMedian)} days (${rangeText(intervals)} across ${intervals.length} interval${intervals.length === 1 ? "" : "s"}).` : "Cycle interval cannot be estimated until at least two bleeding episodes are present.",
    durationMedian != null ? `Typical bleeding duration is about ${Math.round(durationMedian)} days (${rangeText(durations)}).` : "Bleeding duration cannot be estimated without bleeding=true days.",
    missingDays ? `${missingDays} calendar day${missingDays === 1 ? "" : "s"} are missing, so absence of bleeding cannot be assumed on those days.` : "Every calendar day in range has an explicit bleeding yes/no state.",
    current.label === "Unknown" ? "Current bleeding status is unknown because the range ends without an explicit yes/no fact." : `At the end of the shared range, status is: ${current.label.toLowerCase()}.`,
  ];

  return {
    patient, daily, byDate, start, end, totalDays, knownBleedingDays, missingDays,
    coveragePct, bleedingDays, noBleedingDays, episodes, intervals, durations,
    latestEpisode, durationMedian, intervalMedian, current, source, cues, overlays,
    inferences,
  };
}

function buildEpisodes(start, end, byDate) {
  if (!start || !end) return [];
  const episodes = [];
  let active = null;
  for (let date = start; diffDays(date, end) >= 0; date = addDays(date, 1)) {
    const rec = byDate[date];
    if (rec?.bleeding === true) {
      if (!active) active = { start: date, end: date, days: 0 };
      active.end = date;
      active.days += 1;
    } else if (active) {
      episodes.push(active);
      active = null;
    }
  }
  if (active) episodes.push(active);
  return episodes.map((e, i) => ({ ...e, index: i + 1, interval: i ? diffDays(episodes[i - 1].start, e.start) : null }));
}

function currentStatus(end, byDate) {
  const rec = byDate[end];
  if (rec?.bleeding === true) return { label: "Bleeding", detail: `bleeding=true on ${fmt(end)}` };
  if (rec?.bleeding === false) return { label: "Not bleeding", detail: `bleeding=false on ${fmt(end)}` };
  return { label: "Unknown", detail: `no explicit bleeding state on ${fmt(end)}` };
}

function reviewCues({ episodes, intervals, durations, missingDays, totalDays, coveragePct }) {
  const cues = [];
  const prolonged = episodes.filter((e) => e.days > 8);
  const shortIntervals = intervals.filter((d) => d < 21);
  const longIntervals = intervals.filter((d) => d > 45);
  const variation = intervals.length ? Math.max(...intervals) - Math.min(...intervals) : null;
  const isolated = episodes.filter((e) => e.days === 1);
  if (prolonged.length) cues.push(`${prolonged.length} episode${prolonged.length === 1 ? "" : "s"} longer than 8 bleeding days.`);
  if (shortIntervals.length) cues.push(`${shortIntervals.length} start-to-start interval${shortIntervals.length === 1 ? "" : "s"} shorter than 21 days.`);
  if (longIntervals.length) cues.push(`${longIntervals.length} start-to-start interval${longIntervals.length === 1 ? "" : "s"} longer than 45 days.`);
  if (variation != null && variation >= 10) cues.push(`Cycle interval range varies by ${variation} days.`);
  if (isolated.length) cues.push(`${isolated.length} one-day bleeding episode${isolated.length === 1 ? "" : "s"} may deserve context review.`);
  if (totalDays && coveragePct < 80) cues.push(`Layer 0 coverage is ${coveragePct}%; missing days limit interpretation.`);
  if (missingDays && missingDays / Math.max(totalDays, 1) > 0.1) cues.push(`${missingDays} days are missing; do not treat them as no bleeding.`);
  return cues.length ? cues : ["No review cues from Layer 0 thresholds in this shared range."];
}

function overlaySummary(daily) {
  const symptoms = new Map();
  for (const d of daily) {
    for (const key of Object.keys(d.symptoms || {})) symptoms.set(key, (symptoms.get(key) || 0) + 1);
  }
  const topSymptoms = [...symptoms.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, n]) => `${labelize(key)} ${n}`)
    .join(", ");
  return {
    flowDays: daily.filter((d) => d.flow != null).length,
    heavyDays: daily.filter((d) => d.flow === 4).length,
    painDays: daily.filter((d) => d.pain > 0).length,
    peakPain: Math.max(0, ...daily.map((d) => d.pain || 0)),
    symptomDays: daily.filter((d) => d.symptoms && Object.keys(d.symptoms).length).length,
    topSymptoms,
    temperatureDays: daily.filter((d) => d.bbt != null).length,
  };
}

function patientSummary(bundle) {
  const patient = (bundle?.entry || []).map((e) => e.resource).find((r) => r?.resourceType === "Patient");
  if (!patient) return {};
  const name = patient.name?.[0];
  const given = (name?.given || []).join(" ");
  return {
    name: [given, name?.family].filter(Boolean).join(" ") || patient.id || "",
    birthDate: patient.birthDate || "",
  };
}

function labelize(key) {
  return String(key).replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function Calendar({ model }) {
  const months = [];
  let month = null;
  for (let date = model.start; date && diffDays(date, model.end) >= 0; date = addDays(date, 1)) {
    const d = toDate(date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!month || month.key !== key) {
      month = { key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, days: [] };
      months.push(month);
    }
    month.days.push({ date, day: d.getUTCDate(), rec: model.byDate[date] });
  }
  return (
    <div className="calendar">
      {months.map((m) => (
        <div className="month" key={m.key}>
          <div className="month-label">{m.label}</div>
          <div className="days">
            {m.days.map((d) => {
              const state = d.rec?.bleeding === true ? "yes" : d.rec?.bleeding === false ? "no" : "missing";
              const extras = [d.rec?.flow === 4 ? "heavy" : null, d.rec?.pain ? `pain ${d.rec.pain}/10` : null].filter(Boolean).join(", ");
              return <span key={d.date} className={`day ${state}`} title={`${fmt(d.date)}: ${state === "yes" ? "bleeding" : state === "no" ? "no bleeding" : "missing"}${extras ? `, ${extras}` : ""}`}>{d.day}</span>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function EpisodeTable({ episodes }) {
  if (!episodes.length) return <div className="empty">No bleeding=true episodes found.</div>;
  return (
    <table className="episodes">
      <thead><tr><th>Episode</th><th>Start</th><th>End</th><th>Bleeding days</th><th>Interval</th></tr></thead>
      <tbody>
        {episodes.map((e) => (
          <tr key={e.start}>
            <td>{e.index}</td>
            <td>{fmt(e.start)}</td>
            <td>{fmt(e.end)}</td>
            <td>{e.days}</td>
            <td>{e.interval == null ? "-" : `${e.interval} d`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CueList({ cues }) {
  return <ul className="cues">{cues.map((cue) => <li key={cue}>{cue}</li>)}</ul>;
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="sw yes" /> bleeding</span>
      <span><i className="sw no" /> explicit no</span>
      <span><i className="sw missing" /> missing</span>
    </div>
  );
}

function Info({ label, value, sub }) {
  return <div className="info"><span>{label}</span><b>{value}</b><small>{sub}</small></div>;
}

function Metric({ label, value, sub }) {
  return <div className="metric"><span>{label}</span><b>{value}</b><small>{sub}</small></div>;
}

const CSS = `
.v3{min-height:100vh;background:#f7f8fa;color:#17202a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:28px}
.launch{max-width:760px;margin:8vh auto;background:#fff;border:1px solid #dde3ea;border-radius:10px;padding:34px;box-shadow:0 18px 60px rgba(18,31,45,.08)}
.brand{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:800;color:#5f6f82}
h1{font-size:32px;line-height:1.08;margin:8px 0 12px;letter-spacing:0}
h2{font-size:18px;margin:0 0 4px;letter-spacing:0}
p{margin:0;color:#526173;line-height:1.5}
.launch-grid{display:grid;grid-template-columns:220px 1fr;gap:14px;margin:24px 0 12px}
.launch-grid .wide{grid-column:auto}
label{display:flex;flex-direction:column;gap:7px;font-size:12px;font-weight:700;color:#526173}
input{border:1px solid #cbd5df;border-radius:7px;padding:10px 11px;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#17202a;min-width:0}
input:focus{outline:2px solid #365f8d;outline-offset:0;border-color:#365f8d}
.launch-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px}
button,.launch-actions a{border:1px solid #cbd5df;border-radius:7px;background:#fff;color:#17202a;padding:9px 13px;font:700 13px Inter,system-ui;text-decoration:none;cursor:pointer}
button.primary{background:#1f4e79;border-color:#1f4e79;color:#fff}
button:disabled{opacity:.55;cursor:default}
.notice,.error{margin-top:12px;border-radius:7px;padding:10px 12px;font-size:13px}
.notice{background:#eef5fb;border:1px solid #c8dbea;color:#244966}
.error{background:#fff0ed;border:1px solid #efc3ba;color:#8b2a1f}
.topbar{max-width:1240px;margin:0 auto 18px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
.top-actions{display:flex;align-items:center;gap:10px;color:#697789;font-size:12px;flex-wrap:wrap;justify-content:flex-end}
.identity,.hero-grid,.overlay-grid{max-width:1240px;margin:0 auto 16px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.hero-grid{margin-bottom:18px}
.two-col{max-width:1240px;margin:0 auto 18px;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:18px}
.panel{max-width:1240px;margin:0 auto 18px;background:#fff;border:1px solid #dde3ea;border-radius:8px;padding:18px}
.muted-panel{background:#fbfcfd}
.section-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}
.info,.metric{background:#fff;border:1px solid #dde3ea;border-radius:8px;padding:14px;min-width:0}
.metric{min-height:104px}
.info span,.metric span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#697789;font-weight:800}
.info b,.metric b{display:block;font-size:21px;margin:8px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.metric b{font-size:28px}
.info small,.metric small{display:block;color:#697789;font-size:12px;line-height:1.35}
.inferences,.cues{margin:0;padding-left:20px;color:#2f3b49;line-height:1.55}
.inferences li,.cues li{margin:6px 0}
.calendar{display:flex;flex-direction:column;gap:10px}
.month{display:grid;grid-template-columns:86px 1fr;align-items:center;gap:12px}
.month-label{font-size:12px;font-weight:800;color:#526173}
.days{display:grid;grid-template-columns:repeat(31,minmax(20px,1fr));gap:4px}
.day{height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;border:1px solid #d9e0e8;color:#526173}
.day.yes{background:#b94435;border-color:#a63c2f;color:#fff;font-weight:800}
.day.no{background:#fff}
.day.missing{background:#eef1f4;color:#a0a9b5;border-style:dashed}
.legend{display:flex;gap:12px;flex-wrap:wrap;color:#697789;font-size:12px}
.legend span{display:inline-flex;align-items:center;gap:5px}
.sw{width:12px;height:12px;border-radius:3px;border:1px solid #d9e0e8;display:inline-block}
.sw.yes{background:#b94435;border-color:#a63c2f}.sw.no{background:#fff}.sw.missing{background:#eef1f4;border-style:dashed}
.episodes{width:100%;border-collapse:collapse;font-size:13px}
.episodes th{text-align:left;color:#697789;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #dde3ea;padding:0 8px 8px}
.episodes td{border-bottom:1px solid #eef1f4;padding:10px 8px}
.episodes tr:last-child td{border-bottom:0}
.empty{color:#697789;font-size:13px;padding:12px 0}
@media (max-width:900px){
  .v3{padding:16px}
  .launch-grid,.identity,.hero-grid,.overlay-grid,.two-col{grid-template-columns:1fr}
  .topbar{align-items:flex-start;flex-direction:column}
  .section-head{flex-direction:column}
  .month{grid-template-columns:1fr}
  .days{grid-template-columns:repeat(7,minmax(28px,1fr))}
}
`;

createRoot(document.getElementById("root")).render(<App />);
