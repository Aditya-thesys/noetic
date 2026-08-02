import { beforeEach, describe, expect, it } from 'bun:test';
import { useInspector } from '../lib/store';

function hasUnseenChange(layerId: string): boolean {
  const state = useInspector.getState();
  return (state.layerVersions[layerId] ?? 0) > (state.layerSeen[layerId] ?? 0);
}

describe('layer alert badges', () => {
  beforeEach(() => {
    useInspector.setState({
      layerVersions: {},
      layerSeen: {},
    });
  });

  it('a layer_state bump raises the badge', () => {
    expect(hasUnseenChange('plan')).toBe(false);
    useInspector.getState().bumpLayer('plan');
    expect(hasUnseenChange('plan')).toBe(true);
  });

  it('viewing the tab clears the badge', () => {
    useInspector.getState().bumpLayer('plan');
    useInspector.getState().markLayerSeen('plan');
    expect(hasUnseenChange('plan')).toBe(false);
  });

  it('a change after viewing raises the badge again', () => {
    useInspector.getState().bumpLayer('plan');
    useInspector.getState().markLayerSeen('plan');
    useInspector.getState().bumpLayer('plan');
    expect(hasUnseenChange('plan')).toBe(true);
  });

  it('badges are per layer', () => {
    useInspector.getState().bumpLayer('plan');
    expect(hasUnseenChange('working-memory')).toBe(false);
  });

  it('marking an untouched layer seen is a no-op state-wise', () => {
    const before = useInspector.getState().layerSeen;
    useInspector.getState().markLayerSeen('plan');
    expect(useInspector.getState().layerSeen).toBe(before);
  });
});
