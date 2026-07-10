/** JSON-backed SiteBuildView shared by browser and native portable hosts. */
import { artifactKeyId, ClosedBuildHandle } from './closed-build';
import type { ClosedSiteBuild } from './closed-build';
import { CYCLE_RENDER_PLAN, CYCLE_SITE_DB_ARTIFACT } from './site-build';
import { compareText } from './order';
import type {
  MenuRow,
  PageRow,
  ResourceRow,
  SiteAsset,
  SiteBuildView,
} from './site-build';

export interface MetadataRow { Key: number; Name: string; Value: string }
export interface ConceptRow {
  Key: number;
  ResourceKey: number;
  ParentKey: number | null;
  Code?: string | null;
  Display?: string | null;
  Definition?: string | null;
}
export interface ValueSetCodeRow {
  Key: number;
  ResourceKey: number;
  ValueSetUri: string;
  ValueSetVersion: string;
  System: string;
  Version?: string | null;
  Code: string;
  Display?: string | null;
}
export interface SiteConfigRow { Name: string; Json: string }
export interface JsonAssetRow extends SiteAsset { Content: string }

/** Canonical row set serialized by `site_build::site_db_compat::project`. */
export interface SiteDbRows {
  metadata: MetadataRow[];
  resources: ResourceRow[];
  concepts: ConceptRow[];
  valueSetCodes: ValueSetCodeRow[];
  pages: PageRow[];
  menu: MenuRow[];
  siteConfig: SiteConfigRow[];
  assets: JsonAssetRow[];
}

/**
 * WASM transport during the v1 -> v2 transition. New producers use the generic
 * digest map. `siteDbJson` remains optional solely for an old cycle-site/v1
 * producer that returned its one object beside the manifest.
 */
export interface CycleSiteBuildPayload {
  transportVersion?: 'site-build-cas/v1';
  siteBuild: ClosedSiteBuild;
  objects?: Record<string, string>;
  siteDbJson?: string;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function textualMime(mime: string): boolean {
  const value = String(mime || '').toLowerCase();
  return value.startsWith('text/')
    || value === 'image/svg+xml'
    || value === 'application/xml'
    || value === 'application/xhtml+xml';
}

function assertRows(value: unknown): asserts value is SiteDbRows {
  if (!value || typeof value !== 'object') throw new Error('Cycle rows artifact is not a JSON object');
  const rows = value as Record<string, unknown>;
  for (const name of ['metadata', 'resources', 'concepts', 'valueSetCodes', 'pages', 'menu', 'siteConfig', 'assets']) {
    if (!Array.isArray(rows[name])) throw new Error(`Cycle rows artifact has no ${name} array`);
  }
}

function assertCycleContract(build: ClosedSiteBuild): void {
  const target = build.renderTarget;
  if (
    target.mode !== 'external_builder'
    || target.renderer.id !== 'cycle-site'
    || target.renderer.version !== '1'
    || target.parameters?.contract !== CYCLE_RENDER_PLAN.id
  ) {
    throw new Error('Closed SiteBuild target does not implement cycle-site/v1');
  }
  const required = build.renderPlan.requiredArtifacts;
  if (
    required.length !== 1
    || artifactKeyId(required[0]) !== artifactKeyId(CYCLE_SITE_DB_ARTIFACT)
  ) {
    throw new Error('Cycle SiteBuild must require exactly compat.site_db/rows.json');
  }
}

export class JsonSiteBuildView implements SiteBuildView {
  constructor(readonly rows: SiteDbRows) {
    assertRows(rows);
  }

  static async fromClosedBuild(build: ClosedBuildHandle): Promise<JsonSiteBuildView> {
    assertCycleContract(build.manifest);
    const rows = JSON.parse(await build.readTextArtifact(CYCLE_SITE_DB_ARTIFACT)) as unknown;
    assertRows(rows);
    return new JsonSiteBuildView(rows);
  }

  metadata(): Record<string, string> {
    return Object.fromEntries(this.rows.metadata.map((row) => [row.Name, row.Value]));
  }

  resources(type?: string): ResourceRow[] {
    const rows = type
      ? this.rows.resources.filter((row) => row.Type === type)
      : this.rows.resources.slice();
    rows.sort((left, right) => type
      ? compareText(left.Id, right.Id)
      : compareText(left.Type, right.Type) || compareText(left.Id, right.Id));
    return rows;
  }

  parse(row: ResourceRow): any {
    return JSON.parse(row.Json);
  }

  valueSetCodes(url: string): { system: string; code: string; display?: string }[] {
    return this.rows.valueSetCodes
      .filter((row) => row.ValueSetUri === url)
      .sort((left, right) => compareText(left.System, right.System) || compareText(left.Code, right.Code))
      .map((row) => ({ system: row.System, code: row.Code, display: row.Display ?? undefined }));
  }

  concepts(resourceKey: number): {
    Key: number;
    ParentKey: number | null;
    Code: string;
    Display?: string;
    Definition?: string;
  }[] {
    return this.rows.concepts
      .filter((row) => row.ResourceKey === resourceKey)
      .sort((left, right) => left.Key - right.Key)
      .map((row) => ({
        Key: row.Key,
        ParentKey: row.ParentKey,
        Code: row.Code ?? '',
        Display: row.Display ?? undefined,
        Definition: row.Definition ?? undefined,
      }));
  }

  pages(): PageRow[] {
    return this.rows.pages.slice().sort((left, right) => left.Ord - right.Ord);
  }

  menu(): MenuRow[] {
    return this.rows.menu.slice().sort((left, right) => left.Ord - right.Ord);
  }

  siteConfig(name: string): any {
    const row = this.rows.siteConfig.find((candidate) => candidate.Name === name);
    return row ? JSON.parse(row.Json) : null;
  }

  textAsset(name: string): string | null {
    const row = this.rows.assets.find((candidate) => candidate.Name === name);
    return row && textualMime(row.Mime)
      ? new TextDecoder().decode(decodeBase64(row.Content))
      : null;
  }

  /** Portable SiteBuildView semantics: callers receive the addressed bytes, not
   * the compatibility row transport's base64 spelling. */
  assets(): SiteAsset[] {
    return this.rows.assets.map((row) => ({
      Name: row.Name,
      Mime: row.Mime,
      Content: decodeBase64(row.Content),
    }));
  }

  /** Narrow accessor for legacy v1 hosts that still need the compatibility
   * row's base64 spelling. Do not use this for ordinary view or file output. */
  encodedAssets(): JsonAssetRow[] {
    return this.rows.assets.slice();
  }

  ig(): any {
    const rows = this.rows.resources.filter(
      (candidate) => candidate.Type === 'ImplementationGuide' && candidate.Web === 'index.html',
    );
    if (rows.length !== 1) {
      throw new Error(`Cycle v1 SiteBuild must contain exactly one primary ImplementationGuide index row; found ${rows.length}`);
    }
    const row = rows[0];
    const ig = JSON.parse(row.Json);
    ig.contact = (ig.contact || []).map((contact: any) => ({
      ...contact,
      telecom: (contact.telecom || []).map((telecom: any) => telecom.value ?? telecom),
    }));
    return ig;
  }
}
