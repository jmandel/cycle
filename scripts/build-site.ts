#!/usr/bin/env bun
/**
 * build-site.ts (bun) — full generated static-site build for local use or
 * GitHub Actions. Generated sample data is copied into input/resources only as
 * an ephemeral build input so the IG Publisher can validate and publish it.
 */
import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = `${import.meta.dir}/..`;
const exampleOut = `${root}/input/resources/Bundle-period-tracking-longitudinal-example.json`;
const englishOut = `${root}/output/en`;
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

async function requireTool(name: string, cmd: string[], hint: string) {
  try {
    await step(`check ${name}`, cmd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${name} is required for site builds. ${hint}\n${msg}`);
  }
}

async function copyChildren(src: string, dest: string) {
  for (const entry of await readdir(src, { withFileTypes: true })) {
    await cp(join(src, entry.name), join(dest, entry.name), { recursive: true, force: true });
  }
}

await requireTool("Graphviz dot", ["dot", "-V"], "Install the graphviz package so PlantUML diagrams render.");
await requireTool("zip", ["zip", "-v"], "Install zip so the generated agent skill package can be published.");
await step("generate build example Bundle", ["bun", "scripts/gen-example.ts"], { EXAMPLE_OUT: exampleOut });
await step("compile FSH", ["./_sushi.sh"]);
await step("integrity checks", ["bun", "scripts/check-mvp.ts"], { BUNDLE_FILE: exampleOut });

if (!(await Bun.file(publisherJar).exists())) {
  await step("download IG Publisher", ["./_updatePublisher.sh"]);
}
await step("run IG Publisher", ["./_genonce.sh"]);

// Publisher writes English pages under output/en plus a root language-redirect
// stub. This project publishes English only, so make the English build the root
// site while leaving /en/ in place for any existing links.
await copyChildren(`${root}/output/en`, `${root}/output`);

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
await step("package agent assets", ["bun", "scripts/build-agent-assets.ts"], {
  AGENT_OUTDIR: `${root}/output`,
});

// Keep /en/ as a compatibility mirror for generated assets that are created
// after Publisher/Jekyll finishes.
await cp(viewerPageOut, join(englishOut, "view.html"), { force: true });
await cp(viewerAssetOut, join(englishOut, "view-assets"), { recursive: true, force: true });
await cp(`${root}/output/skill.zip`, join(englishOut, "skill.zip"), { force: true });
await cp(`${root}/output/llms.txt`, join(englishOut, "llms.txt"), { force: true });

console.log("\nsite build complete: output/");
