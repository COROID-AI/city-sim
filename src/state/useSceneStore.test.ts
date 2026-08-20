import { describe, it, expect, beforeEach } from 'vitest';
import { useSceneStore } from './useSceneStore';
import { ERA_COUNT } from './timePeriods';

describe('useSceneStore', () => {
  beforeEach(() => {
    useSceneStore.setState({
      playing: false,
      muted: false,
      volume: 0.8,
      position: 1,
      dayTime: 0.72,
    });
  });

  it('clamps setEraIndex within bounds', () => {
    useSceneStore.getState().setEraIndex(-5);
    expect(useSceneStore.getState().position).toBe(0);
    useSceneStore.getState().setEraIndex(999);
    expect(useSceneStore.getState().position).toBe(ERA_COUNT - 1);
  });

  it('scrubTo clamps and interpolates current', () => {
    useSceneStore.getState().scrubTo(ERA_COUNT + 3);
    expect(useSceneStore.getState().position).toBe(ERA_COUNT - 1);
    useSceneStore.getState().scrubTo(-2);
    expect(useSceneStore.getState().position).toBe(0);
    useSceneStore.getState().scrubTo(0.5);
    expect(useSceneStore.getState().position).toBeCloseTo(0.5, 5);
    expect(useSceneStore.getState().current.year).toBe(1910);
  });

  it('togglePlayback flips the flag', () => {
    expect(useSceneStore.getState().playing).toBe(false);
    useSceneStore.getState().togglePlayback();
    expect(useSceneStore.getState().playing).toBe(true);
  });

  it('toggleMute flips the flag', () => {
    expect(useSceneStore.getState().muted).toBe(false);
    useSceneStore.getState().toggleMute();
    expect(useSceneStore.getState().muted).toBe(true);
  });

  it('volume clamps to [0,1]', () => {
    useSceneStore.getState().setVolume(5);
    expect(useSceneStore.getState().volume).toBe(1);
    useSceneStore.getState().setVolume(-2);
    expect(useSceneStore.getState().volume).toBe(0);
  });
});