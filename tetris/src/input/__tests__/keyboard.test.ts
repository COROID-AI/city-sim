import { describe, it, expect, vi } from "vitest";
import { createKeyboardController } from "../keyboard";

/** Dispatch a keyboard event on an element. */
function dispatchKey(
  el: HTMLElement | Window,
  type: "keydown" | "keyup",
  key: string,
): void {
  const event = new KeyboardEvent(type, { key });
  el.dispatchEvent(event);
}

describe("keyboard adapter", () => {
  it("ArrowLeft calls onMove(-1)", () => {
    const onMove = vi.fn();
    const onRotate = vi.fn();
    const onSoftDrop = vi.fn();
    const ctrl = createKeyboardController({ onMove, onRotate, onSoftDrop });
    const el = document.createElement("div");
    ctrl.attach(el);
    dispatchKey(el, "keydown", "ArrowLeft");
    expect(onMove).toHaveBeenCalledWith(-1);
    expect(onRotate).not.toHaveBeenCalled();
    ctrl.detach();
  });

  it("ArrowRight calls onMove(+1)", () => {
    const onMove = vi.fn();
    const ctrl = createKeyboardController({
      onMove,
      onRotate: vi.fn(),
      onSoftDrop: vi.fn(),
    });
    const el = document.createElement("div");
    ctrl.attach(el);
    dispatchKey(el, "keydown", "ArrowRight");
    expect(onMove).toHaveBeenCalledWith(1);
    ctrl.detach();
  });

  it("ArrowUp calls onRotate", () => {
    const onRotate = vi.fn();
    const ctrl = createKeyboardController({
      onMove: vi.fn(),
      onRotate,
      onSoftDrop: vi.fn(),
    });
    const el = document.createElement("div");
    ctrl.attach(el);
    dispatchKey(el, "keydown", "ArrowUp");
    expect(onRotate).toHaveBeenCalledTimes(1);
    ctrl.detach();
  });

  it("ArrowDown calls onSoftDrop(true) on keydown", () => {
    const onSoftDrop = vi.fn();
    const ctrl = createKeyboardController({
      onMove: vi.fn(),
      onRotate: vi.fn(),
      onSoftDrop,
    });
    const el = document.createElement("div");
    ctrl.attach(el);
    dispatchKey(el, "keydown", "ArrowDown");
    expect(onSoftDrop).toHaveBeenCalledWith(true);
    ctrl.detach();
  });

  it("ArrowUp key (release) of ArrowDown calls onSoftDrop(false)", () => {
    const onSoftDrop = vi.fn();
    const ctrl = createKeyboardController({
      onMove: vi.fn(),
      onRotate: vi.fn(),
      onSoftDrop,
    });
    const el = document.createElement("div");
    ctrl.attach(el);
    dispatchKey(el, "keydown", "ArrowDown");
    dispatchKey(el, "keyup", "ArrowDown");
    expect(onSoftDrop).toHaveBeenLastCalledWith(false);
    ctrl.detach();
  });

  it("non-arrow keys ('a') do not trigger any callback", () => {
    const onMove = vi.fn();
    const onRotate = vi.fn();
    const onSoftDrop = vi.fn();
    const ctrl = createKeyboardController({ onMove, onRotate, onSoftDrop });
    const el = document.createElement("div");
    ctrl.attach(el);
    dispatchKey(el, "keydown", "a");
    dispatchKey(el, "keydown", " ");
    dispatchKey(el, "keydown", "Enter");
    dispatchKey(el, "keydown", "p");
    expect(onMove).not.toHaveBeenCalled();
    expect(onRotate).not.toHaveBeenCalled();
    expect(onSoftDrop).not.toHaveBeenCalled();
    ctrl.detach();
  });

  it("suppresses OS auto-repeat within the repeat window", () => {
    const onRotate = vi.fn();
    const ctrl = createKeyboardController({
      onMove: vi.fn(),
      onRotate,
      onSoftDrop: vi.fn(),
    });
    const el = document.createElement("div");
    ctrl.attach(el);
    // First keydown fires.
    dispatchKey(el, "keydown", "ArrowUp");
    // Immediate repeated keydown (simulating OS auto-repeat) is suppressed.
    dispatchKey(el, "keydown", "ArrowUp");
    dispatchKey(el, "keydown", "ArrowUp");
    expect(onRotate).toHaveBeenCalledTimes(1);
    ctrl.detach();
  });

  it("attaching twice does not produce duplicate callbacks", () => {
    const onMove = vi.fn();
    const ctrl = createKeyboardController({
      onMove,
      onRotate: vi.fn(),
      onSoftDrop: vi.fn(),
    });
    const el = document.createElement("div");
    ctrl.attach(el);
    ctrl.attach(el); // re-attach should detach first
    dispatchKey(el, "keydown", "ArrowLeft");
    expect(onMove).toHaveBeenCalledTimes(1);
    ctrl.detach();
  });

  it("detach removes listeners so no callbacks fire", () => {
    const onMove = vi.fn();
    const ctrl = createKeyboardController({
      onMove,
      onRotate: vi.fn(),
      onSoftDrop: vi.fn(),
    });
    const el = document.createElement("div");
    ctrl.attach(el);
    ctrl.detach();
    dispatchKey(el, "keydown", "ArrowLeft");
    expect(onMove).not.toHaveBeenCalled();
  });
});
