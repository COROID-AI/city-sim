import { Bag } from './bag';
import {
  canPlace,
  clearLines,
  collides,
  createBoard,
  ghostPiece,
  merge,
} from './board';
import {
  FIRST_VISIBLE_ROW,
  LOCK_DELAY_MS,
  LOCK_DELAY_RESET_CAP,
  NEXT_PIECES_VISIBLE,
  QUEUE_KEEP_ALIVE,
} from './constants';
import {
  gravityMsForLevel,
  hardDropScore,
  levelForLines,
  scoreForLines,
  softDropScore,
} from './scoring';
import { tryRotate } from './srs';
import { pieceCells, spawnPiece } from './tetrominoes';
import type {
  BoardGrid,
  GameStatus,
  Piece,
  RotateDirection,
  TetrominoType,
} from './types';

export interface EngineState {
  status: GameStatus;
  board: BoardGrid;
  active: Piece | null;
  hold: TetrominoType | null;
  holdUsed: boolean;
  queue: TetrominoType[];
  score: number;
  lines: number;
  level: number;
  gravityMs: number;
  gravityAccumMs: number;
  lockAccumMs: number;
  lockResets: number;
  grounded: boolean;
  gameOverReason: 'lockout' | 'spawn' | null;
  lastClear: { rows: number[]; at: number } | null;
}

/**
 * Frame-rate independent game engine: gravity, soft/hard drops, lock delay
 * (with capped resets on player moves/rotations), hold, line clears and
 * Guideline scoring. DOM-free so it can be unit tested in Node.
 */
export class Engine {
  state: EngineState;
  private bag: Bag;

  constructor(rng?: () => number) {
    this.bag = new Bag(rng);
    this.state = this.freshState();
  }

  private freshState(): EngineState {
    return {
      status: 'idle',
      board: createBoard(),
      active: null,
      hold: null,
      holdUsed: false,
      queue: [],
      score: 0,
      lines: 0,
      level: 1,
      gravityMs: gravityMsForLevel(1),
      gravityAccumMs: 0,
      lockAccumMs: 0,
      lockResets: 0,
      grounded: false,
      gameOverReason: null,
      lastClear: null,
    };
  }

  start(): void {
    this.state = this.freshState();
    this.refillQueue();
    this.state.status = 'playing';
    this.spawn();
  }

  /** Upcoming pieces shown in the "Next" panel. */
  getQueuePreview(): TetrominoType[] {
    return this.state.queue.slice(0, NEXT_PIECES_VISIBLE);
  }

  getGhost(): Piece | null {
    const { active, board } = this.state;
    return active ? ghostPiece(board, active) : null;
  }

  togglePause(): void {
    if (this.state.status === 'playing') this.state.status = 'paused';
    else if (this.state.status === 'paused') this.state.status = 'playing';
  }

  /** Advance gravity + lock delay by `dtMs`. */
  update(dtMs: number): void {
    const s = this.state;
    if (s.status !== 'playing' || !s.active) return;

    if (!s.grounded) {
      s.gravityAccumMs += dtMs;
      while (s.gravityAccumMs >= s.gravityMs) {
        s.gravityAccumMs -= s.gravityMs;
        if (canPlace(s.board, { ...s.active, y: s.active.y + 1 })) {
          s.active.y++;
        } else {
          s.grounded = true;
          s.gravityAccumMs = 0;
          s.lockAccumMs = 0;
          s.lockResets = 0;
          break;
        }
      }
      // Clamp a residual accumulator so a landed piece never over-ticks.
      if (s.grounded) s.gravityAccumMs = 0;
    } else {
      s.lockAccumMs += dtMs;
      if (s.lockAccumMs >= LOCK_DELAY_MS) this.lock();
    }
  }

  moveLeft(): boolean {
    return this.moveHorizontal(-1);
  }

  moveRight(): boolean {
    return this.moveHorizontal(1);
  }

  private moveHorizontal(dx: number): boolean {
    const s = this.state;
    if (s.status !== 'playing' || !s.active) return false;
    const wasGrounded = s.grounded;
    if (this.tryMoveActive(dx, 0)) {
      this.onPlayerSuccess(wasGrounded);
      return true;
    }
    return false;
  }

