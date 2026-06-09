'use client';

import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { Camera, GameLoop, type CameraTransform, type StepCallback } from '@/engine';

export interface CityViewEngineHandle {
  /** Read the current (smoothed) camera transform. */
  getCameraTransform: () => CameraTransform;
  /** Register a per-simulation-step callback. Returns an unsubscribe. */
  onStepRegister: (fn: StepCallback) => () => void;
  /** Pause the simulation loop. */
  pause: () => void;
  /** Resume the simulation loop. */
  resume: () => void;
}

export interface CityViewProps {
  /** Forwarded ref to access the engine handle from parent components. */
  engineRef?: Ref<CityViewEngineHandle | null>;
  /** Optional CSS class for the outer container. */
  className?: string;
}

/**
 * CityView — mounts the game engine (Camera + GameLoop) and renders a
 * fullscreen container that downstream rendering layers can attach to.
 *
 * This component is intentionally thin: the simulation, time, citizens, and
 * rendering layers all plug in via the engine handle and the container ref.
 *
 * Interaction: pointer drag pans, wheel zooms (cursor-anchored).
 */
export function CityView({ engineRef, className }: CityViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const dragStateRef = useRef<{ x: number; y: number } | null>(null);

  // Lazily create the engine once. We do this in a ref-initializer style
  // (computed once) to avoid re-creating the loop on every render.
  const engine = useMemo(() => {
    const camera = new Camera();
    const loop = new GameLoop();
    return { camera, loop };
  }, []);

  // Expose engine + camera to refs so the imperative API is stable.
  cameraRef.current = engine.camera;
  loopRef.current = engine.loop;

  useImperativeHandle<CityViewEngineHandle | null, CityViewEngineHandle | null>(
    engineRef ?? null,
    (): CityViewEngineHandle => ({
      getCameraTransform: (): CameraTransform => engine.camera.getTransform(),
      onStepRegister: (fn: StepCallback): (() => void) => engine.loop.onStep(fn),
      pause: (): void => {
        engine.loop.stop();
      },
      resume: (): void => {
        engine.loop.start();
      },
    }),
    [engine],
  );

  useEffect(() => {
    const camera = engine.camera;
    const loop = engine.loop;
    let unsubStep: (() => void) | null = null;

    // Smooth camera each render frame.
    unsubStep = loop.onStep((dt: number): void => {
      camera.update(dt);
    });

    loop.start();

    return (): void => {
      if (unsubStep) {
        unsubStep();
        unsubStep = null;
      }
      loop.stop();
    };
  }, [engine]);

  // Pointer / wheel interaction delegated on the container. We avoid
  // interfering with interactive children by checking event target.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onPointerDown = (ev: PointerEvent): void => {
      if (ev.button !== 0) return;
      // Don't start a pan if the pointer began on an interactive element.
      const target = ev.target as HTMLElement | null;
      if (target && target.closest('button, a, input, [data-no-pan="true"]')) {
        return;
      }
      dragStateRef.current = { x: ev.clientX, y: ev.clientY };
      el.setPointerCapture(ev.pointerId);
    };

    const onPointerMove = (ev: PointerEvent): void => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const camera = cameraRef.current;
      if (!camera) return;
      const dxScreen = ev.clientX - drag.x;
      const dyScreen = ev.clientY - drag.y;
      dragStateRef.current = { x: ev.clientX, y: ev.clientY };
      // Convert pixel deltas to world units: divide by zoom and container size.
      const rect = el.getBoundingClientRect();
      const t = camera.getTransform();
      const worldPerPixelX = 1 / (rect.width * t.zoom);
      const worldPerPixelY = 1 / (rect.height * t.zoom);
      camera.pan(-dxScreen * worldPerPixelX, -dyScreen * worldPerPixelY);
    };

    const onPointerUp = (ev: PointerEvent): void => {
      if (dragStateRef.current) {
        el.releasePointerCapture(ev.pointerId);
        dragStateRef.current = null;
      }
    };

    const onWheel = (ev: WheelEvent): void => {
      const camera = cameraRef.current;
      if (!camera) return;
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchorX = (ev.clientX - rect.left) / rect.width;
      const anchorY = (ev.clientY - rect.top) / rect.height;
      // Wheel up (negative deltaY) zooms in.
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      camera.zoomAt(factor, anchorX, anchorY);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    return (): void => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-city-view
      className={
        'relative h-full w-full overflow-hidden bg-surface touch-none ' +
        (className ?? '')
      }
    />
  );
}

export default CityView;
