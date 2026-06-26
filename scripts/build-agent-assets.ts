#!/usr/bin/env bun
/**
 * Build agent-facing static artifacts from the RENDERED site (one source of truth).
 *
 * Reads the Liquid-resolved markdown that site-gen publishes (site-gen/out/*.md),
 * not the raw input/pagecontent, so the skill package matches the published pages.
 *
 * Outputs:
 *   - <out>/skill.zip: skill package (SKILL.md + spec/*).
 *   - <out>/llms.txt: APPENDS an "Agent package" note to site-gen's DB-generated
 *     llms.txt — it does not overwrite the rendered inventory.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = `${import.meta.dir}/..`;
const outDir = Bun.env.AGENT_OUTDIR || join(root, "dist");
// Source the resolved markdown from the rendered site (defaults to the same dir).
const pagecontent = Bun.env.AGENT_SITE_DIR || outDir;
const staging = join(root, "temp", "skill-package");
const zipOut = join(outDir, "skill.zip");
const llmsOut = join(outDir, "llms.txt");

async function read(path: string) {
  return Bun.file(path).text();
}

async function sushiConfig() {
  return read(join(root, "sushi-config.yaml"));
}

async function canonicalUrl() {
  const config = await sushiConfig();
  const match = config.match(/^canonical:\s*(\S+)/m);
  if (!match) throw new Error("sushi-config.yaml must declare canonical for the agent package");
  return match[1].replace(/\/+$/, "");
}

const siteBase = await canonicalUrl();

const skillFrontMatter = `---
name: period-tracking-fhir-sharing
description: Add standards-based menstrual/cycle data sharing to a period-, fertility-, or cycle-tracking app using the Period Tracking MVP FHIR IG: export tracked data as a FHIR R4 Bundle, share it as an encrypted SMART Health Link, and render it in a privacy-preserving client-side viewer.
---

`;

const siteLinkTargets: Record<string, string> = {
  "smart-health-links": "spec/smart-health-links.md",
  specification: "spec/specification.md",
  implementation: "SKILL.md",
  skill: "SKILL.md",
};

const specLinkTargets: Record<string, string> = {
  "fhir-mapping": `${siteBase}/fhir-mapping.html`,
  "journal-templates": `${siteBase}/journal-templates.html`,
  "smart-health-links-implementation": `${siteBase}/smart-health-links-implementation.html`,
  "viewer-integration": `${siteBase}/viewer-integration.html`,
  skill: "../SKILL.md",
  implementation: "../SKILL.md",
  index: "index.md",
  specification: "specification.md",
  "smart-health-links": "smart-health-links.md",
  "clinical-display": "clinical-display.md",
  examples: "examples.md",
  security: "security.md",
  testing: "testing.md",
  references: "references.md",
  "ig-details": "ig-details.md",
  view: `${siteBase}/view.html`,
  view2: `${siteBase}/view2.html`,
  view3: `${siteBase}/view3.html`,
};

function rewriteSitePageLinks(markdown: string, targets: Record<string, string>) {
  let out = markdown;
  for (const [page, target] of Object.entries(targets)) {
    out = out.replace(new RegExp(`\\(${page}\\.html(#[^)]+)?\\)`, "g"), (_match, anchor = "") => `(${target}${anchor})`);
  }
  return out;
}

function siteToPackageLinks(markdown: string) {
  return rewriteSitePageLinks(markdown.replaceAll("(skill.zip)", "(README.md)"), siteLinkTargets);
}

function specPackageLinks(markdown: string) {
  return rewriteSitePageLinks(markdown.replaceAll("(skill.zip)", "(../README.md)"), specLinkTargets);
}

async function writeTransformed(src: string, dest: string, transform = (s: string) => s) {
  await writeFile(dest, transform(await read(join(pagecontent, src))));
}

async function publisherUrl() {
  const config = await sushiConfig();
  const match = config.match(/publisher:\s*\n(?:[^\n]*\n)*?\s+url:\s*(\S+)/);
  if (!match) throw new Error("sushi-config.yaml must declare publisher.url for the agent package");
  return match[1];
}

async function zipDir(sourceDir: string, targetZip: string) {
  await rm(targetZip, { force: true });
  const proc = Bun.spawn(["zip", "-qr", targetZip, "."], {
    cwd: sourceDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`zip failed (exit ${code})`);
}

await mkdir(outDir, { recursive: true });
await rm(staging, { recursive: true, force: true });
await mkdir(join(staging, "spec"), { recursive: true });

await writeFile(join(staging, "SKILL.md"), skillFrontMatter + siteToPackageLinks(await read(join(pagecontent, "implementation.md"))));

for (const file of [
  "index.md",
  "specification.md",
  "smart-health-links.md",
  "clinical-display.md",
  "examples.md",
  "security.md",
  "testing.md",
  "references.md",
  "ig-details.md",
]) {
  await writeTransformed(file, join(staging, "spec", file), specPackageLinks);
}

const sourceRepo = await publisherUrl();
await writeFile(join(staging, "README.md"), `# Period Tracking FHIR Sharing Skill

This zip is generated from the Period Tracking MVP IG source content.

- Start with \`SKILL.md\`.
- The \`spec/\` directory contains the core IG markdown snapshot used by the skill.

Published IG: ${siteBase}/
Source repository: ${sourceRepo}
`);

await zipDir(staging, zipOut);

// Preserve site-gen's DB-generated llms.txt (the rendered inventory mirroring the
// menu + artifacts). Only APPEND an "Agent package" section — never overwrite it.
const agentSection = `\n## Agent package\n- [skill.zip](skill.zip): self-contained skill package (SKILL.md + core spec markdown), generated from this published site. Source: ${sourceRepo}\n`;
const existingLlms = (await Bun.file(llmsOut).exists()) ? await read(llmsOut) : "";
if (!existingLlms) {
  console.warn(`warning: ${llmsOut} not found — run site-gen first so llms.txt exists. Writing agent section only.`);
}
const nextLlms = existingLlms.includes("## Agent package")
  ? existingLlms // idempotent: already has the section
  : (existingLlms.trimEnd() + "\n" + agentSection);
await writeFile(llmsOut, nextLlms);

console.log(`agent assets -> ${zipOut} (+ appended Agent package to ${llmsOut})`);
