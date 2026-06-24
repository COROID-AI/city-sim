/**
 * Unit tests for CommuteSystem (spec §7.2).
 *
 * The CommuteSystem drives a 4-state citizen↔vehicle handoff state machine:
 *   none → toRoad → inVehicle → arrived → none
 *
 * Private handlers (handleNone, handleToRoad, handleInVehicle, inferHour,
 * pickColor) are exercised indirectly through the public `update()` method.
 * Citizen state is set directly (fields are public) to enter each branch.
 */
import type {
  Building,
  BuildingDef,
  CityTime,
  RoadEdge,
  RoadGraph,
  RoadNode,
} from '@/engine/types';
import { CommuteSystem } from '@/systems/CommuteSystem';
import { MAX_VEHICLES, TrafficSystem } from '@/systems/TrafficSystem';
import { COMMUTE_START_HOUR, WORK_END_HOUR } from '@/entities/Citizen';
import { Citizen } from '@/entities/Citizen';
import { EventBus } from '@/systems/EventBus';
import { World } from '@/engine/World';

/** Helper: build a road node. */
function node(
  id: string,
  x: number,
  y: number,
  kind: 'intersection' | 'entrance' = 'intersection',
): RoadNode {
  return { id, x, y, kind };
}

/** Helper: build a minimal graph containing the given nodes (no edges). */
function graphOf(nodes: RoadNode[]): RoadGraph {
  const nodeMap = new Map<string, RoadNode>();
  for (const n of nodes) nodeMap.set(n.id, n);
  return { nodes: nodeMap, edges: new Map() };
}

/**
 * Helper: build a graph with bidirectional edges between consecutive nodes.
 * Each edge weight is the Manhattan distance between its endpoints.
 */
function graphWithChain(nodes: RoadNode[]): RoadGraph {
  const graph = graphOf(nodes);
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    const weight = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const forward: RoadEdge = { from: a.id, to: b.id, weight };
    const backward: RoadEdge = { from: b.id, to: a.id, weight };
    const listA = graph.edges.get(a.id) ?? [];
    listA.push(forward);
    graph.edges.set(a.id, listA);
    const listB = graph.edges.get(b.id) ?? [];
    listB.push(backward);
    graph.edges.set(b.id, listB);
  }
  return graph;
}

/** A minimal building definition for test buildings. */
const TEST_DEF: BuildingDef = {
  id: 'test',
  name: 'Test',
  type: 'house',
  width: 1,
  height: 1,
  cost: 0,
  upkeep: 0,
  capacity: 1,
  color: '#000',
};

/** Helper: build a 1x1 building at (x,y). */
function building(id: string, x: number, y: number): Building {
  return {
    id,
    type: 'house',
    zone: 'residential',
    x,
    y,
    width: 1,
    height: 1,
    def: TEST_DEF,
  };
}

/** Helper: build a CityTime snapshot. */
function cityTime(hour: number): CityTime {
  return { day: 0, hour, minute: 0, totalMs: hour * 3_600_000 };
}

/**
 * Build a standard test fixture:
 *  - A road chain of 3 nodes spaced far apart (start, mid, goal).
 *  - A home building near the start node, a workplace near the goal node.
 *  - The distance between home and work exceeds VEHICLE_DISTANCE_THRESHOLD.
 *  - One employed citizen placed at the home building.
 */
function buildFixture(): {
  world: World;
  graph: RoadGraph;
  traffic: TrafficSystem;
  citizen: Citizen;
  home: Building;
  work: Building;
  startNode: RoadNode;
  goalNode: RoadNode;
} {
  // Road nodes along x-axis, spaced 15 tiles apart. Home at x=0, work at x=60
  // → distance 60 > VEHICLE_DISTANCE_THRESHOLD (20).
  const startNode = node('n0', 1, 1);
  const midNode = node('n1', 30, 1);
  const goalNode = node('n2', 59, 1);
  const graph = graphWithChain([startNode, midNode, goalNode]);

  const home = building('home', 0, 0);
  const work = building('work', 60, 0);
  const world = new World(80, 40);
  world.buildings.set(home.id, home);
  world.buildings.set(work.id, work);

  const citizen = new Citizen({ x: 0.5, y: 0.5 }, {
    id: 'c1',
    employed: true,
    homeId: 'home',
    workplaceId: 'work',
  });
  world.addCitizen(citizen);

  const traffic = new TrafficSystem({ graph });
  return { world, graph, traffic, citizen, home, work, startNode, goalNode };
}

