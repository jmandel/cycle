/**
 * transform.mjs — turn a Period Tracking MVP FHIR R4 Bundle (new data model)
 * into the view model the clinician viewer renders. Pure, dependency-free,
 * browser- and Node-safe; runs client-side after a SMART Health Link is
 * decrypted, so the file host never needs to understand the data.
 *
 * Output: { meta, cycles[], daily[], byDate, events[], context }
 *   daily record: { date, source, bleeding true/false, flow 0-4, isPeriod, intermenstrual,
 *     postcoital, pain, painTypes[], functionalLimit, symptoms{key:1-3},
 *     bbt, mucus, lh, sex, note }
 */

import {
  SYS, LOINC, SCT, FLOW_LEVEL_BY_CODE, FINDING_SYMPTOM_KEY, APP_SYMPTOM_KEY, FINDING_PAINTYPE,
} from "./codes.mjs";

const dayOf = (s) => (s ? String(s).slice(0, 10) : null);
const toDate = (s) => new Date(s + "T00:00:00Z");
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const codings = (cc) => cc?.coding || [];
const firstCode = (cc) => codings(cc)[0]?.code ?? null;
const num = (o) => (typeof o.valueQuantity?.value === "number" ? o.valueQuantity.value
  : typeof o.valueInteger === "number" ? o.valueInteger : null);
const effDay = (o) => dayOf(o.effectiveDateTime) || dayOf(o.effectivePeriod?.start) || dayOf(o.issued);

function has(cc, system, code) {
  return codings(cc).some((c) => c.code === code && (!system || c.system === system));
}

