/**
 * Places a control-flow graph on a canvas.
 *
 * Dagre does the work: it is a layered ("Sugiyama") layout, which is exactly
 * the shape a workflow wants — rank by execution order, then shuffle nodes
 * within a rank to pull the crossings out. Back edges from `loop` and `every`
 * are held out of the ranking pass, because a cycle has no layering; feeding
 * them in makes dagre break the cycle itself, at an edge of its choosing, and
 * the picture stops matching the plan.
 */

import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType, Position } from '@xyflow/react';
import type { GraphNode, WorkflowFlow } from './workflow-graph';

//#region Types

/** Layout direction. Top-to-bottom reads like a plan; left-to-right suits wide fan-outs. */
export const FlowDirection = {
  Down: 'TB',
  Right: 'LR',
} as const;

export type FlowDirection = (typeof FlowDirection)[keyof typeof FlowDirection];

/** A node's data as it reaches the React component. */
export interface StepNodeData extends Record<string, unknown> {
  node: GraphNode;
  /** Which way the flow runs, so the node knows where to put its handles. */
  direction: FlowDirection;
}

/** Handle ids. Forward flow uses `in`/`out`; a loop's return path uses the side pair. */
export const Handles = {
  In: 'in',
  Out: 'out',
  BackIn: 'back-in',
  BackOut: 'back-out',
} as const;

/** A placed node. The canvas registers `StepNode` under the `step` type. */
export type StepFlowNode = Node<StepNodeData, 'step'>;

export interface LaidOutFlow {
  nodes: StepFlowNode[];
  edges: Edge[];
}

//#endregion

//#region Sizing

const STEP_WIDTH = 232;
const GATE_WIDTH = 176;
const TERMINAL_WIDTH = 84;

const TITLE_HEIGHT = 30;
const DETAIL_HEIGHT = 34;
const CHIP_ROW_HEIGHT = 22;
const TERMINAL_HEIGHT = 32;

/** Chips wrap at roughly this width, so long lists need more rows. */
const CHIPS_PER_ROW = 2;

export function nodeWidth(node: GraphNode): number {
  if (node.shape === 'terminal') {
    return TERMINAL_WIDTH;
  }
  return node.shape === 'gate' ? GATE_WIDTH : STEP_WIDTH;
}

export function nodeHeight(node: GraphNode): number {
  if (node.shape === 'terminal') {
    return TERMINAL_HEIGHT;
  }
  const chipRows = Math.ceil(node.chips.length / CHIPS_PER_ROW);
  return TITLE_HEIGHT + (node.detail ? DETAIL_HEIGHT : 0) + chipRows * CHIP_ROW_HEIGHT + 12;
}

//#endregion

//#region Public API

/** Ranks the flow and returns nodes and edges ready to hand to React Flow. */
export function layoutFlow(flow: WorkflowFlow, direction: FlowDirection): LaidOutFlow {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    // Loose enough that edge labels ("default", a route's match string) have
    // somewhere to sit without colliding with the nodes they describe.
    ranksep: direction === FlowDirection.Down ? 56 : 76,
    nodesep: 28,
    marginx: 16,
    marginy: 16,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of flow.nodes) {
    graph.setNode(node.id, {
      width: nodeWidth(node),
      height: nodeHeight(node),
    });
  }
  for (const edge of flow.edges) {
    if (edge.variant !== 'back') {
      graph.setEdge(edge.from, edge.to);
    }
  }

  dagre.layout(graph);

  const flowing = direction === FlowDirection.Down;
  const nodes: StepFlowNode[] = flow.nodes.map((node) => {
    const placed = graph.node(node.id);
    const width = nodeWidth(node);
    const height = nodeHeight(node);
    return {
      id: node.id,
      type: 'step',
      // Dagre centres nodes; React Flow positions by top-left corner.
      position: {
        x: placed.x - width / 2,
        y: placed.y - height / 2,
      },
      data: {
        node,
        direction,
      },
      // The same box dagre reserved, applied to the DOM. Without this the node
      // renders at its content's natural width — far wider than the slot it was
      // given — and siblings overlap.
      style: {
        width,
        height,
      },
      sourcePosition: flowing ? Position.Bottom : Position.Right,
      targetPosition: flowing ? Position.Top : Position.Left,
    };
  });

  return {
    nodes,
    edges: flow.edges.map(toReactFlowEdge),
  };
}

//#endregion

//#region Edges

function toReactFlowEdge(edge: WorkflowFlow['edges'][number]): Edge {
  const back = edge.variant === 'back';
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    type: back ? 'smoothstep' : 'default',
    animated: back,
    // A back edge leaves the side of its node rather than its end, so the
    // return path stays clear of the forward flow it runs against.
    sourceHandle: back ? Handles.BackOut : Handles.Out,
    targetHandle: back ? Handles.BackIn : Handles.In,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
    },
    style: {
      strokeWidth: 1.5,
      strokeDasharray: edge.variant === 'isolated' ? '5 4' : undefined,
    },
    labelStyle: {
      fontSize: 10.5,
    },
    labelBgPadding: [
      4,
      2,
    ],
    labelBgBorderRadius: 3,
  };
}

//#endregion
