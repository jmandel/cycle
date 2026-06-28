import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { Json } from './packages';

const attrPrefix = '@_';
const valueAttr = `${attrPrefix}value`;
const xmlnsAttr = `${attrPrefix}xmlns`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: attrPrefix,
  textNodeName: '#text',
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: attrPrefix,
  textNodeName: '#text',
  format: false,
  suppressEmptyNode: true,
});

const booleanPrimitiveNames = new Set([
  'active',
  'abstract',
  'caseSensitive',
  'compositional',
  'experimental',
  'isModifier',
  'isSummary',
  'mustSupport',
  'ordered',
  'readOnly',
  'repeats',
  'required',
  'valueBoolean',
  'versionNeeded',
]);

const integerPrimitiveNames = new Set([
  'maxLength',
  'min',
  'minLength',
  'rank',
  'total',
  'valueInteger',
  'valuePositiveInt',
  'valueUnsignedInt',
]);

const decimalPrimitiveNames = new Set([
  'valueDecimal',
]);

const universalArrayElementNames = new Set([
  'coding',
  'contained',
  'contact',
  'extension',
  'identifier',
  'modifierExtension',
  'telecom',
  'useContext',
]);

const arrayPathSuffixes = [
  ['Bundle', 'entry'],
  ['Parameters', 'parameter'],
  ['Procedure', 'focalDevice'],
  ['Questionnaire', 'item'],
  ['QuestionnaireResponse', 'item'],
  ['StructureDefinition', 'context'],
  ['StructureDefinition', 'mapping'],
  ['StructureMap', 'group'],
  ['StructureMap', 'structure'],
  ['ValueSet', 'identifier'],
  ['answer', 'item'],
  ['compose', 'exclude'],
  ['compose', 'include'],
  ['concept', 'concept'],
  ['concept', 'designation'],
  ['concept', 'property'],
  ['differential', 'element'],
  ['element', 'condition'],
  ['element', 'constraint'],
  ['element', 'mapping'],
  ['element', 'type'],
  ['exclude', 'concept'],
  ['exclude', 'filter'],
  ['expansion', 'contains'],
  ['group', 'element'],
  ['group', 'input'],
  ['group', 'rule'],
  ['ImplementationGuide', 'dependsOn'],
  ['include', 'concept'],
  ['include', 'filter'],
  ['item', 'answer'],
  ['item', 'answerOption'],
  ['item', 'code'],
  ['item', 'enableWhen'],
  ['item', 'initial'],
  ['item', 'item'],
  ['rule', 'dependent'],
  ['rule', 'rule'],
  ['rule', 'source'],
  ['rule', 'target'],
  ['snapshot', 'element'],
  ['target', 'parameter'],
  ['type', 'profile'],
  ['type', 'targetProfile'],
] as const;

type ConvertedElement =
  | { kind: 'primitive'; value?: unknown; metadata?: Json }
  | { kind: 'complex'; value: Json };

export function parseFhirXmlResource(xml: string): Json {
  const parsed = parser.parse(xml.replace(/^\uFEFF/, ''));
  const rootEntries = Object.entries(parsed || {}).filter(([name]) => !name.startsWith('?'));
  if (rootEntries.length !== 1) {
    throw new Error(`Expected exactly one FHIR XML root element, got ${rootEntries.length}`);
  }
  const [resourceType, node] = rootEntries[0];
  return convertResource(resourceType, asObject(node));
}

function convertResource(resourceType: string, node: Json): Json {
  return { resourceType, ...convertComplexElement(resourceType, node, [resourceType]) };
}