/** Build a CommuteSystem with a deterministic RNG (always picks index 0). */
function makeSystem(
  world: World,
  graph: RoadGraph,
  traffic: TrafficSystem,
  eventBus: EventBus | null = null,
): CommuteSystem {
  return new CommuteSystem(world, {
    graph,
    traffic,
    eventBus,
    rng: () => 0,
  });
}

describe('CommuteSystem — maxVehicles', () => {
  it('returns 0 when no citizens are employed', () => {
    const world = new World(10, 10);
    const graph = graphOf([node('a', 0, 0)]);
    const traffic = new TrafficSystem({ graph });
    const cs = makeSystem(world, graph, traffic);
    expect(cs.maxVehicles()).toBe(0);
  });

  it('returns floor(employed/5) for small populations', () => {
    const world = new World(10, 10);
    for (let i = 0; i < 12; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, { employed: true }));
    }
    const graph = graphOf([node('a', 0, 0)]);
    const traffic = new TrafficSystem({ graph });
    const cs = makeSystem(world, graph, traffic);
    // floor(12 / 5) = 2
    expect(cs.maxVehicles()).toBe(2);
  });

  it('caps at MAX_VEHICLES for large populations', () => {
    const world = new World(10, 10);
    for (let i = 0; i < MAX_VEHICLES * 5 + 10; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, { employed: true }));
    }
    const graph = graphOf([node('a', 0, 0)]);
    const traffic = new TrafficSystem({ graph });
    const cs = makeSystem(world, graph, traffic);
    expect(cs.maxVehicles()).toBe(MAX_VEHICLES);
  });

  it('ignores unemployed citizens', () => {
    const world = new World(10, 10);
    for (let i = 0; i < 10; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, { employed: false }));
    }
    const graph = graphOf([node('a', 0, 0)]);
    const traffic = new TrafficSystem({ graph });
    const cs = makeSystem(world, graph, traffic);
    expect(cs.maxVehicles()).toBe(0);
  });
});

describe('CommuteSystem — update gating', () => {
  it('skips citizens without employment or home/work', () => {
    const world = new World(80, 40);
    const home = building('home', 0, 0);
    const work = building('work', 60, 0);
    world.buildings.set('home', home);
    world.buildings.set('work', work);
    // Unemployed citizen: no commute should start.
    const unemployed = new Citizen({ x: 0.5, y: 0.5 }, {
      id: 'cu',
      employed: false,
      homeId: 'home',
      workplaceId: 'work',
    });
    world.addCitizen(unemployed);
    const startNode = node('n0', 1, 1);
    const midNode = node('n1', 30, 1);
    const goalNode = node('n2', 59, 1);
    const graph = graphWithChain([startNode, midNode, goalNode]);
    const traffic = new TrafficSystem({ graph });
    const cs = makeSystem(world, graph, traffic);
    cs.update(COMMUTE_START_HOUR);
    expect(unemployed.commuteState).toBe('none');
  });

  it('does nothing outside commute hours (non-commute hour)', () => {
    const { world, graph, traffic, citizen } = buildFixture();
    const cs = makeSystem(world, graph, traffic);
    // Hour 12 is not a commute hour.
    cs.update(12);
    expect(citizen.commuteState).toBe('none');
    expect(citizen.targetPosition).toBeNull();
  });

  it('resets a non-inVehicle transient state outside commute hours', () => {
    const { world, graph, traffic, citizen } = buildFixture();
    citizen.commuteState = 'toRoad';
    citizen.visible = false;
    citizen.vehicleId = 'v1';
    const cs = makeSystem(world, graph, traffic);
    cs.update(12);
    expect(citizen.commuteState).toBe('none');
    expect(citizen.visible).toBe(true);
    expect(citizen.vehicleId).toBeNull();
  });

  it('leaves inVehicle citizens alone outside commute hours', () => {
    const { world, graph, traffic, citizen } = buildFixture();
    citizen.commuteState = 'inVehicle';
    citizen.visible = false;
    citizen.vehicleId = 'v1';
    const cs = makeSystem(world, graph, traffic);
    cs.update(12);
    // inVehicle is preserved (vehicle may still be travelling).
    expect(citizen.commuteState).toBe('inVehicle');
  });
});

