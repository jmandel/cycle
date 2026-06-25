#!/usr/bin/env bun
/**
 * Build agent-facing static artifacts from the IG pagecontent source.
 *
 * Outputs:
 *   - <out>/skill.zip: Codex-style skill package with SKILL.md, references/*,
 *     and spec/* copied from input/pagecontent.
 *   - <out>/llms.txt: small agent entrypoint for the published site.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = `${import.meta.dir}/..`;
const pagecontent = join(root, "input", "pagecontent");
const outDir = Bun.env.AGENT_OUTDIR || join(root, "dist");
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

await writeFile(llmsOut, `# Period Tracking MVP Implementation Guide

Canonical site: https://cycle.fhir.me/
Source repository: ${sourceRepo}

This site defines a small FHIR R4 exchange model for patient-generated menstrual period tracking data, plus SMART Health Link packaging and a client-side reference viewer.

Key pages:
- Specification: https://cycle.fhir.me/specification.html
- Agent implementation skill: https://cycle.fhir.me/skill.html
- FHIR mapping reference: https://cycle.fhir.me/fhir-mapping.html
- SMART Health Links packaging: https://cycle.fhir.me/smart-health-links.html
- SMART Health Links implementation notes: https://cycle.fhir.me/smart-health-links-implementation.html
- Viewer integration: https://cycle.fhir.me/viewer-integration.html
- Reference viewer: https://cycle.fhir.me/view

Agent package:
- Download https://cycle.fhir.me/skill.zip for a self-contained skill package. It maps the browsable IG skill page to SKILL.md and includes references plus core spec markdown.

Primary compatibility rule:
- Layer 0 is required: emit cycle#menstrual-bleeding boolean facts at the source date or timestamp. Layer 1 structured facts and Layer 2 native archive are optional additive layers.
`);

console.log(`agent assets -> ${zipOut} + ${llmsOut}`);