function convertElement(name: string, node: unknown, path: string[]): ConvertedElement {
  if (name === 'div' && isObject(node)) {
    return { kind: 'primitive', value: builder.build({ div: node }) };
  }
  const objectNode = asObject(node);
  const wrapped = wrappedResource(objectNode);
  if (wrapped) return { kind: 'complex', value: convertResource(wrapped.resourceType, wrapped.node) };
  if (valueAttr in objectNode) {
    const metadata = primitiveMetadata(objectNode);
    return {
      kind: 'primitive',
      value: parsePrimitiveValue(name, objectNode[valueAttr]),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };
  }
  if (isPrimitiveMetadataOnly(name, objectNode)) {
    const metadata = primitiveMetadata(objectNode);
    return { kind: 'primitive', ...(Object.keys(metadata).length ? { metadata } : {}) };
  }
  return { kind: 'complex', value: convertComplexElement(name, objectNode, path) };
}

function convertComplexElement(_name: string, node: Json, path: string[]): Json {
  const out: Json = {};
  for (const [attr, value] of Object.entries(node)) {
    if (!attr.startsWith(attrPrefix) || attr === xmlnsAttr || attr === valueAttr) continue;
    out[attr.slice(attrPrefix.length)] = value;
  }
  for (const [childName, childValue] of childEntries(node)) {
    const childPath = [...path, childName];
    const forceArray = Array.isArray(childValue) || isArrayElementPath(childPath);
    const children = Array.isArray(childValue) ? childValue : [childValue];
    const converted = children.map((child) => convertElement(childName, child, childPath));
    assignConvertedChildren(out, childName, converted, forceArray);
  }
  return out;
}

function assignConvertedChildren(out: Json, name: string, children: ConvertedElement[], forceArray: boolean): void {
  const values = children.map((child) => child.kind === 'primitive' ? child.value : child.value);
  const metadatas = children.map((child) => child.kind === 'primitive' ? child.metadata : undefined);
  const anyValue = values.some((value) => value !== undefined);
  const anyMetadata = metadatas.some((metadata) => metadata && Object.keys(metadata).length);

  if (anyValue) out[name] = forceArray ? values : values[0];
  if (anyMetadata) {
    const metadataValues = metadatas.map((metadata) => metadata || {});
    out[`_${name}`] = forceArray ? metadataValues : metadataValues[0];
  }
}

function primitiveMetadata(node: Json): Json {
  const out: Json = {};
  if (node[`${attrPrefix}id`] !== undefined) out.id = node[`${attrPrefix}id`];
  if (node.extension !== undefined) {
    const extensions = Array.isArray(node.extension) ? node.extension : [node.extension];
    out.extension = extensions.map((extension) => {
      const converted = convertElement('extension', extension, ['extension']);
      return converted.kind === 'complex' ? converted.value : {};
    });
  }
  return out;
}

function isPrimitiveMetadataOnly(name: string, node: Json): boolean {
  if (name === 'extension' || name === 'modifierExtension') return false;
  const childNames = childEntries(node).map(([childName]) => childName);
  if (!childNames.length) return false;
  return childNames.every((childName) => childName === 'extension');
}

function isArrayElementPath(path: string[]): boolean {
  const name = path.at(-1);
  if (name && universalArrayElementNames.has(name)) return true;
  return arrayPathSuffixes.some((suffix) => pathEndsWith(path, suffix));
}

function pathEndsWith(path: string[], suffix: readonly string[]): boolean {
  if (suffix.length > path.length) return false;
  return suffix.every((value, index) => path[path.length - suffix.length + index] === value);
}

function parsePrimitiveValue(name: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (booleanPrimitiveNames.has(name)) return value === 'true';
  if (integerPrimitiveNames.has(name) && /^-?\d+$/.test(value)) return Number(value);
  if (decimalPrimitiveNames.has(name) && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function wrappedResource(node: Json): { resourceType: string; node: Json } | null {
  const entries = childEntries(node);
  if (entries.length !== 1) return null;
  const [name, value] = entries[0];
  if (!/^[A-Z][A-Za-z0-9]+$/.test(name) || Array.isArray(value)) return null;
  return { resourceType: name, node: asObject(value) };
}

function childEntries(node: Json): [string, unknown][] {
  return Object.entries(node).filter(([name]) => !name.startsWith(attrPrefix) && name !== '#text');
}

function asObject(value: unknown): Json {
  if (!isObject(value)) return {};
  return value;
}

function isObject(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
