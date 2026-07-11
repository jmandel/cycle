/** Exact artifact keys required by the cycle-site/v2 renderer contract. */

export const CYCLE_SEMANTIC_NAMESPACE = 'cycle.semantic/v1';

export const CYCLE_SEMANTIC_RESOURCES_ARTIFACT = Object.freeze({
  kind: 'data',
  namespace: CYCLE_SEMANTIC_NAMESPACE,
  name: 'resources.json',
} as const);

export const CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT = Object.freeze({
  kind: 'data',
  namespace: CYCLE_SEMANTIC_NAMESPACE,
  name: 'terminology.json',
} as const);

export const CYCLE_SEMANTIC_NAVIGATION_ARTIFACT = Object.freeze({
  kind: 'data',
  namespace: CYCLE_SEMANTIC_NAMESPACE,
  name: 'navigation.json',
} as const);

export const CYCLE_SEMANTIC_CONFIG_ARTIFACT = Object.freeze({
  kind: 'data',
  namespace: CYCLE_SEMANTIC_NAMESPACE,
  name: 'config.json',
} as const);

/** Static v2 roots. Every authored Asset root is required beside these values. */
export const CYCLE_SEMANTIC_DATA_ARTIFACTS = Object.freeze([
  CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
  CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
  CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
  CYCLE_SEMANTIC_CONFIG_ARTIFACT,
]);

export const CYCLE_RENDER_PLAN_V2 = Object.freeze({
  id: 'cycle-site/v2',
  requiredDataArtifacts: CYCLE_SEMANTIC_DATA_ARTIFACTS,
});
