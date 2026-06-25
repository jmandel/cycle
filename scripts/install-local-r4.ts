#!/usr/bin/env bun
// Install a local hl7.fhir.r4.core package archive into the FHIR package cache.

import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const archive = Bun.argv[2];
if (!archive) {
  console.error("Usage: bun scripts/install-local-r4.ts /path/to/hl7.fhir.r4.core-4.0.1.tgz");
  process.exit(2);
}

const cacheRoot = Bun.env.FHIR_PACKAGE_CACHE || `${Bun.env.HOME}/.fhir/packages`;
const target = join(cacheRoot, "hl7.fhir.r4.core#4.0.1");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const proc = Bun.spawnSync(["tar", "-xzf", archive, "-C", target]);
if (!proc.success) {
  console.error(new TextDecoder().decode(proc.stderr));
  process.exit(1);
}

const packageFile = join(target, "package", "package.json");
if (!(await Bun.file(packageFile).exists())) {
  console.error("The archive does not have the expected FHIR NPM package layout.");
  process.exit(1);
}

const pkg = JSON.parse(await Bun.file(packageFile).text());
console.log(`Installed ${pkg.name}#${pkg.version} at ${target}`);
