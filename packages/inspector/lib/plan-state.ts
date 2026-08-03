/**
 * Reads the plan layer's state off the wire.
 *
 * `GET /layers/:id/state` returns `unknown` — the endpoint is generic across
 * every layer — so the viewer parses before it draws. It cannot assume the
 * documents are schema-valid: the live path hands back state the layer just
 * validated, but the storage fallback reads whatever was persisted, which no
 * schema has revalidated since it was written.
 *
 * Documents are therefore checked one at a time. One unreadable workflow costs
 * you that workflow, not the whole plan.
 */

import type { WorkflowDocument } from '@noetic-tools/core';
import { z } from 'zod';

//#region Types

/** The slice of plan state the graph viewer draws. */
export interface PlanView {
  phase: string;
  planTree: WorkflowDocument | null;
  workflows: Record<string, WorkflowDocument>;
  /** Names of workflows that arrived unreadable, so the viewer can say so. */
  rejected: string[];
}

/** Why there is nothing to draw. `absent` is a plan that does not exist yet. */
export type PlanReadFailure = 'absent' | 'unreadable';

//#endregion

//#region Schema

/** Confirms a value carries a workflow envelope, and gives it back typed. */
const DocumentSchema = z.custom<WorkflowDocument>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 1 &&
    'root' in value &&
    typeof value.root === 'object' &&
    value.root !== null &&
    'kind' in value.root,
  {
    message: 'not a workflow document',
  },
);

/**
 * `phase` is only a label, so it is optional — refusing to draw a whole plan
 * because a decorative string is missing would be the strictest check guarding
 * the least. The documents are the load-bearing part.
 */
const PlanStateSchema = z.object({
  phase: z.string().optional(),
  planTree: z.unknown().optional(),
  workflows: z.record(z.string(), z.unknown()).optional(),
});

//#endregion

//#region Public API

/**
 * Parses layer state into the viewer's shape, or says why it could not.
 * `absent` means the layer has no plan (a fresh child, or plan mode never
 * entered); `unreadable` means the payload was not plan state at all, which is
 * a different problem and must not be shown as "no plan yet".
 */
export function readPlanState(state: unknown): PlanView | PlanReadFailure {
  if (state === null || state === undefined) {
    return 'absent';
  }
  const parsed = PlanStateSchema.safeParse(state);
  if (!parsed.success) {
    return 'unreadable';
  }

  const tree = DocumentSchema.safeParse(parsed.data.planTree);
  const workflows: Record<string, WorkflowDocument> = {};
  const rejected: string[] = [];
  for (const [name, value] of Object.entries(parsed.data.workflows ?? {})) {
    const document = DocumentSchema.safeParse(value);
    if (document.success) {
      workflows[name] = document.data;
    } else {
      rejected.push(name);
    }
  }

  if (!tree.success && Object.keys(workflows).length === 0 && rejected.length === 0) {
    return 'absent';
  }
  return {
    phase: parsed.data.phase ?? 'unknown',
    planTree: tree.success ? tree.data : null,
    workflows,
    rejected,
  };
}

//#endregion
