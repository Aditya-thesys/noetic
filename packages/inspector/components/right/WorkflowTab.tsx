'use client';

/**
 * The plan, drawn as a graph.
 *
 * The plan layer holds a reviewed tree plus a set of named workflows the tree
 * points at through `subflow` refs — deliberately, so the tree stays small
 * enough to read. The viewer follows that structure: one picker across the top,
 * the tree first, and a click on a `subflow` node opens the workflow it names.
 *
 * State comes from the layer's own endpoint, refetched whenever the layer's
 * change counter bumps, so the picture tracks the plan as the model writes it.
 */

import type { Edge, NodeMouseHandler } from '@xyflow/react';
import { Background, Controls, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowDocument } from '@noetic-tools/core';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import type { PlanReadFailure, PlanView } from '../../lib/plan-state';
import { readPlanState } from '../../lib/plan-state';
import { useInspector } from '../../lib/store';
import { toFlow } from '../../lib/workflow-graph';
import type { StepFlowNode } from '../../lib/workflow-layout';
import { FlowDirection, layoutFlow } from '../../lib/workflow-layout';
import { StepNode } from './StepNode';

const PLAN_LAYER_ID = 'plan';
const NODE_TYPES = {
  step: StepNode,
};

/** Which document is on screen: the reviewed tree, or one named workflow. */
type Target =
  | {
      kind: 'tree';
    }
  | {
      kind: 'workflow';
      name: string;
    };

type Load =
  | {
      status: 'loading';
    }
  | {
      status: 'plan';
      plan: PlanView;
    }
  | {
      status: 'empty';
      why: PlanReadFailure;
    }
  | {
      status: 'error';
      message: string;
    };

