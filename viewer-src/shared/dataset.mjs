/**
 * dataset.mjs — the deterministic synthetic case (copper-IUD), ported verbatim
 * from the old kit's clinician viewer (buildDataset). It produces an array of
 * per-day records. This is the SINGLE source of truth for the worked example:
 * the FHIR generator (generate-example.mjs) emits new-model resources from it,
 * and the round-trip test asserts the transform recovers the same records.
 *
 * Each record: { date, flow 0-4, isPeriod, intermenstrual, postcoital, pain 0-10,
 *   painTypes[], functionalLimit, symptoms{key:1-3}, bbt, mucus, lh, sex, note }
 */

export const IUD_DATE = "2026-03-18";
export const TODAY = "2026-06-21";
export const SPAN_START = "2025-12-08";
export const SOURCE_APP = "drip";

const D = (s) => new Date(s + "T00:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((D(b) - D(a)) / 86400000);
const rng = (seed) => { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };

export const EPISODES = [
  { start: "2025-12-08", flows: [3, 3, 2, 2, 1], painPeak: 4 },
  { start: "2026-01-04", flows: [3, 3, 3, 2, 1], painPeak: 4 },
  { start: "2026-02-02", flows: [3, 3, 2, 2, 1], painPeak: 3 },
  { start: "2026-03-05", flows: [2, 3, 2, 1], painPeak: 3 },
  { start: "2026-03-30", flows: [4, 4, 3, 3, 2, 2, 1, 1], painPeak: 8 },
  { start: "2026-05-07", flows: [4, 3, 3, 2, 2, 1], painPeak: 7 },
  { start: "2026-06-04", flows: [4, 4, 3, 3, 2, 1, 1], painPeak: 7, ongoing: true },
];

const SPECIAL = {
  "2026-04-14": { intermenstrual: 1, pain: 0, note: "Light spotting, no products needed" },
  "2026-04-16": { pain: 4, painTypes: ["bowel"], note: "Lower-pelvic ache, with bowel movement" },
  "2026-04-19": { intermenstrual: 1, pain: 3, painTypes: ["dyspareunia"], sex: 1 },
  "2026-05-20": { pain: 3, note: "Mid-cycle pelvic ache" },
  "2026-05-22": { intermenstrual: 1, postcoital: 1, sex: 1, pain: 1, note: "Spotting after sex" },
  "2026-05-24": { pain: 5, painTypes: ["dyspareunia"], sex: 1 },
  "2026-05-27": { intermenstrual: 1, pain: 0 },
};

export function buildDataset() {
  const rand = rng(20260621);
  const daily = {};
  for (const ep of EPISODES) {
    ep.flows.forEach((f, i) => {
      const date = addDays(ep.start, i);
      const pain = Math.max(0, Math.round(ep.painPeak - i * (ep.painPeak / 3.2)));
      const rec = (daily[date] = daily[date] || { date, _entry: 1, source: SOURCE_APP });
      rec.flow = f; rec.isPeriod = 1;
      if (pain > 0) { rec.pain = pain; rec.painTypes = ["pelvic"]; }
      if (f >= 4 || pain >= 7) rec.functionalLimit = 1;
      if (i <= 2) {
        const v = 3 - i;
        rec.symptoms = rec.symptoms || {};
        if (i < 2) rec.symptoms.irritability = Math.max(1, v - 1);
        rec.symptoms.lowMood = Math.max(1, v - 1);
        if (i === 0) rec.symptoms.bloating = 2;
        if (Object.keys(rec.symptoms).length === 0) delete rec.symptoms;
      }
    });
  }
  for (let c = 0; c < EPISODES.length - 1; c++) {
    const next = EPISODES[c + 1].start;
    for (let k = 7; k >= 1; k--) {
      const date = addDays(next, -k);
      if (daily[date]?.isPeriod) continue;
      if (rand() < 0.78) {
        const rec = (daily[date] = daily[date] || { date, _entry: 1, source: SOURCE_APP });
        rec.symptoms = rec.symptoms || {};
        const intensity = Math.max(1, Math.round((8 - k) / 2));
        if (rand() < 0.85) rec.symptoms.irritability = Math.min(3, intensity);
        if (rand() < 0.7) rec.symptoms.lowMood = Math.min(3, intensity - (rand() < 0.5 ? 1 : 0));
        if (k <= 4 && rand() < 0.6) rec.symptoms.headache = Math.min(3, intensity - 1);
        if (rand() < 0.75) rec.symptoms.bloating = Math.min(3, intensity);
        if (rand() < 0.6) rec.symptoms.fatigue = Math.min(3, Math.max(1, intensity - 1));
        Object.keys(rec.symptoms).forEach((s) => { if (rec.symptoms[s] <= 0) delete rec.symptoms[s]; });
        if (!Object.keys(rec.symptoms).length) delete rec.symptoms;
      }
    }
  }
  for (const [date, o] of Object.entries(SPECIAL)) {
    const rec = (daily[date] = daily[date] || { date, _entry: 1, source: SOURCE_APP });
    if (o.intermenstrual) { rec.flow = 1; rec.intermenstrual = 1; }
    if (o.pain != null && o.pain > 0) { rec.pain = o.pain; rec.painTypes = (rec.painTypes || []).concat(o.painTypes || ["pelvic"]); }
    if (o.sex) rec.sex = 1;
    if (o.postcoital) rec.postcoital = 1;
    if (o.note) rec.note = o.note;
  }
  for (const st of ["2025-12-08", "2026-01-04", "2026-02-02"]) {
    for (let i = 0; i < 26; i++) {
      const date = addDays(st, i);
      if (rand() < 0.55) {
        const rec = (daily[date] = daily[date] || { date, _entry: 1, source: SOURCE_APP });
        const base = i < 14 ? 36.4 : 36.7;
        rec.bbt = +(base + (rand() - 0.5) * 0.12 + (i === 14 ? -0.15 : 0)).toFixed(2);
        if (i >= 10 && i <= 15 && rand() < 0.5) rec.mucus = i < 13 ? "egg-white" : "creamy";
        if (i === 13) rec.lh = 1;
      }
    }
  }
  if (daily["2026-05-08"]) daily["2026-05-08"].functionalLimit = 1;
  for (let dt = SPAN_START; diffDays(dt, TODAY) >= 0; dt = addDays(dt, 1)) {
    if (daily[dt]) continue;
    if (rand() < 0.62) daily[dt] = { date: dt, _entry: 1, flow: 0, source: SOURCE_APP };
  }
  for (const k of Object.keys(daily)) if (daily[k].flow == null) daily[k].flow = 0;
  return Object.values(daily).sort((a, b) => (a.date < b.date ? -1 : 1));
}
