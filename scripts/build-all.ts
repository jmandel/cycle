/**
 * build-all.ts (bun) — the full pre-publisher build. Runs every step that
 * produces committed artifacts, in dependency order, so build.fhir.org (which
 * only runs the IG Publisher, no arbitrary scripts) finds everything in place.
 *
 *   bun scripts/build-all.ts   (or: bun run build)
 *
 * Steps:
 *   1. gen-example  -> input/resources/Bundle-...longitudinal-example.json (IG example)
 *   2. gen-shl      -> input/images/viewer/{example.jwe, shl.json, shlink.txt, ...}
 *   3. build-viewer -> input/images/viewer/{app.js, index.html}
 * Then run the IG Publisher (./_genonce.sh) to validate + publish.
 */
const here = import.meta.dir;
async function step(name: string, file: string) {
  console.log(`\n── ${name} ──`);
  const p = Bun.spawn(["bun", `${here}/${file}`], { stdout: "inherit", stderr: "inherit" });
  const code = await p.exited;
  if (code !== 0) throw new Error(`${name} failed (exit ${code})`);
}

await step("generate example bundle", "gen-example.ts");
await step("package SMART Health Link", "gen-shl.ts");
await step("bundle viewer SPA (in-IG)", "build-viewer.ts");
await step("build GitHub Pages viewer", "build-pages.ts");
await step("publish agent skill", "build-skill.ts");
console.log("\n✔ pre-publisher artifacts built. Now run ./_genonce.sh to publish.");
