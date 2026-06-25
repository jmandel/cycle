#!/usr/bin/env bun
/**
 * Build agent-facing static artifacts from the RENDERED site (one source of truth).
 *
 * Reads the Liquid-resolved markdown that site-gen publishes (site-gen/out/*.md),
 * not the raw input/pagecontent, so the skill package matches the published pages.
 *
 * Outputs:
 *   - <out>/skill.zip: skill package (SKILL.md + references/* + spec/*).
 *   - <out>/llms.txt: APPENDS an "Agent package" note to site-gen's DB-generated
 *     llms.txt — it does not overwrite the rendered inventory.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = `${import.meta.dir}/..`;
const outDir = Bun.env.AGENT_OUTDIR || join(root, "dist");
// Source the resolved markdown from the rendered site (defaults to the same dir).
const pagecontent = Bun.env.AGENT_SITE_DIR || outDir;
const staging = join(root, "temp", "skill-package");
const zipOut = join(outDir, "skill.zip");
const llmsOut = join(outDir, "llms.txt");

const skillFrontMatter = `---
name: period-tracking-fhir-sharing
description: Add standards-based menstrual/cycle data sharing to a period-, fertility-, or cycle-tracking app using the Period Tracking MVP FHIR IG: export tracked data as a FHIR R4 Bundle, share it as an encrypted SMART Health Link, and render it in a privacy-preserving client-side viewer.
---

`;

const siteLinkTargets: Record<string, string> = {
  "fhir-mapping": "references/fhir-mapping.md",
  "journal-templates": "references/journal-templates.md",
  "smart-health-links-implementation": "references/smart-health-links.md",
  "viewer-integration": "references/viewer.md",
  "smart-health-links": "spec/smart-health-links.md",
  specification: "spec/specification.md",
};

const specLinkTargets: Record<string, string> = {
  "fhir-mapping": "../references/fhir-mapping.md",
  "journal-templates": "../references/journal-templates.md",
  "smart-health-links-implementation": "../references/smart-health-links.md",
  "viewer-integration": "../references/viewer.md",
  skill: "../SKILL.md",
  index: "index.md",
  specification: "specification.md",
  "smart-health-links": "smart-health-links.md",
  "clinical-display": "clinical-display.md",
  examples: "examples.md",
  security: "security.md",
  testing: "testing.md",
  references: "references.md",
  "ig-details": "ig-details.md",
  view: "https://cycle.fhir.me/view",
  view2: "https://cycle.fhir.me/view2.html",
  view3: "https://cycle.fhir.me/view3.html",
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

function referencePackageLinks(markdown: string) {
  return siteToPackageLinks(markdown)
    .replaceAll("(references/fhir-mapping.md)", "(fhir-mapping.md)")
    .replaceAll("(references/journal-templates.md)", "(journal-templates.md)")
    .replaceAll("(references/smart-health-links.md)", "(smart-health-links.md)")
    .replaceAll("(references/viewer.md)", "(viewer.md)")
    .replaceAll("(spec/specification.md", "(../spec/specification.md")
    .replaceAll("(spec/smart-health-links.md)", "(../spec/smart-health-links.md)");
}

function specPackageLinks(markdown: string) {
  return rewriteSitePageLinks(markdown.replaceAll("(skill.zip)", "(../README.md)"), specLinkTargets);
}

async function read(path: string) {
  return Bun.file(path).text();
}

async function writeTransformed(src: string, dest: string, transform = (s: string) => s) {
  await writeFile(dest, transform(await read(join(pagecontent, src))));
}

async function publisherUrl() {
  const config = await read(join(root, "sushi-config.yaml"));
  const match = config.match(/publisher:\s*\n(?:[^\n]*\n)*?\s+url:\s*(\S+)/);
  return match?.[1] || "https://github.com/jmandel/cycle";
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
await mkdir(join(staging, "references"), { recursive: true });
await mkdir(join(staging, "spec"), { recursive: true });

await writeFile(join(staging, "SKILL.md"), skillFrontMatter + siteToPackageLinks(await read(join(pagecontent, "skill.md"))));

await writeTransformed("fhir-mapping.md", join(staging, "references", "fhir-mapping.md"), referencePackageLinks);
await writeTransformed("smart-health-links-implementation.md", join(staging, "references", "smart-health-links.md"), referencePackageLinks);
await writeTransformed("viewer-integration.md", join(staging, "references", "viewer.md"), referencePackageLinks);
await writeTransformed("journal-templates.md", join(staging, "references", "journal-templates.md"), referencePackageLinks);

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
- The \`references/\` directory contains the implementation method details.
- The \`spec/\` directory contains the core IG markdown snapshot used by the skill.

Published IG: https://cycle.fhir.me/
Source repository: ${sourceRepo}
`);

await zipDir(staging, zipOut);

// Preserve site-gen's DB-generated llms.txt (the rendered inventory mirroring the
// menu + artifacts). Only APPEND an "Agent package" section — never overwrite it.
const agentSection = `\n## Agent package\n- [skill.zip](skill.zip): self-contained skill package (SKILL.md + references + core spec markdown), generated from this published site. Source: ${sourceRepo}\n`;
const existingLlms = (await Bun.file(llmsOut).exists()) ? await read(llmsOut) : "";
if (!existingLlms) {
  console.warn(`warning: ${llmsOut} not found — run site-gen first so llms.txt exists. Writing agent section only.`);
}
const nextLlms = existingLlms.includes("## Agent package")
  ? existingLlms // idempotent: already has the section
  : (existingLlms.trimEnd() + "\n" + agentSection);
await writeFile(llmsOut, nextLlms);

console.log(`agent assets -> ${zipOut} (+ appended Agent package to ${llmsOut})`);
