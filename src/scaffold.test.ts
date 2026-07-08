/**
 * Scaffold sanity test.
 *
 * Verifies the ts-jest + jsdom toolchain is wired correctly so that `npm test`
 * exits 0 and downstream game-logic tasks have a working harness to build on.
 * Real game-logic tests arrive with the "pure Tetris game logic" task.
 */

describe("scaffold toolchain", () => {
  it("runs TypeScript through ts-jest", () => {
    const add = (a: number, b: number): number => a + b;
    expect(add(2, 3)).toBe(5);
  });

  it("provides a jsdom DOM environment", () => {
    expect(document).toBeDefined();
    const el = document.createElement("div");
    el.id = "board";
    document.body.appendChild(el);
    expect(document.getElementById("board")).not.toBeNull();
  });
});
