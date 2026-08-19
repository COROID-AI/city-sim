/**
 * A* pathfinding over the generated road graph.
 *
 * Citizens walk along roads/sidewalks between building doors. Each building
 * door sits on the edge of a building footprint, adjacent to a road, so the
 * pathfinder snaps start/goal to the nearest road tile, runs A* across the
 * road lattice, then returns a full route that begins at the citizen's tile,
 * follows road tiles, and ends at the destination door.
 */

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** @param {object} world  World/city state exposing roads + gridSize. */
function buildRoadSet(world) {
  const set = new Set();
  for (const r of world.roads) set.add(r.y * world.gridSize + r.x);
  return set;
}

/**
 * Find the nearest road tile to an arbitrary (possibly building) tile via a
 * bounded BFS. Returns the road tile's integer coordinates.
 */
function nearestRoad(world, tile, roads) {
  const gs = world.gridSize;
  const tileKey = (x, y) => y * gs + x;
  if (roads.has(tileKey(Math.floor(tile.x), Math.floor(tile.y)))) {
    return { x: Math.floor(tile.x), y: Math.floor(tile.y) };
  }
  const seen = new Set([tileKey(Math.floor(tile.x), Math.floor(tile.y))]);
  let frontier = [[Math.floor(tile.x), Math.floor(tile.y)]];
  while (frontier.length) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gs || ny >= gs) continue;
        const k = tileKey(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        if (roads.has(k)) return { x: nx, y: ny };
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return { x: Math.floor(tile.x), y: Math.floor(tile.y) };
}

/** Standard A* over the 4-connected road graph. Returns {x,y} tiles (exclusive of start, inclusive of goal). */
function aStar(world, start, goal, roads) {
  const gs = world.gridSize;
  const key = (x, y) => y * gs + x;
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const startK = key(start.x, start.y);
  const goalK = key(goal.x, goal.y);
  const open = new Map();
  const closed = new Set();
  open.set(startK, { x: start.x, y: start.y, g: 0, f: h(start.x, start.y), parent: null });

  while (open.size) {
    let bestK = null;
    let bestF = Infinity;
    for (const [k, n] of open) {
      if (n.f < bestF) {
        bestF = n.f;
        bestK = k;
      }
    }
    const node = open.get(bestK);
    open.delete(bestK);
    closed.add(bestK);

    if (bestK === goalK) {
      const path = [];
      let cur = node;
      while (cur) {
        path.push({ x: cur.x, y: cur.y });
        cur = cur.parent;
      }
      path.reverse();
      return path;
    }

    for (const [dx, dy] of DIRS) {
      const nx = node.x + dx;
      const ny = node.y + dy;
      if (nx < 0 || ny < 0 || nx >= gs || ny >= gs) continue;
      const nk = key(nx, ny);
      if (!roads.has(nk) || closed.has(nk)) continue;
      const g = node.g + 1;
      const existing = open.get(nk);
      if (!existing || g < existing.g) {
        open.set(nk, { x: nx, y: ny, g, f: g + h(nx, ny), parent: node });
      }
    }
  }
  return [];
}

/**
 * Find a valid road-following route between two tiles (usually building
 * doors). Returns an array of {x,y} tile coordinates including the start and
 * goal tiles, or [] when no route exists.
 * @param {object} world  City/world state ({ roads, gridSize }).
 * @param {{x:number,y:number}} start  Start tile (may be off-road).
 * @param {{x:number,y:number}} goal   Goal tile (may be off-road).
 */
export function findPath(world, start, goal) {
  const roads = buildRoadSet(world);
  const s = nearestRoad(world, start, roads);
  const g = nearestRoad(world, goal, roads);
  const route = aStar(world, s, g, roads);
  if (!route.length) return [];
  return [
    { x: start.x, y: start.y },
    ...route.map((t) => ({ x: t.x, y: t.y })),
    { x: goal.x, y: goal.y },
  ];
}