describe('CommuteSystem — handleNone (none → toRoad)', () => {
  it('starts a vehicle commute when distance exceeds threshold', () => {
    const { world, graph, traffic, citizen, startNode } = buildFixture();
    const cs = makeSystem(world, graph, traffic);
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('toRoad');
    expect(citizen.commuteMode).toBe('vehicle');
    // Target set to the nearest road node.
    expect(citizen.targetPosition).toEqual({ x: startNode.x, y: startNode.y });
  });

  it('does not start a vehicle commute for short distances (walk)', () => {
    const { world, graph, traffic } = buildFixture();
    // Place home and work close together (< VEHICLE_DISTANCE_THRESHOLD).
    const home = building('home2', 0, 0);
    const work = building('work2', 5, 0);
    world.buildings.set('home2', home);
    world.buildings.set('work2', work);
    const closeCitizen = new Citizen({ x: 0.5, y: 0.5 }, {
      id: 'c2',
      employed: true,
      homeId: 'home2',
      workplaceId: 'work2',
    });
    world.addCitizen(closeCitizen);

    const cs = makeSystem(world, graph, traffic);
    cs.update(COMMUTE_START_HOUR);
    // Short distance → stays in 'none', no vehicle commute.
    expect(closeCitizen.commuteState).toBe('none');
    expect(closeCitizen.commuteMode).toBe('foot');
  });

  it('does nothing when no road node is near (empty graph)', () => {
    const { world, traffic, citizen } = buildFixture();
    // Replace graph with an empty one.
    const emptyGraph: RoadGraph = { nodes: new Map(), edges: new Map() };
    const cs = makeSystem(world, emptyGraph, traffic);
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('none');
  });

  it('does nothing when origin building is missing', () => {
    const { world, graph, traffic, citizen } = buildFixture();
    // Remove the home building so origin resolves to undefined.
    world.buildings.delete('home');
    citizen.homeId = null;
    const cs = makeSystem(world, graph, traffic);
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('none');
  });

  it('does nothing when destination building is missing', () => {
    const { world, graph, traffic, citizen } = buildFixture();
    world.buildings.delete('work');
    citizen.workplaceId = null;
    const cs = makeSystem(world, graph, traffic);
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('none');
  });
});

describe('CommuteSystem — handleToRoad (toRoad → inVehicle)', () => {
  it('spawns a vehicle when the citizen reaches the road node', () => {
    const { world, graph, traffic, citizen, startNode } = buildFixture();
    // Add extra employed citizens so maxVehicles() > 0 (floor(6/5) = 1).
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const cs = makeSystem(world, graph, traffic);
    // Step 1: none → toRoad (sets target to startNode).
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('toRoad');
    // Simulate arrival: clear target and place citizen on the road node.
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    // Step 2: toRoad → inVehicle.
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('inVehicle');
    expect(citizen.visible).toBe(false);
    expect(citizen.vehicleId).not.toBeNull();
    expect(traffic.vehicleCount()).toBe(1);
    expect(world.vehicles.length).toBe(1);
    // The spawned vehicle starts at the road node.
    const vehicle = world.vehicles[0]!;
    expect(vehicle.getPosition()).toEqual({ x: startNode.x, y: startNode.y });
    expect(vehicle.citizenId).toBe(citizen.id);
  });

  it('waits while the citizen is still walking to the road', () => {
    const { world, graph, traffic, citizen } = buildFixture();
    const cs = makeSystem(world, graph, traffic);
    cs.update(COMMUTE_START_HOUR);
    // Citizen still has an active target → not yet at the road.
    expect(citizen.targetPosition).not.toBeNull();
    cs.update(COMMUTE_START_HOUR);
    // Still in toRoad, no vehicle spawned.
    expect(citizen.commuteState).toBe('toRoad');
    expect(traffic.vehicleCount()).toBe(0);
  });

  it('respects the vehicle cap (does not spawn beyond maxVehicles)', () => {
    const { world, graph, traffic, citizen, startNode } = buildFixture();
    // Only 1 employed citizen → maxVehicles = floor(1/5) = 0.
    const cs = makeSystem(world, graph, traffic);
    expect(cs.maxVehicles()).toBe(0);
    // Drive to toRoad, then arrive at the road node.
    cs.update(COMMUTE_START_HOUR);
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    cs.update(COMMUTE_START_HOUR);
    // Cap is 0 → no vehicle spawned, citizen stays in toRoad.
    expect(citizen.commuteState).toBe('toRoad');
    expect(traffic.vehicleCount()).toBe(0);
  });

  it('falls back to foot mode when no A* path exists', () => {
    const { world, traffic, citizen } = buildFixture();
    // Graph with nodes but NO edges → Pathfinder returns empty path.
    const startNode = node('n0', 1, 1);
    const goalNode = node('n2', 59, 1);
    const noEdgeGraph = graphOf([startNode, goalNode]);
    // Add more employed citizens so maxVehicles > 0.
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const cs = makeSystem(world, noEdgeGraph, traffic);
    expect(cs.maxVehicles()).toBeGreaterThanOrEqual(1);
    cs.update(COMMUTE_START_HOUR);
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    cs.update(COMMUTE_START_HOUR);
    // No path → fallback to foot, state reset to none.
    expect(citizen.commuteState).toBe('none');
    expect(citizen.commuteMode).toBe('foot');
  });

  it('resets to none when no start node is near the citizen', () => {
    const { world, traffic, citizen } = buildFixture();
    // Empty graph → getNearestNode returns null in handleToRoad.
    const emptyGraph: RoadGraph = { nodes: new Map(), edges: new Map() };
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const cs = makeSystem(world, emptyGraph, traffic);
    // Force into toRoad state directly.
    citizen.commuteState = 'toRoad';
    citizen.targetPosition = null;
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('none');
  });

  it('resets to none when destination building is missing', () => {
    const { world, graph, traffic, citizen, startNode } = buildFixture();
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    // Remove the workplace building so resolveDestination returns undefined.
    world.buildings.delete('work');
    const cs = makeSystem(world, graph, traffic);
    citizen.commuteState = 'toRoad';
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('none');
  });
});

