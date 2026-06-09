// Minimal local type stubs to enable standalone strict typechecking of
// CityView.tsx and TimeControls.tsx without depending on a full Node
// modules install. This file is consumed ONLY by tsconfig.check.json
// and is excluded from the real build by not being listed in the
// project tsconfig.

declare module 'react' {
  export type Ref<T> = { current: T | null } | ((instance: T | null) => void);
  export function useRef<T>(initial: T | null): { current: T | null };
  export function useRef<T>(initial: T): { current: T };
  export function useRef<T = undefined>(): { current: T | undefined };
  export function useMemo<T>(factory: () => T, deps: ReadonlyArray<unknown>): T;
  export function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<unknown>): void;
  export function useImperativeHandle<T, R>(
    ref: Ref<T> | null | undefined,
    init: () => R,
    deps?: ReadonlyArray<unknown>,
  ): void;
  export function useState<T>(initial: T): [T, (v: T) => void];
  export function useState<T = undefined>(): [T | undefined, (v: T | undefined) => void];
  export interface PointerEvent {
    button: number;
    clientX: number;
    clientY: number;
    pointerId: number;
    target: EventTarget | null;
  }
  export interface WheelEvent {
    clientX: number;
    clientY: number;
    deltaY: number;
    preventDefault(): void;
  }
  export type JSX = unknown;
  export const Fragment: unknown;
}
