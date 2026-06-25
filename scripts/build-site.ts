#!/usr/bin/env bun
/**
 * build-site.ts (bun) — full generated static-site build for local use or
 * GitHub Actions. Generated sample data is copied into input/resources only as
 * an ephemeral build input so the IG Publisher can validate and publish it.
 */
import { rm } from "node:fs/promises";

const root = `${import.meta.dir}/..`;
const exampleOut = `${root}/input/resources/Bundle-period-tracking-longitudinal-example.json`;
const viewerAssetOut = `${root}/output/view-assets`;
const viewerPageOut = `${root}/output/view.html`;
const publisherJar = `${root}/input-cache/publisher.jar`;
const viewerBase = Bun.env.VIEWER_BASE || "http://localhost:5525/view";

async function step(name: string, cmd: string[], env: Record<string, string> = {}) {
  console.log(`\n-- ${name} --`);
  const proc = Bun.spawn(cmd, {
    cwd: root,
    env: { ...Bun.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${name} failed (exit ${code})`);
}

await step("generate build example Bundle", ["bun", "scripts/gen-example.ts"], { EXAMPLE_OUT: exampleOut });
await step("compile FSH", ["./_sushi.sh"]);
await step("integrity checks", ["bun", "scripts/check-mvp.ts"], { BUNDLE_FILE: exampleOut });

if (!(await Bun.file(publisherJar).exists())) {
  await step("download IG Publisher", ["./_updatePublisher.sh"]);
}
await step("run IG Publisher", ["./_genonce.sh"]);

await rm(`${root}/output/view`, { recursive: true, force: true });
await rm(viewerAssetOut, { recursive: true, force: true });
await rm(viewerPageOut, { force: true });

if (Bun.env.PAGES_CNAME) {
  await Bun.write(`${root}/output/CNAME`, `${Bun.env.PAGES_CNAME}\n`);
}

await step("bundle viewer", ["bun", "scripts/build-viewer.ts"], {
  VIEWER_OUTDIR: viewerAssetOut,
  VIEWER_PAGE_OUT: viewerPageOut,
});
await step("package sample SMART Health Link", ["bun", "scripts/gen-shl.ts"], {
  BUNDLE_FILE: exampleOut,
  SHL_OUTDIR: viewerAssetOut,
  VIEWER_BASE: viewerBase,
});

console.log("\nsite build complete: output/");
