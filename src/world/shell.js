/**
 * src/world/shell.js
 * Permanent café architecture — the fixed shell every era module shares.
 *
 * Room:
 *   width  7.0 m  (x: -3.5 .. +3.5)
 *   depth  5.0 m  (z: -2.5 .. +2.5)
 *   height 3.0 m  (y:  0.0 .. +3.0)
 *
 * Key human-scale references (shared by every era + camera presets):
 *   counter top ≈ 0.90 m high
 *   entrance door ≈ 2.05 m tall
 *   front window sill  ≈ 0.90 m, header ≈ 2.50 m
 *   kitchen passthrough opening ≈ 0.7–1.6 m on the back wall
 */
import * as THREE from '../../public/js/three/lib/three.module.js';
import { applyShadowPolicy } from './render.js';

const ROOM = {
  width: 7.0,
  depth: 5.0,
  height: 3.0,
  wallThickness: 0.12,
};

export function buildShell(scene) {
  const T = THREE;
  const group = new T.Group();
  group.name = 'shell';

  // Fixed human-scale anchors — expose for era modules and camera presets.
  const meta = {
    group,
    room: ROOM,
    floorY: 0,
    ceilingHeight: ROOM.height,
    counterHeight: 0.9,
    doorHeight: 2.05,
    counter: {
      frontX: -2.5,      // customer-facing surface
      staffX: -3.4,      // staff side, against the left wall
      topY: 0.9,
      zStart: -2.0,
      zEnd: 2.0,
    },
    passthrough: {
      x0: -2.0,
      x1: -0.9,
      y0: 0.7,
      y1: 1.6,
      centerX: -1.45,
      ledgeY: 0.9,
    },
    frontWindow: {
      sillY: 0.9,
      headerY: 2.5,
      x0: -3.5,
      x1: 2.0,
    },
    labelPosition() {
      // Where era placeholder/sign sprites float in the room.
      return new T.Vector3(0, 1.75, 0.6);
    },
    materials: {},
  };

  // ---------- materials ----------
  const matWall = new T.MeshStandardMaterial({ color: 0xd8c7a4, roughness: 0.92 });
  const matCeiling = new T.MeshStandardMaterial({ color: 0xefe8d2, roughness: 0.95 });
  const matFrame = new T.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.75 });
  const matGlass = new T.MeshStandardMaterial({
    color: 0xbcd6e8,
    metalness: 0.1,
    roughness: 0.15,
    transparent: true,
    opacity: 0.35,
  });
  const matDoorGlass = new T.MeshStandardMaterial({
    color: 0xa9c6de,
    metalness: 0.1,
    roughness: 0.12,
    transparent: true,
    opacity: 0.5,
  });
  const matCounterBody = new T.MeshStandardMaterial({ color: 0x4a3727, roughness: 0.7 });
  const matCounterFront = new T.MeshStandardMaterial({ color: 0x32261c, roughness: 0.8 });
  const matCounterTop = new T.MeshStandardMaterial({ color: 0x6f5537, roughness: 0.45 });
  const matTrim = new T.MeshStandardMaterial({ color: 0x6b5a3c, roughness: 0.6 });

  meta.materials = {
    wall: matWall,
    ceiling: matCeiling,
    frame: matFrame,
    glass: matGlass,
    doorGlass: matDoorGlass,
    counterBody: matCounterBody,
    counterFront: matCounterFront,
    counterTop: matCounterTop,
    trim: matTrim,
  };

  // ---------- floor + ceiling ----------
  const matFloor = new T.MeshStandardMaterial({ map: makeWoodTexture(T), color: 0xffffff, roughness: 0.85 });
  const floor = new T.Mesh(new T.BoxGeometry(ROOM.width, 0.08, ROOM.depth), matFloor);
  floor.position.set(0, -0.04, 0);
  floor.receiveShadow = true;
  group.add(floor);

  const ceiling = new T.Mesh(new T.BoxGeometry(ROOM.width, 0.06, ROOM.depth), matCeiling);
  ceiling.position.set(0, ROOM.height + 0.03, 0);
  group.add(ceiling);

  // ---------- back wall (z = -2.5) with kitchen passthrough ----------
  // Solid bands above / below the opening.
  addWallBox(group, ROOM.width, 1.4, 0, 2.3, -2.56, matWall);   // y 1.6..3.0
  addWallBox(group, ROOM.width, 0.7, 0, 0.35, -2.56, matWall);  // y 0.0..0.7
  // Left solid segment closing the opening side.
  addWallBox(group, 1.5, 0.9, -2.75, 1.15, -2.56, matWall);      // x -3.5..-2.0, y 0.7..1.6
  // Right solid segment closing the opening side.
  addWallBox(group, 4.4, 0.9, 1.3, 1.15, -2.56, matWall);       // x -0.9..+3.5, y 0.7..1.6

  // Trim around the passthrough opening (x -2.0..-0.9, y 0.7..1.6).
  const pt = meta.passthrough;
  const trimL = new T.Mesh(new T.BoxGeometry(0.06, 0.9, 0.06), matFrame);
  trimL.position.set(pt.x0, (pt.y0 + pt.y1) / 2, -2.52);
  group.add(trimL);
  const trimR = new T.Mesh(new T.BoxGeometry(0.06, 0.9, 0.06), matFrame);
  trimR.position.set(pt.x1, (pt.y0 + pt.y1) / 2, -2.52);
  group.add(trimR);
  const trimTop = new T.Mesh(new T.BoxGeometry(pt.x1 - pt.x0, 0.06, 0.06), matFrame);
  trimTop.position.set((pt.x0 + pt.x1) / 2, pt.y1, -2.52);
  group.add(trimTop);
  // Service shelf inside the opening (counter-height ledge).
  const shelf = new T.Mesh(new T.BoxGeometry(pt.x1 - pt.x0 + 0.2, 0.05, 0.3), matTrim);
  shelf.position.set((pt.x0 + pt.x1) / 2, pt.ledgeY, -2.34);
  group.add(shelf);

  // ---------- left / right walls ----------
  addWallBox(group, 0.12, ROOM.height, -3.56, ROOM.height / 2, 0, matWall);
  addWallBox(group, 0.12, ROOM.height, 3.56, ROOM.height / 2, 0, matWall);

  // ---------- front wall (z = +2.5): windows + entrance door ----------
  buildFrontWall(group, ROUND_META(meta), T);

  // ---------- counter along the left wall ----------
  buildCounter(group, meta, T);

  // ---------- interior lighting rig ----------
  buildLightRig(group, T);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  group.traverse((o) => {
    if (o.isMesh && (o.material === matGlass || o.material === matDoorGlass)) {
      o.castShadow = false;
    }
  });

  scene.add(group);
  return meta;
}

