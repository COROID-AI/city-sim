/**
 * Shared fly-mode input state.
 *
 * The fly controller reads the active movement key codes every frame, and
 * both the global keyboard handler and the on-screen touch buttons write to
 * the same {@link flyKeys} set. This lets mouse, touch, and keyboard all
 * drive the same movement logic without duplicating per-input plumbing.
 */

/** Active fly-movement key codes (e.g. "KeyW", "ArrowUp", "Space"). */
export const flyKeys = new Set<string>();

/** Add or remove a virtual fly-movement key (used by touch buttons). */
export function setFlyKey(code: string, active: boolean): void {
  if (active) flyKeys.add(code);
  else flyKeys.delete(code);
}

/**
 * True when the event target is an interactive control we should not hijack
 * (a button, input, select, textarea, slider, or contenteditable region).
 * Prevents fly-mode keys from clashing with the timeline slider or other UI.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'button, input, select, textarea, [role="button"], [role="slider"], [contenteditable="true"]',
    ),
  );
}