export function WorkflowTab() {
  const version = useInspector((state) => state.layerVersions[PLAN_LAYER_ID] ?? 0);
  const [load, setLoad] = useState<Load>({
    status: 'loading',
  });
  const [target, setTarget] = useState<Target>({
    kind: 'tree',
  });
  const [direction, setDirection] = useState<FlowDirection>(FlowDirection.Down);

  useEffect(() => {
    let live = true;
    api
      .layerState(PLAN_LAYER_ID, version)
      .then((result) => {
        if (!live) {
          return;
        }
        const plan = readPlanState(result.state);
        setLoad(
          typeof plan === 'string'
            ? {
                status: 'empty',
                why: plan,
              }
            : {
                status: 'plan',
                plan,
              },
        );
      })
      .catch((cause: unknown) => {
        if (live) {
          setLoad({
            status: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      live = false;
    };
  }, [
    version,
  ]);

  const plan = load.status === 'plan' ? load.plan : null;
  const doc = pickDocument(plan, target);
  const laidOut = useMemo(
    () => (doc ? layout(doc, direction) : null),
    [
      doc,
      direction,
    ],
  );

  if (load.status === 'error') {
    return <Notice>Could not read the plan layer: {load.message}</Notice>;
  }
  if (load.status === 'loading') {
    return <Notice>Reading the plan…</Notice>;
  }
  if (load.status === 'empty') {
    return (
      <Notice>
        {load.why === 'absent' ? (
          <>
            No plan yet. It appears once the agent calls <code>plan/setPlanTree</code>.
          </>
        ) : (
          <>The plan layer returned something this viewer does not recognise as plan state.</>
        )}
      </Notice>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        plan={load.plan}
        target={target}
        direction={direction}
        onTarget={setTarget}
        onDirection={setDirection}
      />
      <div className="min-h-0 flex-1">
        {laidOut === null && <Notice>That workflow is not in the plan.</Notice>}
        {laidOut !== null && laidOut.error !== undefined && (
          <Notice>This document could not be drawn: {laidOut.error}</Notice>
        )}
        {laidOut !== null && laidOut.error === undefined && (
          <Canvas
            // Remounting on target/direction change lets fitView re-run for the
            // new graph instead of holding the previous viewport.
            key={`${target.kind === 'tree' ? '~tree' : target.name}:${direction}`}
            laidOut={laidOut}
            plan={load.plan}
            onOpen={setTarget}
          />
        )}
      </div>
    </div>
  );
}

//#region Canvas

function Canvas({
  laidOut,
  plan,
  onOpen,
}: {
  laidOut: LaidOut;
  plan: PlanView;
  onOpen(target: Target): void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<StepFlowNode>(laidOut.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(laidOut.edges);

  useEffect(() => {
    setNodes(laidOut.nodes);
    setEdges(laidOut.edges);
  }, [
    laidOut,
    setNodes,
    setEdges,
  ]);

  // Opening a subflow is the whole point of keeping the tree small: the detail
  // lives one click away rather than crowding the plan the user reviews.
  const openRef: NodeMouseHandler<StepFlowNode> = (_event, node) => {
    const ref = node.data.node.ref;
    // hasOwn, not a truthy index: a ref of "toString" would otherwise resolve
    // to a function off Object.prototype and be handed to the projection.
    if (ref !== undefined && Object.hasOwn(plan.workflows, ref)) {
      onOpen({
        kind: 'workflow',
        name: ref,
      });
    }
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      onNodeClick={openRef}
      fitView
      fitViewOptions={{
        padding: 0.15,
      }}
      minZoom={0.2}
      proOptions={{
        hideAttribution: true,
      }}
    >
      <Background gap={16} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

//#endregion

//#region Toolbar

function Toolbar({
  plan,
  target,
  direction,
  onTarget,
  onDirection,
}: {
  plan: PlanView;
  target: Target;
  direction: FlowDirection;
  onTarget(target: Target): void;
  onDirection(direction: FlowDirection): void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
      <Picker
        label="plan tree"
        active={target.kind === 'tree'}
        disabled={plan.planTree === null}
        onSelect={() =>
          onTarget({
            kind: 'tree',
          })
        }
      />
      {Object.keys(plan.workflows)
        .sort()
        .map((name) => (
          <Picker
            key={name}
            label={name}
            active={target.kind === 'workflow' && target.name === name}
            onSelect={() =>
              onTarget({
                kind: 'workflow',
                name,
              })
            }
          />
        ))}
      <span className="flex-1" />
      {plan.rejected.length > 0 && (
        <span
          className="font-mono text-[10.5px] text-ink-3"
          title={`Unreadable: ${plan.rejected.join(', ')}`}
        >
          {plan.rejected.length} unreadable
        </span>
      )}
      <span className="font-mono text-[10.5px] text-ink-3">{plan.phase}</span>
      <button
        type="button"
        onClick={() =>
          onDirection(direction === FlowDirection.Down ? FlowDirection.Right : FlowDirection.Down)
        }
        title="Switch layout direction"
        className="rounded-[6px] px-2 py-[3px] text-[11.5px] text-ink opacity-50 transition-opacity duration-100 hover:opacity-100"
      >
        {direction === FlowDirection.Down ? '↓' : '→'}
      </button>
    </div>
  );
}

function Picker({
  label,
  active,
  disabled,
  onSelect,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
      className={`rounded-[6px] px-2 py-[3px] font-mono text-[11.5px] whitespace-nowrap text-ink transition-[background-color,opacity] duration-100 ${
        active ? 'bg-field' : 'opacity-50 hover:opacity-75'
      } ${disabled === true ? 'cursor-not-allowed opacity-25 hover:opacity-25' : ''}`}
    >
      {label}
    </button>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="p-3 text-[12.5px] text-ink-3">{children}</p>;
}

//#endregion

//#region Helpers

interface LaidOut {
  nodes: StepFlowNode[];
  edges: Edge[];
  /** Set when the document defeated the projection, so the tab reports instead of crashing. */
  error?: string;
}

/** The document the picker is pointing at, or null when that name is not in the plan. */
function pickDocument(plan: PlanView | null, target: Target): WorkflowDocument | null {
  if (plan === null) {
    return null;
  }
  if (target.kind === 'tree') {
    return plan.planTree;
  }
  // hasOwn, not a truthy index: a workflow named "toString" would otherwise
  // resolve to a function off Object.prototype and reach the projection.
  return Object.hasOwn(plan.workflows, target.name) ? (plan.workflows[target.name] ?? null) : null;
}

/**
 * The projection is defensive, but a document read back from durable storage
 * can still be shaped in a way nothing anticipated. A tab that reports the
 * failure beats an exception that unmounts the whole inspector.
 */
function layout(doc: WorkflowDocument, direction: FlowDirection): LaidOut {
  try {
    return layoutFlow(toFlow(doc), direction);
  } catch (cause) {
    return {
      nodes: [],
      edges: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

//#endregion
