'use client';

import { HostStatusBanner } from '../components/HostStatusBanner';
import { LeftTabs } from '../components/left/LeftTabs';
import { InspectorTabs } from '../components/right/InspectorTabs';
import { useAgentStream, useHostEvents } from '../lib/streams';

export default function Page() {
  useAgentStream();
  useHostEvents();

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <HostStatusBanner />
      <main className="grid min-h-0 flex-1 grid-cols-2 gap-2 p-2">
        <LeftTabs />
        <InspectorTabs />
      </main>
    </div>
  );
}