export function transformBundle(bundle, opts = {}) {
  const resources = (bundle?.entry || []).map((e) => e.resource).filter(Boolean);
  const daily = new Map();
  const events = [];
  const sources = new Set();

  const day = (date) => { if (!daily.has(date)) daily.set(date, { date, source: null, _entry: 1 }); return daily.get(date); };
  const noteSrc = (r) => { if (r.meta?.source) sources.add(r.meta.source); };

  // device id -> friendly name (for source app label)
  const deviceNames = {};
  for (const r of resources) {
    if (r.resourceType === "Device") {
      const nm = (r.deviceName || []).find((d) => d.name)?.name || r.type?.text;
      if (nm) { deviceNames[`Device/${r.id}`] = nm; sources.add(nm); }
    }
  }

  for (const r of resources) {
    noteSrc(r);
    if (r.resourceType === "Observation") {
      const date = effDay(r);
      if (!date) continue;
      const code = r.code;
      const cs = codings(code);
      const d = day(date);

      // universal bleeding core (boolean)
      if (has(code, SYS.cycle, "menstrual-bleeding")) {
        if (r.valueBoolean === true) d.bleeding = true;
        else if (r.valueBoolean === false) d.bleeding = false;
        continue;
      }
      // menstrual flow (coded)
      if (has(code, SYS.cycle, "menstrual-flow")) {
        const fc = firstCode(r.valueCodeableConcept);
        const lvl = FLOW_LEVEL_BY_CODE[fc] ?? 0;
        d.flow = Math.max(d.flow || 0, lvl);
        if (d.bleeding == null) d.bleeding = lvl > 0;
        continue;
      }
      // pain score 0-10
      if (has(code, SYS.loinc, LOINC.painScore)) {
        const v = num(r);
        if (v != null) d.pain = Math.max(d.pain ?? 0, v);
        d.painTypes = d.painTypes || ["pelvic"];
        continue;
      }
      // basal body temperature (a vital sign)
      if (has(code, SYS.loinc, LOINC.bodyTemp)) { const v = num(r); if (v != null) d.bbt = v; continue; }
      // symptom / finding + an exact standard or app-native value.
      if (has(code, SYS.cycle, "symptom") || has(code, SYS.loinc, LOINC.symptom) || has(code, SYS.loinc, LOINC.mood)) {
        const valueCodings = codings(r.valueCodeableConcept);
        const fc = valueCodings[0]?.code ?? null;
        const fk = valueCodings.map((c) => (
          c.system === SYS.sct ? FINDING_SYMPTOM_KEY[c.code]
            : c.system === SYS.appExample ? APP_SYMPTOM_KEY[c.code]
              : null
        )).find(Boolean);
        if (fk) { d.symptoms = d.symptoms || {}; d.symptoms[fk] = Math.max(d.symptoms[fk] || 0, 2); }
        const pt = FINDING_PAINTYPE[fc];
        if (pt) { d.painTypes = d.painTypes || ["pelvic"]; if (!d.painTypes.includes(pt)) d.painTypes.push(pt); }
        continue; // unrecognised findings (e.g. app-native custom symptoms) are ignored
      }
    } else if (r.resourceType === "Procedure") {
      const date = dayOf(r.performedDateTime) || dayOf(r.performedPeriod?.start);
      const txt = (r.code?.text || "").toLowerCase();
      if (has(r.code, SYS.sct, SCT.iudInsertion) || /iud|intrauterine/.test(txt)) {
        if (date) events.push({ date, type: "iud-insertion", label: r.code?.text || "IUD insertion" });
      }
    }
  }

  for (const d of daily.values()) {
    // Legacy / partial-input fallback: flow implies the boolean core if absent.
    if (d.bleeding == null && d.flow != null) d.bleeding = d.flow > 0;
    if (d.painTypes && d.painTypes.length > 1) d.painTypes = [...new Set(d.painTypes)];
  }

  const dailyArr = [...daily.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const cycleGap = opts.cycleGapDays ?? 3;
  classifyBleedingRuns(dailyArr, cycleGap);
  const cycles = buildCycles(dailyArr, cycleGap, opts.rangeEnd, events);
  const rangeStart = dailyArr[0]?.date || null;
  const rangeEnd = opts.rangeEnd || dailyArr[dailyArr.length - 1]?.date || null;
  const byDate = Object.fromEntries(dailyArr.map((d) => [d.date, d]));
  const iud = events.find((e) => e.type === "iud-insertion");

  return {
    meta: { rangeStart, rangeEnd, completeCycles: cycles.filter((c) => c.complete).length, sources: [...sources] },
    cycles, daily: dailyArr, byDate,
    events: events.sort((a, b) => (a.date < b.date ? -1 : 1)),
    context: {
      spanStart: rangeStart, today: rangeEnd,
      sourceApp: [...sources][0] || "tracker",
      iudDate: iud ? iud.date : null,
      episodeStarts: cycles.map((c) => c.start),
    },
  };
}

function classifyBleedingRuns(dailyArr, cycleGap) {
  const bleeding = dailyArr.filter((d) => d.bleeding === true);
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const hasLightOrMore = run.some((d) => (d.flow || 0) >= 2);
    const hasNoFlowData = run.every((d) => d.flow == null);
    const episode = hasLightOrMore || hasNoFlowData;
    for (const d of run) {
      if (episode) d.isPeriod = 1;
      else d.intermenstrual = 1;
    }
    run = [];
  };
  for (const d of bleeding) {
    const prev = run[run.length - 1];
    if (prev && diffDays(prev.date, d.date) > cycleGap) flush();
    run.push(d);
  }
  flush();
}

function buildCycles(dailyArr, cycleGap, rangeEnd, events) {
  const periodDays = dailyArr.filter((d) => d.isPeriod).map((d) => d.date);
  const starts = []; let prev = null, runDates = []; const runs = [];
  for (const date of periodDays) {
    if (prev == null || diffDays(prev, date) > cycleGap) { if (runDates.length) runs.push(runDates); runDates = [date]; starts.push(date); }
    else runDates.push(date);
    prev = date;
  }
  if (runDates.length) runs.push(runDates);
  const lastDate = rangeEnd || dailyArr[dailyArr.length - 1]?.date;
  return starts.map((start, i) => {
    const next = starts[i + 1] || null;
    const run = runs[i] || [start];
    let dur = 1;
    for (let k = 1; k < run.length; k++) { if (diffDays(run[k - 1], run[k]) === 1) dur++; else break; }
    const priorIud = events.find((e) => e.type === "iud-insertion" && diffDays(e.date, start) >= 0);
    return {
      idx: i + 1, start, nextStart: next, end: next ? addDays(next, -1) : lastDate,
      length: next ? diffDays(start, next) : null, bleedDuration: dur,
      complete: !!next, ongoing: !next,
      postIUD: !!priorIud, flags: { afterIudInsertion: !!priorIud },
    };
  });
}

export default transformBundle;
