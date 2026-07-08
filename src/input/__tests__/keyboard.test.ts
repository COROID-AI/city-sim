/**
 * Tests for the keyboard input layer.
 *
 * Acceptance criteria covered:
 *  - ArrowUp rotates, ArrowLeft/Right translate, ArrowDown soft-drops,
 *    Space hard-drops.
 *  - No other key triggers a game action.
 *  - Game keys call preventDefault; other keys do not.
 *  - installKeyboard returns an unsubscribe that detaches the listener.
 */
import { installKeyboard, GAME_KEYS } from "../keyboard";
import type { Action } from "../../game/state";

function makeKeyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
}

function dispatch(target: EventTarget, key: string): KeyboardEvent {
  const event = makeKeyEvent(key);
  target.dispatchEvent(event);
  return event;
}

describe("keyboard input", () => {
  it("maps every game key to the correct action", () => {
    const queue: Action[] = [];
    const target = new EventTarget();
    installKeyboard(queue, target);

    dispatch(target, "ArrowUp");
    dispatch(target, "ArrowLeft");
    dispatch(target, "ArrowRight");
    dispatch(target, "ArrowDown");
    dispatch(target, " ");

    expect(queue).toEqual([
      { type: "Rotate" },
      { type: "MoveLeft" },
      { type: "MoveRight" },
      { type: "SoftDrop" },
      { type: "HardDrop" },
    ]);
  });

  it("ignores every non-game key and pushes nothing", () => {
    const queue: Action[] = [];
    const target = new EventTarget();
    installKeyboard(queue, target);

    for (const key of ["a", "Enter", "Escape", "Shift", "w", "1", "Tab"]) {
      dispatch(target, key);
    }

    expect(queue).toHaveLength(0);
  });

  it("calls preventDefault on game keys so the page does not scroll", () => {
    const queue: Action[] = [];
    const target = new EventTarget();
    installKeyboard(queue, target);

    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "]) {
      const event = dispatch(target, key);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("does not preventDefault on non-game keys", () => {
    const queue: Action[] = [];
    const target = new EventTarget();
    installKeyboard(queue, target);

    const event = dispatch(target, "a");
    expect(event.defaultPrevented).toBe(false);
  });

  it("honours browser key-repeat by producing repeated actions", () => {
    const queue: Action[] = [];
    const target = new EventTarget();
    installKeyboard(queue, target);

    // Simulate holding ArrowLeft: the browser fires repeated keydown events.
    for (let i = 0; i < 5; i++) {
      dispatch(target, "ArrowLeft");
    }

    expect(queue).toHaveLength(5);
    expect(queue.every((a) => a.type === "MoveLeft")).toBe(true);
  });

  it("unsubscribe detaches the listener so no more actions are queued", () => {
    const queue: Action[] = [];
    const target = new EventTarget();
    const unsubscribe = installKeyboard(queue, target);

    dispatch(target, "ArrowLeft");
    expect(queue).toHaveLength(1);

    unsubscribe();

    dispatch(target, "ArrowLeft");
    dispatch(target, " ");
    expect(queue).toHaveLength(1);
  });

  it("GAME_KEYS contains exactly the five control keys", () => {
    expect(GAME_KEYS.has("ArrowUp")).toBe(true);
    expect(GAME_KEYS.has("ArrowLeft")).toBe(true);
    expect(GAME_KEYS.has("ArrowRight")).toBe(true);
    expect(GAME_KEYS.has("ArrowDown")).toBe(true);
    expect(GAME_KEYS.has(" ")).toBe(true);
    expect(GAME_KEYS.size).toBe(5);
  });
});
