/**
 * check-view2.ts (bun) — exercise view2's binary-first derivation engine on the
 * worked example bundle, with NO browser and NO crypto. Confirms the core
 * (date,bleeding) extrapolations are produced and sane.
 *
 *   bun scripts/check-view2.ts
 */
import { transformBundle } from "../viewer-src/shared/transform.mjs";
import { derive } from "../viewer-src/view2/derive.mjs";

const path = `${import.meta.dir}/../input/resources/Bundle-period-tracking-longitudinal-example.json`;
const bundle = JSON.parse(await Bun.file(path).text());

const vm = transformBundle(bundle, { rangeEnd: "2026-06-21" });
const d = derive(vm);
const c = d.core, m = c.metrics, cl = c.classification;

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`  ${cond ? "ok" : "FAIL"}: ${msg}`); if (!cond) fails++; };

console.log("Coverage:", `${m.bleedingDays} bleeding days; ${d.coverage.trackedDays}/${d.coverage.spanDays} days tracked (${Math.round(d.coverage.fraction * 100)}%); longest gap ${d.coverage.longestGap}d`);
console.log("Core:", `${c.menses.length} menses, ${m.completeCycles} complete cycles; cycle median ${m.cycleMedian}d (${m.cycleMin}-${m.cycleMax}, var ${m.variation}); duration median ${m.durMedian}d (${m.durMin}-${m.durMax})`);
console.log("Class:", `frequency=${cl.frequency} regularity=${cl.regularity} duration=${cl.duration}`);
console.log("LMP:", c.lmp, `(${c.daysSinceLmp}d ago)`, "| prediction:", c.prediction ? `${c.prediction.onset} (${c.prediction.daysUntil}d)` : "none");
console.log("Spotting/IMB:", c.spotting.map((s) => `${s.onset}${s.cycleIdx ? ` (cycle ${s.cycleIdx} d${s.dayOfCycle})` : ""}`).join(", ") || "none");
console.log("Flags:", c.flags.map((f) => f.kind).join(", ") || "none");
console.log("Layers present:", Object.entries(d.layers).filter(([, v]: any) => v.present).map(([k]) => k).join(", ") || "none (binary-only)");

console.log("\nChecks:");
ok(m.cycleMedian != null && m.cycleMedian >= 21 && m.cycleMedian <= 40, `cycle median in plausible range (${m.cycleMedian})`);
ok(m.completeCycles >= 5, `>=5 complete cycles derived from binary (${m.completeCycles})`);
ok(["regular", "irregular"].includes(cl.regularity), `regularity classified (${cl.regularity})`);
ok(cl.frequency === "normal", `frequency normal (${cl.frequency})`);
ok(!!c.lmp, `LMP present (${c.lmp})`);
ok(c.daysSinceLmp != null && c.daysSinceLmp >= 0, `days-since-LMP computed (${c.daysSinceLmp})`);
ok(m.durMedian != null && m.durMedian >= 1 && m.durMedian <= 12, `bleed duration plausible (${m.durMedian})`);
ok(d.layers.flow.present, `flow layer detected as overlay (peak/cycle: ${d.layers.flow.peakByCycle.join(",")})`);

// the critical principle: re-derive with layers stripped -> core must be identical
const binaryOnlyVm = { ...vm, daily: vm.daily.map((x: any) => ({ date: x.date, bleeding: x.bleeding })) };
const d2 = derive(binaryOnlyVm);
ok(d2.core.metrics.completeCycles === m.completeCycles && d2.core.metrics.cycleMedian === m.cycleMedian && d2.core.lmp === c.lmp,
  `core identical from binary alone (cycles ${d2.core.metrics.completeCycles}, median ${d2.core.metrics.cycleMedian}, lmp ${d2.core.lmp})`);
ok(!d2.layers.flow.present && !d2.layers.pain.present, `layers correctly absent when only the boolean is sent`);

console.log(fails ? `\n${fails} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
