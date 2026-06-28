type Json = Record<string, any>;

export type OidAssignments = ReadonlyMap<string, ReadonlyMap<string, string>>;

const OID_NODES_BY_TYPE: Readonly<Record<string, string>> = {
  ActivityDefinition: '11',
  ActorDefinition: '12',
  CapabilityStatement: '13',
  ChargeItemDefinition: '14',
  Citation: '15',
  CodeSystem: '16',
  CompartmentDefinition: '17',
  ConceptMap: '18',
  ConditionDefinition: '19',
  EffectEvidenceSynthesis: '20',
  EventDefinition: '21',
  Evidence: '22',
  EvidenceReport: '23',
  EvidenceVariable: '24',
  ExampleScenario: '25',
  GraphDefinition: '26',
  ImplementationGuide: '27',
  Library: '28',
  Measure: '29',
  MessageDefinition: '30',
  NamingSystem: '31',
  ObservationDefinition: '32',
  OperationDefinition: '33',
  PlanDefinition: '34',
  Questionnaire: '35',
  Requirements: '36',
  ResearchDefinition: '37',
  ResearchElementDefinition: '38',
  RiskEvidenceSynthesis: '39',
  SearchParameter: '40',
  SpecimenDefinition: '41',
  StructureDefinition: '42',
  StructureMap: '43',
  SubscriptionTopic: '44',
  TerminologyCapabilities: '45',
  TestPlan: '46',
  TestScript: '47',
  ValueSet: '48',
};

export function publisherOidNodeForType(resourceType: string): string {
  return OID_NODES_BY_TYPE[resourceType] ?? '10';
}

export function parseOidsIni(content: string): OidAssignments {
  let section = '';
  const out = new Map<string, Map<string, string>>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1 || !section || section === 'Documentation' || section === 'Key') continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key || !value) continue;
    if (!out.has(section)) out.set(section, new Map());
    out.get(section)!.set(key, value.replace(/^urn:oid:/, ''));
  }

  return out;
}

export function mergeOidAssignments(...assignments: Array<OidAssignments | undefined>): OidAssignments {
  const out = new Map<string, Map<string, string>>();
  for (const assignment of assignments) {
    for (const [type, byId] of assignment || []) {
      if (!out.has(type)) out.set(type, new Map());
      for (const [id, oid] of byId) out.get(type)!.set(id, oid);
    }
  }
  return out;
}

export function configuredAutoOidRoot(cfg: Json): string | undefined {
  const parameters = cfg.parameters || {};
  const value = parameters['auto-oid-root'] ?? parameters.autoOidRoot;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function deriveAutoOidAssignments(resources: Json[], oidRoot: string | undefined, existing?: OidAssignments): OidAssignments {
  if (!oidRoot) return existing || new Map();
  const counters = new Map<string, number>();
  const out = new Map<string, Map<string, string>>();

  for (const [type, byId] of existing || []) {
    out.set(type, new Map(byId));
    for (const oid of byId.values()) {
      const parts = oid.split('.');
      const last = Number(parts[parts.length - 1]);
      if (Number.isFinite(last)) counters.set(type, Math.max(counters.get(type) || 0, last));
    }
  }

  for (const resource of resources) {
    if (!resource?.resourceType || !resource.id) continue;
    if (resource.resourceType === 'ImplementationGuide') continue;
    if (identifierOids(resource).length) continue;
    if (!out.has(resource.resourceType)) out.set(resource.resourceType, new Map());
    const byId = out.get(resource.resourceType)!;
    if (byId.has(resource.id)) continue;
    const next = (counters.get(resource.resourceType) || 0) + 1;
    counters.set(resource.resourceType, next);
    byId.set(resource.id, `${oidRoot}.${publisherOidNodeForType(resource.resourceType)}.${next}`);
  }

  return out;
}

export function identifierOids(resource: Json): string[] {
  const identifiers = Array.isArray(resource.identifier)
    ? resource.identifier
    : resource.identifier
      ? [resource.identifier]
      : [];
  return identifiers
    .filter((i: any) => i.system === 'urn:ietf:rfc:3986' && typeof i.value === 'string' && i.value.startsWith('urn:oid:'))
    .map((i: any) => i.value.replace(/^urn:oid:/, ''));
}

export function resourceOidValues(resource: Json, assignments?: OidAssignments): string[] {
  const explicit = identifierOids(resource);
  const assigned = resource.resourceType && resource.id ? assignments?.get(resource.resourceType)?.get(resource.id) : undefined;
  return [...new Set([...explicit, ...(assigned ? [assigned] : [])])];
}
