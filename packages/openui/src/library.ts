/**
 * Component library model: `defineComponent` / `createLibrary`, the generated
 * system prompt, and document validation against the registered components.
 *
 * The library, its JSON schema, prompt generation, and structural validation
 * are all delegated to `@openuidev/lang-core` — the source of truth for the
 * OpenUI Lang language. This module is the thin Noetic-facing adapter: it keeps
 * the renderer-free `defineComponent` shape agents use on the server and maps
 * lang-core's structured parse errors back to Noetic's `UiValidationIssue`.
 */

import type { Library, LibraryJSONSchema, ValidationError } from '@openuidev/lang-core';
import * as langCore from '@openuidev/lang-core';
import type { ZodObject, ZodRawShape } from 'zod';
import { z } from 'zod';
import type { ElementNode, UiDocument } from './lang/document';
import { OPENUI_LANG_DIALECT, resolveDocument } from './lang/document';

/** A prop schema as it appears in `ZodObject.shape` (Zod v4 core type). */
type PropSchema = z.core.$ZodType;

//#region Definitions

/** @public One registered component: its name, docs, and ordered prop schemas. */
export interface ComponentDefinition<N extends string = string> {
  name: N;
  description?: string;
  /**
   * Prop schemas. Positional arguments in OpenUI Lang map to props by key
   * declaration order (Zod preserves shape insertion order).
   */
  props?: ZodObject<ZodRawShape>;
}

/** @public Declare a component the model (or a tool) may render. */
export function defineComponent<const N extends string>(
  def: ComponentDefinition<N>,
): ComponentDefinition<N> {
  return def;
}

/**
 * Components every library accepts implicitly: data bindings, action blocks,
 * and the slot that mounts a tool-owned region into a model-authored layout.
 */
export const BUILTIN_COMPONENTS = [
  'Action',
  'Query',
  'Mutation',
  'ToolView',
] as const;

/** @public A registered component library — the vocabulary a surface renders. */
export interface UiLibrary<N extends string = string> {
  dialect: string;
  components: ReadonlyMap<string, ComponentDefinition>;
  componentNames: readonly N[];
  /** The underlying lang-core library (JSON schema, prompt, parser source). */
  readonly core: Library;
  /** The generated component-library prompt appended to a step's instructions. */
  systemPrompt(): string;
  /** The JSON Schema lang-core's parser uses for positional-to-named mapping. */
  toJSONSchema(): LibraryJSONSchema;
}

/** @public Options for `createLibrary`. */
export interface CreateLibraryOptions {
  dialect?: string;
}

/** @public Build a library from component definitions. */
export function createLibrary<const D extends readonly ComponentDefinition[]>(
  definitions: D,
  options?: CreateLibraryOptions,
): UiLibrary<D[number]['name']> {
  const components = new Map<string, ComponentDefinition>();
  for (const def of definitions) {
    if (components.has(def.name)) {
      throw new Error(`duplicate component name '${def.name}' in library`);
    }
    components.set(def.name, def);
  }
  const dialect = options?.dialect ?? OPENUI_LANG_DIALECT;

  // Bridge each renderer-free definition into a lang-core component. lang-core
  // requires a description and props object; the `component` renderer is unused
  // on the server, so it is left undefined.
  const core = langCore.createLibrary({
    components: definitions.map((def) =>
      langCore.defineComponent({
        name: def.name,
        description: def.description ?? '',
        props: def.props ?? z.object({}),
        component: undefined,
      }),
    ),
  });

  return {
    dialect,
    components,
    componentNames: definitions.map((d) => d.name),
    core,
    systemPrompt: () => core.prompt(),
    toJSONSchema: () => core.toJSONSchema(),
  };
}

//#endregion

//#region Prop introspection

export interface PropSignature {
  name: string;
  /** Human-readable type rendered into diagnostics (`string`, `number`, …). */
  type: string;
  optional: boolean;
  schema: PropSchema;
}

