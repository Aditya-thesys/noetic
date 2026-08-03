'use client';

/**
 * The inspector pane: one tab per memory layer (roster from /layers, already
 * slot-sorted server-side) plus the fixed Context / Composition / Events /
 * Trace views. A layer tab wears an alert badge when its state changed since
 * the user last looked at it; viewing the tab clears the badge (including
 * for changes that land while it is open).
 */

import { useEffect, useState } from 'react';
import { useInspector } from '../../lib/store';
import { CompositionTab } from './CompositionTab';
import { ConsoleTab } from './ConsoleTab';
import { ContextWindowTab } from './ContextWindowTab';
import { EventsTab } from './EventsTab';
import { LayerTab } from './LayerTab';
import { TraceTab } from './TraceTab';
import { WorkflowTab } from './WorkflowTab';

const FIXED_TABS = [
  'Context',
  'Composition',
  'Workflow',
  'Events',
  'Console',
  'Trace',
] as const;

export function InspectorTabs() {
  const layers = useInspector((state) => state.layers);
  const layerVersions = useInspector((state) => state.layerVersions);
  const layerSeen = useInspector((state) => state.layerSeen);
  const markLayerSeen = useInspector((state) => state.markLayerSeen);
  const [active, setActive] = useState<string>('Context');

  const activeLayer = layers.find((layer) => `layer:${layer.id}` === active);
  const activeLayerId = activeLayer?.id;
  const _activeLayerVersion = activeLayerId !== undefined ? (layerVersions[activeLayerId] ?? 0) : 0;

  // Viewing a layer keeps it "seen", so a change arriving while its tab is
  // open never leaves a stale badge behind.
  useEffect(() => {
    if (activeLayerId !== undefined) {
      markLayerSeen(activeLayerId);
    }
  }, [
    activeLayerId,
    markLayerSeen,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-card bg-surface shadow-card">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line p-1.5">
        {FIXED_TABS.map((name) => (
          <TabButton key={name} name={name} active={active === name} onSelect={setActive} />
        ))}
        {layers.length > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />}
        {layers.map((layer) => (
          <TabButton
            key={layer.id}
            name={`layer:${layer.id}`}
            label={layer.name ?? layer.id}
            active={active === `layer:${layer.id}`}
            changed={(layerVersions[layer.id] ?? 0) > (layerSeen[layer.id] ?? 0)}
            onSelect={setActive}
          />
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {active === 'Context' && <ContextWindowTab />}
        {active === 'Composition' && <CompositionTab />}
        {active === 'Workflow' && <WorkflowTab />}
        {active === 'Events' && <EventsTab />}
        {active === 'Console' && <ConsoleTab />}
        {active === 'Trace' && <TraceTab />}
        {activeLayer !== undefined && <LayerTab key={activeLayer.id} layer={activeLayer} />}
        {active.startsWith('layer:') && activeLayer === undefined && layers.length === 0 && (
          <p className="p-3 text-[12.5px] text-ink-3">Layer roster loading…</p>
        )}
      </div>
    </div>
  );
}

function TabButton({
  name,
  label,
  active,
  changed,
  onSelect,
}: {
  name: string;
  label?: string;
  active: boolean;
  changed?: boolean;
  onSelect(name: string): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={changed === true ? 'State changed since last viewed' : undefined}
      onClick={() => onSelect(name)}
      className={`relative rounded-[6px] px-2 py-[3px] text-[12.5px] whitespace-nowrap text-ink transition-[background-color,opacity] duration-100 ${
        active ? 'bg-field' : 'opacity-50 hover:opacity-75'
      }`}
    >
      {label ?? name}
      {changed === true && (
        <span
          aria-hidden
          className="absolute top-0 right-0.5 size-1.5 rounded-full bg-accent"
          style={{
            animation: 'pop-in 250ms cubic-bezier(0.23,1,0.32,1) both',
          }}
        />
      )}
    </button>
  );
}
