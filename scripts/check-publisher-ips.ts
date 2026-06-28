#!/usr/bin/env bun
const proc = Bun.spawnSync(['bun', 'scripts/check-publisher-external-ig.ts'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...Bun.env,
    PUBLISHER_IG_LABEL: Bun.env.PUBLISHER_IG_LABEL || 'ips',
    PUBLISHER_IG_REPO: Bun.env.PUBLISHER_IG_REPO || Bun.env.PUBLISHER_IPS_REPO || 'https://github.com/HL7/fhir-ips.git',
    PUBLISHER_IG_REF: Bun.env.PUBLISHER_IG_REF || Bun.env.PUBLISHER_IPS_REF || 'master',
    PUBLISHER_IG_DIR: Bun.env.PUBLISHER_IG_DIR || Bun.env.PUBLISHER_IPS_DIR || 'temp/ips-ig',
    PUBLISHER_IG_RUN_JAVA: Bun.env.PUBLISHER_IG_RUN_JAVA || Bun.env.PUBLISHER_IPS_RUN_JAVA || 'missing',
    PUBLISHER_IG_REQUIRE_COMPARE: Bun.env.PUBLISHER_IG_REQUIRE_COMPARE || Bun.env.PUBLISHER_IPS_REQUIRE_COMPARE || '1',
    PUBLISHER_IG_JAVA_TIMEOUT_MS: Bun.env.PUBLISHER_IG_JAVA_TIMEOUT_MS || Bun.env.PUBLISHER_IPS_JAVA_TIMEOUT_MS || '',
  },
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exit(proc.exitCode ?? 1);