describe('CommuteSystem — handleInVehicle (inVehicle → arrived)', () => {
  it('despawns the vehicle and restores the citizen on arrival', () => {
    const { world, graph, traffic, citizen, startNode, goalNode, work } =
      buildFixture();
    // Add more employed citizens so maxVehicles > 0.
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const cs = makeSystem(world, graph, traffic);
    // Drive none → toRoad → inVehicle.
    cs.update(COMMUTE_START_HOUR);
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('inVehicle');
    const vehicle = world.vehicles[0]!;
    // Force vehicle arrival: advance index past path end.
    vehicle.currentNodeIndex = vehicle.path.length;
    expect(vehicle.hasArrived()).toBe(true);
    // Step: inVehicle → arrived.
    cs.update(COMMUTE_START_HOUR, cityTime(COMMUTE_START_HOUR));
    expect(citizen.commuteState).toBe('arrived');
    expect(citizen.visible).toBe(true);
    expect(citizen.vehicleId).toBeNull();
    expect(citizen.commuteMode).toBe('foot');
    // Vehicle despawned from both traffic and world.
    expect(traffic.vehicleCount()).toBe(0);
    expect(world.vehicles.length).toBe(0);
    // Citizen moved to the destination building center.
    const expectedX = work.x + work.width / 2;
    const expectedY = work.y + work.height / 2;
    expect(citizen.getPosition()).toEqual({ x: expectedX, y: expectedY });
    // goalNode unused except for graph structure; assert it exists.
    expect(goalNode).toBeDefined();
  });

  it('does nothing while the vehicle is still en route', () => {
    const { world, graph, traffic, citizen, startNode } = buildFixture();
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const cs = makeSystem(world, graph, traffic);
    cs.update(COMMUTE_START_HOUR);
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('inVehicle');
    // Vehicle not arrived yet (index 0, path length > 0).
    cs.update(COMMUTE_START_HOUR, cityTime(COMMUTE_START_HOUR));
    expect(citizen.commuteState).toBe('inVehicle');
  });

  it('restores the citizen when vehicleId is null (missing vehicle)', () => {
    const { world, graph, traffic, citizen } = buildFixture();
    const cs = makeSystem(world, graph, traffic);
    citizen.commuteState = 'inVehicle';
    citizen.vehicleId = null;
    citizen.visible = false;
    cs.update(COMMUTE_START_HOUR, cityTime(COMMUTE_START_HOUR));
    expect(citizen.commuteState).toBe('none');
    expect(citizen.visible).toBe(true);
  });

  it('restores the citizen when the vehicle was removed externally', () => {
    const { world, graph, traffic, citizen, startNode } = buildFixture();
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const cs = makeSystem(world, graph, traffic);
    cs.update(COMMUTE_START_HOUR);
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('inVehicle');
    // Simulate external removal of the vehicle.
    const vehicle = world.vehicles[0]!;
    world.removeVehicle(vehicle);
    traffic.removeVehicle(vehicle);
    cs.update(COMMUTE_START_HOUR, cityTime(COMMUTE_START_HOUR));
    expect(citizen.commuteState).toBe('none');
    expect(citizen.visible).toBe(true);
    expect(citizen.vehicleId).toBeNull();
  });

  it('emits a citizen_arrived event on arrival when eventBus is configured', () => {
    const { world, graph, traffic, citizen, startNode } = buildFixture();
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const eventBus = new EventBus();
    const events: { type: string; citizenId: string }[] = [];
    eventBus.on('citizen_arrived', (e) => {
      if (e.type === 'citizen_arrived') {
        events.push({ type: e.type, citizenId: e.data.citizenId });
      }
    });
    const cs = makeSystem(world, graph, traffic, eventBus);
    cs.update(COMMUTE_START_HOUR);
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    cs.update(COMMUTE_START_HOUR);
    const vehicle = world.vehicles[0]!;
    vehicle.currentNodeIndex = vehicle.path.length;
    const time = cityTime(COMMUTE_START_HOUR);
    cs.update(COMMUTE_START_HOUR, time);
    expect(events).toHaveLength(1);
    expect(events[0]!.citizenId).toBe(citizen.id);
  });
});