/** Ordered prop signatures for a component (declaration order). */
export function componentProps(def: ComponentDefinition): PropSignature[] {
  if (!def.props) {
    return [];
  }
  return Object.entries(def.props.shape).map(([name, schema]) => ({
    name,
    type: describeSchema(schema),
    optional: z.safeParse(schema, undefined).success,
    schema,
  }));
}

function describeSchema(schema: PropSchema): string {
  try {
    const json = z.toJSONSchema(schema, {
      io: 'input',
    });
    if (typeof json.type === 'string') {
      return json.type;
    }
    if (Array.isArray(json.anyOf)) {
      const types = json.anyOf
        .map((s) => (typeof s === 'object' && s !== null && 'type' in s ? String(s.type) : 'any'))
        .filter((t) => t !== 'null');
      if (types.length > 0) {
        return types.join(' | ');
      }
    }
    if (Array.isArray(json.enum)) {
      return json.enum.map((v) => JSON.stringify(v)).join(' | ');
    }
  } catch {
    // Exotic schema — fall through to the permissive label.
  }
  return 'any';
}

//#endregion

//#region Validation

/** @public One problem found validating a document against a library. */
export interface UiValidationIssue {
  ref: string;
  component: string;
  message: string;
}

/** Map a lang-core structural parse error to a Noetic validation issue. */
function fromParseError(error: ValidationError): UiValidationIssue {
  const ref = error.statementId ?? '';
  switch (error.code) {
    case 'unknown-component':
      return {
        ref,
        component: error.component,
        message: `unknown component '${error.component}'`,
      };
    case 'excess-args':
      return {
        ref,
        component: error.component,
        message: `too many arguments: ${error.message}`,
      };
    case 'missing-required':
    case 'null-required':
      return {
        ref,
        component: error.component,
        message: `prop '${error.path.replace(/^\//, '')}' is required`,
      };
    default:
      return {
        ref,
        component: error.component,
        message: error.message,
      };
  }
}

/** Walk the resolved tree, checking each element's static props against its schema. */
function collectPropIssues(
  library: UiLibrary,
  node: ElementNode,
  issues: UiValidationIssue[],
): void {
  const def = library.components.get(node.typeName);
  if (def?.props) {
    const ref = node.statementId ?? library.core.root ?? '';
    for (const [name, value] of Object.entries(node.props)) {
      // Dynamic values (refs, `$state`, nested calls) resolve at render time —
      // lang-core leaves them as AST nodes, which are unverifiable statically.
      if (isDynamic(value)) {
        continue;
      }
      const shape = def.props.shape[name];
      if (!shape) {
        continue;
      }
      const parsed = z.safeParse(shape, value);
      if (!parsed.success) {
        issues.push({
          ref,
          component: node.typeName,
          message: `prop '${name}' rejects ${JSON.stringify(value)}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        });
      }
    }
  }
  for (const value of Object.values(node.props)) {
    walkChildElements(value, (child) => collectPropIssues(library, child, issues));
  }
}

function isDynamic(value: unknown): boolean {
  if (value !== null && typeof value === 'object' && 'k' in value) {
    return true; // a lang-core AST node — resolved at render time
  }
  return false;
}

function isElementNode(value: unknown): value is ElementNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'element' &&
    'typeName' in value &&
    typeof value.typeName === 'string'
  );
}

function walkChildElements(value: unknown, visit: (node: ElementNode) => void): void {
  if (isElementNode(value)) {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkChildElements(item, visit);
    }
  }
}

/**
 * Validate every component call in a document against the library: unknown
 * components, arity overflow, missing required props, and literal prop
 * mismatches. Dynamic args (refs, `$state`, nested calls) are skipped — they
 * resolve at render time. Structural checks come from lang-core's parser;
 * literal value checks use the library's own Zod schemas.
 * @public
 */
export function validateDocument(library: UiLibrary, doc: UiDocument): UiValidationIssue[] {
  const parsed = resolveDocument(doc, library.toJSONSchema());
  const issues: UiValidationIssue[] = parsed.meta.errors.map(fromParseError);
  if (parsed.root) {
    collectPropIssues(library, parsed.root, issues);
  }
  return issues;
}

//#endregion