/** Keeps call sites readable when passing named meta. */
function ROUND_META(meta) {
  return {
    room: meta.room,
    wallMat: meta.materials.wall,
    frameMat: meta.materials.frame,
    glassMat: meta.materials.glass,
    doorGlassMat: meta.materials.doorGlass,
    trimMat: meta.materials.trim,
    sillY: meta.frontWindow.sillY,
    headerY: meta.frontWindow.headerY,
  };
}

function buildFrontWall(group, m, T) {
  const z = 2.56;
  const winX0 = -3.5;
  const winX1 = 2.0;
  const sillY = m.sillY || 0.9;
  const headerY = m.headerY || 2.5;

  // Sill (0..0.9), header (2.5..3.0)
  addWallBox(group, winX1 - winX0, sillY, (winX0 + winX1) / 2, sillY / 2, z, m.trimMat);
  addWallBox(group, winX1 - winX0, ROOM.height - headerY, (winX0 + winX1) / 2, (headerY + ROOM.height) / 2, z, m.trimMat);

  // Pier between window zone and door.
  addWallBox(group, 0.1, ROOM.height, 2.05, 1.5, z, m.trimMat);
  // Solid right of the door.
  addWallBox(group, 0.4, ROOM.height, 3.3, 1.5, z, m.trimMat);
  // Header above the door.
  addWallBox(group, 1.0, ROOM.height - 2.05, 2.6, (2.05 + ROOM.height) / 2, z, m.trimMat);

  // Front glass — single sheet facing inward.
  const glass = new T.Mesh(
    new T.PlaneGeometry(winX1 - winX0 - 0.48, headerY - sillY - 0.08),
    m.glassMat
  );
  glass.position.set((winX0 + winX1) / 2, (sillY + headerY) / 2, z - 0.06);
  glass.rotation.y = Math.PI;
  group.add(glass);

  // Vertical mullions + one horizontal transom.
  const mullions = [-2.55, -1.55, -0.55, 0.45, 1.35];
  for (const mx of mullions) {
    const bar = new T.Mesh(new T.BoxGeometry(0.06, headerY - sillY, 0.06), m.frame);
    bar.position.set(mx, (sillY + headerY) / 2, z - 0.06);
    group.add(bar);
  }
  const transom = new T.Mesh(new T.BoxGeometry(winX1 - winX0 - 0.2, 0.06, 0.06), m.frame);
  transom.position.set((winX0 + winX1) / 2, 1.7, z - 0.06);
  group.add(transom);

  // Window stool (sill lip) on the interior.
  const stool = new T.Mesh(new T.BoxGeometry(winX1 - winX0 - 0.2, 0.05, 0.24), m.trimMat);
  stool.position.set((winX0 + winX1) / 2, sillY + 0.025, z - 0.1);
  group.add(stool);

  buildDoor(group, m, T, z);
}