describe('CommuteSystem — arrived → none', () => {
  it('resets commuteState to none from arrived', () => {
    const { world, graph, traffic, citizen } = buildFixture();
    const cs = makeSystem(world, graph, traffic);
    citizen.commuteState = 'arrived';
    citizen.visible = false;
    citizen.vehicleId = 'stale';
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('none');
    expect(citizen.visible).toBe(true);
    expect(citizen.vehicleId).toBeNull();
  });
});

describe('CommuteSystem — evening commute (hour 17)', () => {
  it('starts an evening commute towards home when near the workplace', () => {
    const { world, graph, traffic, goalNode, work } = buildFixture();
    // Place a citizen near the workplace so inferHour resolves to evening.
    const eveningCitizen = new Citizen(
      { x: work.x + 0.5, y: work.y + 0.5 },
      { id: 'c3', employed: true, homeId: 'home', workplaceId: 'work' },
    );
    world.addCitizen(eveningCitizen);
    // Add extra employed citizens so maxVehicles > 0.
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const cs = makeSystem(world, graph, traffic);
    cs.update(WORK_END_HOUR);
    expect(eveningCitizen.commuteState).toBe('toRoad');
    // Target is the nearest road node to the citizen (near workplace = goalNode).
    expect(eveningCitizen.targetPosition).toEqual({ x: goalNode.x, y: goalNode.y });
  });
});

describe('CommuteSystem — full lifecycle', () => {
  it('completes none → toRoad → inVehicle → arrived → none', () => {
    const { world, graph, traffic, citizen, startNode, work } = buildFixture();
    for (let i = 0; i < 5; i++) {
      world.addCitizen(new Citizen({ x: 0, y: 0 }, {
        employed: true,
        homeId: 'home',
        workplaceId: 'work',
      }));
    }
    const cs = makeSystem(world, graph, traffic);

    // none → toRoad
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('toRoad');

    // toRoad → inVehicle (simulate walking to road node)
    citizen.targetPosition = null;
    citizen.setPosition({ x: startNode.x, y: startNode.y });
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('inVehicle');
    expect(citizen.visible).toBe(false);

    // inVehicle → arrived (simulate vehicle completing its path)
    const vehicle = world.vehicles[0]!;
    vehicle.currentNodeIndex = vehicle.path.length;
    cs.update(COMMUTE_START_HOUR, cityTime(COMMUTE_START_HOUR));
    expect(citizen.commuteState).toBe('arrived');
    expect(citizen.visible).toBe(true);
    expect(world.vehicles.length).toBe(0);

    // arrived → none
    cs.update(COMMUTE_START_HOUR);
    expect(citizen.commuteState).toBe('none');

    // Citizen ends at the workplace center.
    const pos = citizen.getPosition();
    expect(pos.x).toBe(work.x + work.width / 2);
    expect(pos.y).toBe(work.y + work.height / 2);
  });
});
