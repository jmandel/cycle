/**
 * build-all.ts (bun) — local generated demo build. Runs every step that
 * produces uncommitted artifacts under dist/ for local testing or deployment.
 *
 *   bun scripts/build-all.ts   (or: bun run build)
 *
 * Steps:
 *   1. gen-example  -> dist/examples/Bundle-...longitudinal-example.json
 *   2. build-viewer -> dist/view.html + dist/view-assets/{app.js, index.html}
 *   3. gen-shl      -> dist/view-assets/{example.jwe, shlink.txt, ...}
 */
const here = import.meta.dir;
async function step(name: string, file: string) {
  console.log(`\n── ${name} ──`);
  const p = Bun.spawn(["bun", `${here}/${file}`], { stdout: "inherit", stderr: "inherit" });
  const code = await p.exited;
  if (code !== 0) throw new Error(`${name} failed (exit ${code})`);
}

await step("generate example bundle", "gen-example.ts");
await step("bundle viewer SPA", "build-viewer.ts");
await step("package SMART Health Link", "gen-shl.ts");
console.log("\n✔ local generated demo artifacts built under dist/.");
