/** Contract-dispatching entry point for every closed portable Cycle input. */
import { ClosedBuildHandle } from './closed-build';
import type { ClosedSiteBuild, ContentRef } from './closed-build';
import { JsonSiteBuildView } from './json-site-build';
import { SemanticSiteBuildView } from './semantic-site-build';
import { CYCLE_RENDER_PLAN_V1, CYCLE_RENDER_PLAN_V2 } from './site-build';

export type PortableCycleSiteBuildView = JsonSiteBuildView | SemanticSiteBuildView;

export interface OpenedCycleSiteBuild {
  build: ClosedBuildHandle;
  view: PortableCycleSiteBuildView;
}

function payloadRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function strictBase64(value: string, label: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical standard base64`);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${label} is not valid base64`);
  }
  if (btoa(binary) !== value) throw new Error(`${label} is not canonical standard base64`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Strictly decode either the generic CAS transport or the one-object v1 legacy
 * transport, verify its ClosedSiteBuild, then dispatch its exact Cycle contract. */
export async function openCycleSiteBuildPayload(value: unknown): Promise<OpenedCycleSiteBuild> {
  const payload = payloadRecord(value, 'Cycle SiteBuild payload');
  const allowed = new Set(['transportVersion', 'siteBuild', 'objects', 'siteDbJson']);
  const unexpected = Object.keys(payload).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`Cycle SiteBuild payload has unexpected field ${unexpected}`);
  const siteBuild = payloadRecord(payload.siteBuild, 'Cycle SiteBuild payload.siteBuild') as unknown as ClosedSiteBuild;

  let get: (content: ContentRef) => Promise<Uint8Array | null>;
  if (payload.transportVersion !== undefined || payload.objects !== undefined) {
    if (payload.transportVersion !== 'site-build-cas/v1') {
      throw new Error(`Unsupported Cycle SiteBuild transport ${String(payload.transportVersion)}`);
    }
    const object = payloadRecord(payload.objects, 'Cycle SiteBuild payload.objects');
    const decoded = new Map<string, Uint8Array>();
    for (const [digest, encoded] of Object.entries(object)) {
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`Cycle CAS object has invalid digest key ${digest}`);
      if (typeof encoded !== 'string') throw new Error(`Cycle CAS object ${digest} must be base64 text`);
      decoded.set(digest, strictBase64(encoded, `Cycle CAS object ${digest}`));
    }
    get = async (content) => decoded.get(content.sha256)?.slice() || null;
  } else {
    if (typeof payload.siteDbJson !== 'string') {
      throw new Error('Cycle SiteBuild payload has neither a generic CAS nor legacy siteDbJson');
    }
    const bytes = new TextEncoder().encode(payload.siteDbJson);
    get = async () => bytes.slice();
  }

  const build = await ClosedBuildHandle.open(siteBuild, { get });
  return { build, view: await openCycleSiteBuild(build) };
}

/**
 * Select solely from the exact render target. Artifact presence is never used as
 * a fallback signal, so a malformed v2 build cannot be silently interpreted as
 * the legacy aggregate contract (or vice versa).
 */
export async function openCycleSiteBuild(build: ClosedBuildHandle): Promise<PortableCycleSiteBuildView> {
  const target = build.manifest.renderTarget;
  const contract = target.parameters?.contract;
  if (target.mode === 'external_builder'
    && target.renderer.id === 'cycle-site'
    && target.renderer.version === '1'
    && contract === CYCLE_RENDER_PLAN_V1.id) {
    return JsonSiteBuildView.fromClosedBuild(build);
  }
  if (target.mode === 'external_builder'
    && target.renderer.id === 'cycle-site'
    && target.renderer.version === '2'
    && contract === CYCLE_RENDER_PLAN_V2.id) {
    return SemanticSiteBuildView.fromClosedBuild(build);
  }
  throw new Error(
    `Unsupported closed Cycle target: renderer=${target.renderer.id}@${target.renderer.version}, `
      + `mode=${target.mode}, contract=${contract || '(missing)'}`,
  );
}
