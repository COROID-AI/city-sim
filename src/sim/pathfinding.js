import * as THREE from 'three';
export function buildRoadGraph(waypoints) {
    const nodes = [];
    const tolerance = 0.5;
    const findOrAdd = (pos) => {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].position.distanceTo(pos) < tolerance)
                return i;
        }
        nodes.push({ position: pos.clone(), neighbors: [] });
        return nodes.length - 1;
    };
    for (const route of waypoints) {
        let prevIdx = -1;
        for (const wp of route) {
            const idx = findOrAdd(wp);
            if (prevIdx >= 0 && prevIdx !== idx) {
                if (!nodes[prevIdx].neighbors.includes(idx))
                    nodes[prevIdx].neighbors.push(idx);
                if (!nodes[idx].neighbors.includes(prevIdx))
                    nodes[idx].neighbors.push(prevIdx);
            }
            prevIdx = idx;
        }
    }
    return { nodes };
}
export function findPath(graph, startIdx, goalIdx) {
    if (startIdx === goalIdx)
        return [startIdx];
    const open = new Set([startIdx]);
    const came = new Map();
    const gScore = new Map();
    const fScore = new Map();
    gScore.set(startIdx, 0);
    fScore.set(startIdx, heuristic(graph, startIdx, goalIdx));
    while (open.size > 0) {
        let current = -1;
        let lowestF = Infinity;
        for (const n of open) {
            const f = fScore.get(n) ?? Infinity;
            if (f < lowestF) {
                lowestF = f;
                current = n;
            }
        }
        if (current === -1)
            break;
        if (current === goalIdx)
            return reconstruct(came, current);
        open.delete(current);
        for (const neighbor of graph.nodes[current].neighbors) {
            const tentative = (gScore.get(current) ?? Infinity) + 1;
            if (tentative < (gScore.get(neighbor) ?? Infinity)) {
                came.set(neighbor, current);
                gScore.set(neighbor, tentative);
                fScore.set(neighbor, tentative + heuristic(graph, neighbor, goalIdx));
                open.add(neighbor);
            }
        }
    }
    return null;
}
function heuristic(graph, a, b) {
    return graph.nodes[a].position.distanceTo(graph.nodes[b].position);
}
function reconstruct(came, current) {
    const path = [current];
    while (came.has(current)) {
        current = came.get(current);
        path.unshift(current);
    }
    return path;
}
export function buildClosedLoop(waypoints) {
    const loop = [...waypoints];
    loop.push(waypoints[0].clone());
    return loop;
}
export function positionAlongPath(path, progress) {
    if (path.length === 0) {
        return { position: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, 1), segment: 0 };
    }
    if (path.length === 1) {
        return { position: path[0].clone(), direction: new THREE.Vector3(0, 0, 1), segment: 0 };
    }
    const totalSegs = path.length - 1;
    const scaled = progress * totalSegs;
    const seg = Math.min(Math.floor(scaled), totalSegs - 1);
    const t = scaled - seg;
    const a = path[seg];
    const b = path[seg + 1];
    const position = a.clone().lerp(b, t);
    const direction = b.clone().sub(a).normalize();
    return { position, direction, segment: seg };
}
export function pathLength(path) {
    let len = 0;
    for (let i = 0; i < path.length - 1; i++) {
        len += path[i].distanceTo(path[i + 1]);
    }
    return len;
}
export function nearestNodeIndex(graph, pos) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < graph.nodes.length; i++) {
        const d = graph.nodes[i].position.distanceTo(pos);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}
//# sourceMappingURL=pathfinding.js.map