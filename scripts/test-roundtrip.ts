/** test-roundtrip.ts (bun) — transform the generated bundle and sanity-check it. */
import { transformBundle } from "../viewer-src/transform.mjs";
import { buildDataset, IUD_DATE } from "../viewer-src/dataset.mjs";

const bundle = await Bun.file(`${import.meta.dir}/../input/resources/Bundle-period-tracking-longitudinal-example.json`).json();
const vm = transformBundle(bundle, { rangeEnd: "2026-06-21" });
const orig = buildDataset();

let fail = 0;
const ok = (c: boolean, msg: string) => { if (!c) { console.log("  FAIL:", msg); fail++; } else console.log("  ok:", msg); };

ok(vm.cycles.length === 7, `7 cycles (got ${vm.cycles.length})`);
ok(vm.cycles.filter((c: any) => c.complete).length === 6, `6 complete cycles (got ${vm.cycles.filter((c:any)=>c.complete).length})`);
ok(vm.cycles[vm.cycles.length - 1].ongoing === true, "last cycle ongoing");
ok(vm.context.iudDate === IUD_DATE, `iud date ${vm.context.iudDate}`);
ok(vm.cycles.some((c: any) => c.postIUD), "some cycles flagged postIUD");
ok(vm.cycles.filter((c: any) => c.postIUD).length === 3, `3 postIUD cycles (got ${vm.cycles.filter((c:any)=>c.postIUD).length})`);

// spot fields
const byd = vm.byDate;
const heavy = vm.daily.filter((d: any) => d.flow === 4).length;
const origHeavy = orig.filter((d: any) => d.flow === 4).length;
ok(heavy === origHeavy, `heavy days ${heavy} == ${origHeavy}`);
const pain = vm.daily.filter((d: any) => d.pain > 0).length;
const origPain = orig.filter((d: any) => d.pain > 0).length;
ok(pain === origPain, `pain days ${pain} == ${origPain}`);
ok(vm.daily.some((d: any) => d.painTypes?.includes("dyspareunia")), "dyspareunia present");
ok(vm.daily.some((d: any) => d.intermenstrual), "intermenstrual present");
ok(vm.daily.some((d: any) => d.bbt != null), "bbt present");
// symptoms present (presence-based via SNOMED findings)
const anySym = vm.daily.find((d: any) => d.symptoms && Object.keys(d.symptoms).length);
ok(!!anySym, `symptom present (e.g. ${anySym?.date} ${JSON.stringify(anySym?.symptoms)})`);
const symKinds = new Set<string>();
for (const d of vm.daily) if (d.symptoms) Object.keys(d.symptoms).forEach((k) => symKinds.add(k));
ok([...symKinds].length >= 3, `>=3 symptom kinds present (${[...symKinds].join(",")})`);

// the special day's diary note survives on the panel
ok(byd["2026-05-22"]?.note?.includes("after sex"), "2026-05-22 diary note preserved");

console.log(fail ? `\n${fail} FAILURES` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