  /** Soft drop one row at a time until grounded; returns rows moved. */
  softDrop(): number {
    const s = this.state;
    if (s.status !== 'playing' || !s.active) return 0;
    const wasGrounded = s.grounded;
    let rows = 0;
    while (this.tryMoveActive(0, 1)) rows++;
    if (rows > 0) {
      s.score += softDropScore(rows);
      this.onPlayerSuccess(wasGrounded);
    }
    return rows;
  }

  /** Instantly drop to the ghost position, score, and lock. */
  hardDrop(): number {
    const s = this.state;
    if (s.status !== 'playing' || !s.active) return 0;
    const ghost = ghostPiece(s.board, s.active);
    const rows = ghost.y - s.active.y;
    if (rows > 0) {
      s.active = ghost;
      s.score += hardDropScore(rows);
    }
    this.lock();
    return rows;
  }

  rotateCW(): boolean {
    return this.rotate('cw');
  }

  rotateCCW(): boolean {
    return this.rotate('ccw');
  }

  private rotate(dir: RotateDirection): boolean {
    const s = this.state;
    if (s.status !== 'playing' || !s.active) return false;
    const wasGrounded = s.grounded;
    const next = tryRotate(s.board, s.active, dir);
    if (next) {
      s.active = next;
      this.onPlayerSuccess(wasGrounded);
      return true;
    }
    return false;
  }

  /** Swap the active piece with the hold slot (once per piece). */
  hold(): boolean {
    const s = this.state;
    if (s.status !== 'playing' || !s.active || s.holdUsed) return false;
    const current = s.active.type;
    const swap = s.hold;
    s.hold = current;
    s.active = null;
    if (swap === null) {
      this.spawn();
    } else {
      this.spawnPieceOfType(swap);
    }
    // The piece that now spawns is part of the same hold turn: it cannot be
    // held again until it locks.
    s.holdUsed = true;
    return true;
  }

  private tryMoveActive(dx: number, dy: number): boolean {
    const s = this.state;
    if (!s.active) return false;
    const candidate = { ...s.active, x: s.active.x + dx, y: s.active.y + dy };
    if (canPlace(s.board, candidate)) {
      s.active = candidate;
      return true;
    }
    return false;
  }

  /**
   * After a successful player move/rotation/soft drop while the piece is
   * grounded, reset the lock delay — capped so a piece cannot stall forever.
   */
  private onPlayerSuccess(wasGrounded: boolean): void {
    const s = this.state;
    if (!s.active) return;
    if (wasGrounded && s.lockResets < LOCK_DELAY_RESET_CAP) {
      s.lockAccumMs = 0;
      s.lockResets += 1;
    }
    s.grounded = !canPlace(s.board, { ...s.active, y: s.active.y + 1 });
  }

  private lock(): void {
    const s = this.state;
    if (!s.active) return;
    const cells = pieceCells(s.active);
    s.board = merge(s.board, cells, s.active.type);

    if (cells.some((cell) => cell.row < FIRST_VISIBLE_ROW)) {
      s.status = 'over';
      s.gameOverReason = 'lockout';
      s.active = null;
      return;
    }

    const { board, cleared } = clearLines(s.board);
    s.board = board;
    if (cleared.length > 0) {
      s.score += scoreForLines(cleared.length, s.level);
      s.lines += cleared.length;
      const nextLevel = levelForLines(s.lines);
      if (nextLevel !== s.level) {
        s.level = nextLevel;
        s.gravityMs = gravityMsForLevel(s.level);
      }
      s.lastClear = { rows: cleared, at: performance.now() };
    }

    s.active = null;
    this.spawn();
  }

  private spawn(): void {
    this.refillQueue();
    const type = this.state.queue.shift()!;
    this.spawnPieceOfType(type);
  }

  private spawnPieceOfType(type: TetrominoType): void {
    const s = this.state;
    const piece = spawnPiece(type);
    if (collides(s.board, pieceCells(piece))) {
      s.status = 'over';
      s.gameOverReason = 'spawn';
      s.active = null;
      return;
    }
    s.active = piece;
    s.holdUsed = false;
    s.lockAccumMs = 0;
    s.lockResets = 0;
    s.gravityAccumMs = 0;
    s.grounded = !canPlace(s.board, { ...piece, y: piece.y + 1 });
  }

  private refillQueue(): void {
    while (this.state.queue.length < QUEUE_KEEP_ALIVE) {
      this.state.queue.push(this.bag.next());
    }
  }
}