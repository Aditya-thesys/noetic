/**
 * One zustand store for everything the SSE streams touch. Chat items are kept
 * in insertion order and upserted by id — streaming snapshots for the same
 * item replace in place, so the message list re-renders without duplication.
 */

import { create } from 'zustand';
import type {
  ConsoleLine,
  ForwardedEvent,
  HostEvent,
  LastLayerUsage,
  LayerInfo,
  StreamingItem,
} from '../server/wire-types';
import { idOf } from './items';

const MAX_EVENTS = 500;
const MAX_CONSOLE_LINES = 1e3;

export interface InspectorStore {
  // chat
  order: string[];
  itemsById: Record<string, StreamingItem>;
  generating: boolean;
  upsertItem(item: StreamingItem): void;
  setHistory(items: StreamingItem[]): void;
  setGenerating(generating: boolean): void;

  // host / child lifecycle
  host?: HostEvent;
  setHost(host: HostEvent): void;

  // inspector data
  layers: LayerInfo[];
  setLayers(layers: LayerInfo[]): void;
  /** Bumped per layer_state event; layer tabs refetch when visible and dirty. */
  layerVersions: Record<string, number>;
  bumpLayer(layerId: string): void;
  /** Version last viewed per layer — a tab wears an alert badge while its
   *  layerVersion is ahead of this. */
  layerSeen: Record<string, number>;
  markLayerSeen(layerId: string): void;

  usage?: LastLayerUsage;
  setUsage(usage: LastLayerUsage): void;

  previewVersion: number;
  invalidatePreview(): void;

  events: SequencedEvent[];
  pushEvent(event: ForwardedEvent): void;

  consoleLines: ConsoleLine[];
  pushConsoleLine(line: ConsoleLine): void;
  setConsoleLines(lines: ConsoleLine[]): void;

  /** Clear everything session-scoped after POST /api/reset — the fresh child
   *  reports empty history/layers on its child_ready refetch. */
  resetSession(): void;
}

/** Events carry a monotonic seq so list rows keep stable keys through the cap. */
export interface SequencedEvent {
  seq: number;
  event: ForwardedEvent;
}

let eventSeq = 0;

export const useInspector = create<InspectorStore>((set) => ({
  order: [],
  itemsById: {},
  generating: false,

  upsertItem: (item) =>
    set((state) => {
      const id = idOf(item);
      return {
        itemsById: {
          ...state.itemsById,
          [id]: item,
        },
        order: state.order.includes(id)
          ? state.order
          : [
              ...state.order,
              id,
            ],
      };
    }),

  setHistory: (items) =>
    set(() => ({
      order: items.map(idOf),
      itemsById: Object.fromEntries(
        items.map((item) => [
          idOf(item),
          item,
        ]),
      ),
    })),

  setGenerating: (generating) =>
    set({
      generating,
    }),

  setHost: (host) =>
    set({
      host,
    }),

  layers: [],
  setLayers: (layers) =>
    set({
      layers,
    }),
  layerVersions: {},
  bumpLayer: (layerId) =>
    set((state) => ({
      layerVersions: {
        ...state.layerVersions,
        [layerId]: (state.layerVersions[layerId] ?? 0) + 1,
      },
    })),
  layerSeen: {},
  markLayerSeen: (layerId) =>
    set((state) => {
      const version = state.layerVersions[layerId] ?? 0;
      if ((state.layerSeen[layerId] ?? 0) === version) {
        return state;
      }
      return {
        layerSeen: {
          ...state.layerSeen,
          [layerId]: version,
        },
      };
    }),

  setUsage: (usage) =>
    set({
      usage,
    }),

  previewVersion: 0,
  invalidatePreview: () =>
    set((state) => ({
      previewVersion: state.previewVersion + 1,
    })),

  events: [],
  pushEvent: (event) =>
    set((state) => {
      eventSeq += 1;
      return {
        events: [
          ...state.events.slice(-(MAX_EVENTS - 1)),
          {
            seq: eventSeq,
            event,
          },
        ],
      };
    }),

  consoleLines: [],
  pushConsoleLine: (line) =>
    set((state) => ({
      consoleLines: [
        ...state.consoleLines.slice(-(MAX_CONSOLE_LINES - 1)),
        line,
      ],
    })),
  setConsoleLines: (lines) =>
    set({
      consoleLines: lines,
    }),

  resetSession: () =>
    set((state) => ({
      order: [],
      itemsById: {},
      generating: false,
      usage: undefined,
      events: [],
      layerVersions: {},
      layerSeen: {},
      previewVersion: state.previewVersion + 1,
    })),
}));