function buildDoor(group, m, T, z) {
  const doorX0 = 2.1;
  const doorX1 = 3.1;
  const doorH = 2.05;

  const frame = (w0, xc, h0, y0, zc) => {
    const bar = new T.Mesh(new T.BoxGeometry(w0, h0, 0.08), m.frame);
    bar.position.set(xc, y0, zc);
    group.add(bar);
  };
  // Leaf frame.
  frame(0.07, doorX0 + 0.035, doorH, doorH / 2, z - 0.04);
  frame(0.07, doorX1 - 0.035, doorH, doorH / 2, z - 0.04);
  frame(doorX1 - doorX0 - 0.14, 0.07, (doorX0 + doorX1) / 2, 0.035, z - 0.04);
  frame(doorX1 - doorX0 - 0.14, 0.07, (doorX0 + doorX1) / 2, doorH - 0.05, z - 0.04);
  // Center stile.
  frame(0.07, (doorX0 + doorX1) / 2, doorH - 0.2, doorH / 2, z - 0.04);

  // Door glass panels.
  const paneW = 0.34;
  const paneH = 1.55;
  const pz = z - 0.03;
  const paneLeft = new T.Mesh(new T.PlaneGeometry(paneW, paneH), m.doorGlassMat);
  paneLeft.position.set(doorX0 + 0.34, 1.05, pz);
  group.add(paneLeft);
  const paneRight = new T.Mesh(new T.PlaneGeometry(paneW, paneH), m.doorGlassMat);
  paneRight.position.set(doorX1 - 0.34, 1.05, pz);
  group.add(paneRight);

  // Handle (push bar on the interior).
  const handle = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 0.22, 8), m.frame);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(doorX0 + 0.16, 1.0, z - 0.16);
  group.add(handle);
}

function buildCounter(group, meta, T) {
  const { frontX, staffX, topY, zStart, zEnd } = meta.counter;
  const length = zEnd - zStart; // 4.0 m
  const depth = staffX > frontX ? staffX - frontX : frontX - staffX; // 0.9 m
  const cx = (frontX + staffX) / 2;
  const cz = (zStart + zEnd) / 2;

  // Body — fills the run under the worktop.
  const body = new T.Mesh(new T.BoxGeometry(depth, topY - 0.05, length), meta.materials.counterBody);
  body.position.set(cx, (topY - 0.05) / 2, cz);
  group.add(body);

  // Customer front panel — the only outward face for the public.
  const panel = new T.Mesh(new T.BoxGeometry(0.05, topY - 0.05, length - 0.1), meta.materials.counterFront);
  panel.position.set(frontX, (topY - 0.05) / 2, cz);
  group.add(panel);

  // Worktop — top of counter ≈ topY (0.90 m).
  const top = new T.Mesh(new T.BoxGeometry(depth + 0.1, 0.05, length + 0.06), meta.materials.counterTop);
  top.position.set(cx, topY - 0.025, cz);
  group.add(top);

  // Staff-side garnish shelf (raised behind the counter).
  const rail = new T.Mesh(new T.BoxGeometry(0.26, 0.06, length - 0.2), meta.materials.trim);
  rail.position.set(staffX, topY + 0.16, cz);
  group.add(rail);
}

function buildLightRig(group, T) {
  const hemi = new T.HemisphereLight(0xfff2dd, 0x5c4a38, 0.9);
  group.add(hemi);

  const sun = new T.DirectionalLight(0xfff0d8, 1.2);
  sun.position.set(4, 6, 7);
  sun.castShadow = true;
  applyShadowPolicy(sun);
  group.add(sun);

  // Warm pendant points over the customer / counter zone.
  const pendants = [
    [-2.2, 2.55, -1.3],
    [0.0, 2.55, 0.2],
    [2.2, 2.55, 1.4],
  ];
  for (const [px, py, pz] of pendants) {
    const p = new T.PointLight(0xffcf9e, 6, 14, 2);
    p.position.set(px, py, pz);
    group.add(p);
    const bulb = new T.Mesh(
      new T.SphereGeometry(0.07, 12, 12),
      new T.MeshStandardMaterial({ color: 0xffcf9e, emissive: 0xffcf9e, emissiveIntensity: 2 })
    );
    bulb.position.set(px, py - 0.09, pz);
    group.add(bulb);
  }

  const amb = new T.AmbientLight(0xffffff, 0.25);
  group.add(amb);
}

function addWallBox(group, w, h, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, ROOM.wallThickness), mat);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

function makeWoodTexture(T) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#8a6d4d';
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(40,28,16,0.55)';
  g.lineWidth = 4;
  for (let i = 0; i < 6; i++) {
    const y = (i * 1024) / 6;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(1024, y);
    g.stroke();
  }
  for (let row = 0; row < 6; row++) {
    const y = (row * 1024) / 6;
    const offset = row % 2 === 0 ? 0 : 320;
    for (let x = offset; x < 1024; x += 410) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 1024 / 6);
      g.stroke();
    }
  }
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    g.fillStyle = `rgba(40,28,16,${(0.02 + Math.random() * 0.05).toFixed(3)})`;
    g.fillRect(x, y, 2, 2);
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}