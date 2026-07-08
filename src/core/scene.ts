import * as THREE from 'three';
import { SceneRenderer } from '../render/renderer.js';
import { CameraController, CameraBounds } from '../render/camera.js';
import {
  TimePeriod,
  DEFAULT_PERIOD,
  TIME_PERIODS,
  paletteForPeriod,
  lerpPalette,
  PeriodPalette,
} from './timePeriod.js';

export interface SimulationState {
  period: TimePeriod;
  transitionProgress: number;
  isTransitioning: boolean;
  population: number;
  vehicles: number;
  simHour: number;
  periodLabel: string;
}

interface BuildingSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  floors: Record<TimePeriod, number>;
  footprint: number;
}

interface BuildingMesh {
  group: THREE.Group;
  spec: BuildingSpec;
  mass: THREE.Mesh | null;
  roof: THREE.Mesh | null;
  signs: THREE.Mesh[];
  targetFloors: number;
  currentFloors: number;
  periodVisible: Record<TimePeriod, boolean>;
}

interface VehicleMesh {
  group: THREE.Group;
  x: number;
  z: number;
  speed: number;
  axis: 'h' | 'v';
  dir: 1 | -1;
  offset: number;
  periodVisible: Record<TimePeriod, boolean>;
  body: THREE.Mesh;
  wheels: THREE.Mesh[];
}

interface PedestrianMesh {
  group: THREE.Group;
  x: number;
  z: number;
  speed: number;
  axis: 'h' | 'v';
  dir: 1 | -1;
  offset: number;
  periodVisible: Record<TimePeriod, boolean>;
  body: THREE.Mesh;
}

const FLOOR_HEIGHT = 3.2;
const TRANSITION_DURATION = 2.2;

const BUILDING_SPECS: BuildingSpec[] = [
  { x: -22, z: -16, w: 10, d: 10, floors: { 1945: 2, 1965: 3, 1985: 5, 2005: 8, 2025: 12 }, footprint: 0.92 },
  { x: -8, z: -18, w: 8, d: 12, floors: { 1945: 1, 1965: 2, 1985: 4, 2005: 6, 2025: 9 }, footprint: 0.9 },
  { x: 6, z: -16, w: 12, d: 10, floors: { 1945: 3, 1965: 5, 1985: 7, 2005: 10, 2025: 18 }, footprint: 0.94 },
  { x: 22, z: -18, w: 9, d: 9, floors: { 1945: 0, 1965: 2, 1985: 6, 2005: 9, 2025: 14 }, footprint: 0.9 },
  { x: -24, z: 0, w: 8, d: 14, floors: { 1945: 2, 1965: 4, 1985: 6, 2005: 7, 2025: 10 }, footprint: 0.88 },
  { x: -10, z: 2, w: 11, d: 11, floors: { 1945: 4, 1965: 6, 1985: 9, 2005: 14, 2025: 24 }, footprint: 0.95 },
  { x: 8, z: 0, w: 10, d: 13, floors: { 1945: 1, 1965: 3, 1985: 8, 2005: 12, 2025: 20 }, footprint: 0.92 },
  { x: 22, z: 2, w: 9, d: 11, floors: { 1945: 0, 1965: 1, 1985: 5, 2005: 8, 2025: 11 }, footprint: 0.9 },
  { x: -20, z: 16, w: 12, d: 9, floors: { 1945: 2, 1965: 3, 1985: 4, 2005: 6, 2025: 8 }, footprint: 0.91 },
  { x: -4, z: 18, w: 9, d: 9, floors: { 1945: 1, 1965: 2, 1985: 3, 2005: 5, 2025: 15 }, footprint: 0.9 },
  { x: 10, z: 16, w: 11, d: 10, floors: { 1945: 3, 1965: 5, 1985: 7, 2005: 11, 2025: 16 }, footprint: 0.93 },
  { x: 24, z: 18, w: 8, d: 12, floors: { 1945: 0, 1965: 2, 1985: 6, 2005: 9, 2025: 13 }, footprint: 0.89 },
  { x: 0, z: -30, w: 6, d: 6, floors: { 1945: 1, 1965: 2, 1985: 3, 2005: 4, 2025: 5 }, footprint: 0.85 },
  { x: -32, z: -8, w: 7, d: 7, floors: { 1945: 2, 1965: 3, 1985: 5, 2005: 7, 2025: 9 }, footprint: 0.87 },
  { x: 32, z: -8, w: 7, d: 7, floors: { 1945: 0, 1965: 1, 1985: 4, 2005: 6, 2025: 8 }, footprint: 0.86 },
  // Additional buildings to reach 20+
  { x: -32, z: 16, w: 7, d: 7, floors: { 1945: 1, 1965: 2, 1985: 3, 2005: 5, 2025: 7 }, footprint: 0.85 },
  { x: 28, z: 12, w: 8, d: 8, floors: { 1945: 0, 1965: 2, 1985: 5, 2005: 8, 2025: 12 }, footprint: 0.88 },
  { x: -16, z: -30, w: 9, d: 9, floors: { 1945: 2, 1965: 3, 1985: 6, 2005: 9, 2025: 14 }, footprint: 0.9 },
  { x: 18, z: -32, w: 10, d: 10, floors: { 1945: 1, 1965: 3, 1985: 5, 2005: 8, 2025: 11 }, footprint: 0.92 },
  { x: -26, z: -26, w: 9, d: 9, floors: { 1945: 3, 1965: 5, 1985: 8, 2005: 12, 2025: 18 }, footprint: 0.91 },
  { x: 26, z: -26, w: 9, d: 9, floors: { 1945: 0, 1965: 2, 1985: 6, 2005: 9, 2025: 15 }, footprint: 0.9 },
  { x: 0, z: 30, w: 11, d: 11, floors: { 1945: 2, 1965: 4, 1985: 7, 2005: 10, 2025: 16 }, footprint: 0.93 },
  { x: -32, z: 28, w: 7, d: 7, floors: { 1945: 1, 1965: 2, 1985: 4, 2005: 6, 2025: 9 }, footprint: 0.86 },
  { x: 32, z: 28, w: 7, d: 7, floors: { 1945: 0, 1965: 1, 1985: 3, 2005: 5, 2025: 8 }, footprint: 0.85 },
];

export class SceneManager {
  private scene: THREE.Scene;
  private renderer: SceneRenderer;
  private cameraController: CameraController;
  private readonly worldBounds: CameraBounds = { minX: -38, maxX: 38, minZ: -38, maxZ: 38 };

  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private hemi: THREE.HemisphereLight;
  private ground: THREE.Mesh;
  private roadGroup: THREE.Group;

  private buildings: BuildingMesh[] = [];
  private vehicles: VehicleMesh[] = [];
  private pedestrians: PedestrianMesh[] = [];

  private currentPeriod: TimePeriod = DEFAULT_PERIOD;
  private fromPeriod: TimePeriod = DEFAULT_PERIOD;
  private toPeriod: TimePeriod = DEFAULT_PERIOD;
  private transitionTime = 0;
  private isTransitioning = false;
  private simTime = 0;
  private currentPalette: PeriodPalette;
  private disposed = false;

  constructor() {
    const canvas = document.querySelector('#app') as HTMLElement;
    this.renderer = new SceneRenderer();
    canvas.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.cameraController = new CameraController(window.innerWidth / window.innerHeight, this.renderer.domElement, this.worldBounds);

    this.currentPalette = paletteForPeriod(this.currentPeriod);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x55504a, 0.5);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 220;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    this.sun.shadow.bias = -0.0004;

    this.scene.add(this.ambient, this.hemi, this.sun);

    this.ground = this.createGround();
    this.scene.add(this.ground);

    this.roadGroup = this.createRoads();
    this.scene.add(this.roadGroup);
  }

  initialize(): void {
    this.buildCity();
    this.applyPeriodImmediate(this.currentPeriod);
    this.cameraController.frameBounds(this.worldBounds);
    this.setupResize();
  }

  private createGround(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(120, 120);
    const mat = new THREE.MeshStandardMaterial({ color: this.currentPalette.ground, roughness: 0.95 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createRoads(): THREE.Group {
    const group = new THREE.Group();
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.9 });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8c878, roughness: 0.7 });
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x6e6e72, roughness: 0.85 });

    const roadW = 8;
    const roadGeoH = new THREE.BoxGeometry(90, 0.15, roadW);
    const roadGeoV = new THREE.BoxGeometry(roadW, 0.15, 90);
    for (const z of [-22, 0, 22]) {
      const r = new THREE.Mesh(roadGeoH, roadMat);
      r.position.set(0, 0.06, z);
      r.receiveShadow = true;
      group.add(r);
    }
    for (const x of [-22, 0, 22]) {
      const r = new THREE.Mesh(roadGeoV, roadMat);
      r.position.set(x, 0.06, 0);
      r.receiveShadow = true;
      group.add(r);
    }
    // dashed center lines
    const dashGeo = new THREE.BoxGeometry(2.2, 0.16, 0.22);
    for (const z of [-22, 0, 22]) {
      for (let xi = -38; xi <= 38; xi += 6) {
        const d = new THREE.Mesh(dashGeo, lineMat);
        d.position.set(xi, 0.12, z);
        group.add(d);
      }
    }
    const dashGeoV = new THREE.BoxGeometry(0.22, 0.16, 2.2);
    for (const x of [-22, 0, 22]) {
      for (let zi = -38; zi <= 38; zi += 6) {
        const d = new THREE.Mesh(dashGeoV, lineMat);
        d.position.set(x, 0.12, zi);
        group.add(d);
      }
    }
    // sidewalks bordering roads
    const swGeo = new THREE.BoxGeometry(90, 0.28, 1.4);
    for (const z of [-26.5, -17.5, -4.5, 4.5, 17.5, 26.5]) {
      const s = new THREE.Mesh(swGeo, sidewalkMat);
      s.position.set(0, 0.13, z);
      s.receiveShadow = true;
      group.add(s);
    }
    const swGeoV = new THREE.BoxGeometry(1.4, 0.28, 90);
    for (const x of [-26.5, -17.5, -4.5, 4.5, 17.5, 26.5]) {
      const s = new THREE.Mesh(swGeoV, sidewalkMat);
      s.position.set(x, 0.13, 0);
      s.receiveShadow = true;
      group.add(s);
    }
    return group;
  }
  private buildingColor(period: TimePeriod, seed: number): THREE.Color {
    const palettes: Record<TimePeriod, number[]> = {
      1945: [0x8a7a5e, 0x9a8868, 0x7a6a52, 0xa89678, 0x6e5e48],
      1965: [0x9a8e74, 0xb0a288, 0x847866, 0xc0b498, 0x706458],
      1985: [0x868078, 0xa09a90, 0x6e6a62, 0xb8b2a8, 0x54504a],
      2005: [0x707880, 0x909aa0, 0x5a626a, 0xa0a8b0, 0x4a525a],
      2025: [0x2a3038, 0x3a424c, 0x505862, 0x1e242c, 0x646e7a],
    };
    const arr = palettes[period];
    return new THREE.Color(arr[seed % arr.length]);
  }

  private buildCity(): void {
    for (const spec of BUILDING_SPECS) {
      this.buildings.push(this.createBuilding(spec));
    }
    this.createVehicles();
    this.createPedestrians();
    this.addProps();
  }

  private createBuilding(spec: BuildingSpec): BuildingMesh {
    const group = new THREE.Group();
    group.position.set(spec.x, 0, spec.z);
    this.scene.add(group);

    const bm: BuildingMesh = {
      group,
      spec,
      mass: null,
      roof: null,
      signs: [],
      targetFloors: spec.floors[DEFAULT_PERIOD],
      currentFloors: spec.floors[DEFAULT_PERIOD],
      periodVisible: { 1945: true, 1965: true, 1985: true, 2005: true, 2025: true },
    };
    bm.periodVisible[1945] = spec.floors[1945] > 0;
    bm.periodVisible[1965] = spec.floors[1965] > 0;
    bm.periodVisible[1985] = spec.floors[1985] > 0;
    bm.periodVisible[2005] = spec.floors[2005] > 0;
    bm.periodVisible[2025] = spec.floors[2025] > 0;
    this.rebuildBuildingGeometry(bm, DEFAULT_PERIOD);
    return bm;
  }

  private rebuildBuildingGeometry(bm: BuildingMesh, period: TimePeriod): void {
    if (bm.mass) {
      bm.group.remove(bm.mass);
      bm.mass.geometry.dispose();
    }
    if (bm.roof) {
      bm.group.remove(bm.roof);
      bm.roof.geometry.dispose();
    }
    for (const s of bm.signs) {
      bm.group.remove(s);
      s.geometry.dispose();
    }
    bm.signs = [];

    const floors = bm.spec.floors[period];
    if (floors <= 0) {
      bm.mass = null;
      bm.roof = null;
      return;
    }
    const seed = Math.abs(Math.round(bm.spec.x * 7.3 + bm.spec.z * 3.1));
    const w = bm.spec.w * bm.spec.footprint;
    const d = bm.spec.d * bm.spec.footprint;
    const h = Math.max(0.5, floors * FLOOR_HEIGHT);
    const geo = new THREE.BoxGeometry(w, h, d);
    const color = this.buildingColor(period, seed);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: period <= 1965 ? 0.9 : 0.6,
      metalness: period >= 2025 ? 0.35 : period >= 2005 ? 0.15 : 0.0,
    });
    const mass = new THREE.Mesh(geo, mat);
    mass.position.y = h / 2;
    mass.castShadow = true;
    mass.receiveShadow = true;
    bm.group.add(mass);
    bm.mass = mass;

    // window emissive strip via second box overlay
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x223040,
      emissive: period >= 1985 ? 0xffcc66 : 0x000000,
      emissiveIntensity: period >= 1985 ? 0.25 : 0,
      roughness: 0.4,
    });
    const winGeo = new THREE.BoxGeometry(w * 0.94, Math.max(0.5, h - 0.6), d * 0.94);
    const winShell = new THREE.Mesh(winGeo, winMat);
    winShell.position.y = h / 2;
    bm.group.add(winShell);
    bm.signs.push(winShell);

    // roof detail
    const roofGeo = new THREE.BoxGeometry(w * 0.5, 0.6, d * 0.5);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x404048, roughness: 0.8 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = h + 0.3;
    roof.castShadow = true;
    bm.group.add(roof);
    bm.roof = roof;

    // storefront / advertisement sign for later periods
    if (period >= 1985 && floors >= 2) {
      const signColors = [0xff5533, 0x33ccff, 0xffcc22, 0x33dd66, 0xff3399];
      const sc = signColors[seed % signColors.length];
      const signMat = new THREE.MeshStandardMaterial({ color: sc, emissive: sc, emissiveIntensity: 0.6, roughness: 0.5 });
      const signGeo = new THREE.BoxGeometry(w * 0.7, 1.2, 0.2);
      const sign = new THREE.Mesh(signGeo, signMat);
      sign.position.set(0, 2.0, d / 2 + 0.15);
      bm.group.add(sign);
      bm.signs.push(sign);
    }
  }

  private createVehicles(): void {
    const periodColors: Record<TimePeriod, number[]> = {
      1945: [0x3a2a1e, 0x4a3a2a, 0x2a2a2a, 0x5a4a3a],
      1965: [0x884422, 0x556677, 0xccccaa, 0x664422],
      1985: [0xaa3322, 0x224488, 0x888888, 0x333333],
      2005: [0x222222, 0xcccccc, 0x88aabb, 0x333366],
      2025: [0x111114, 0xf0f0f0, 0x222a33, 0x2a4a5a],
    };
    const roads: Array<{ axis: 'h' | 'v'; pos: number; lane: number }> = [
      { axis: 'h', pos: -22, lane: -1.6 },
      { axis: 'h', pos: -22, lane: 1.6 },
      { axis: 'h', pos: 0, lane: -1.6 },
      { axis: 'h', pos: 0, lane: 1.6 },
      { axis: 'h', pos: 22, lane: -1.6 },
      { axis: 'h', pos: 22, lane: 1.6 },
      { axis: 'v', pos: -22, lane: -1.6 },
      { axis: 'v', pos: -22, lane: 1.6 },
      { axis: 'v', pos: 0, lane: -1.6 },
      { axis: 'v', pos: 0, lane: 1.6 },
      { axis: 'v', pos: 22, lane: -1.6 },
      { axis: 'v', pos: 22, lane: 1.6 },
    ];
    for (let i = 0; i < 14; i++) {
      const r = roads[i % roads.length];
      const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const group = new THREE.Group();
      const start = -36 + Math.random() * 72;
      const x = r.axis === 'h' ? start : r.pos + r.lane * dir;
      const z = r.axis === 'h' ? r.pos + r.lane * dir : start;
      group.position.set(x, 0.45, z);
      const bodyColor = periodColors[DEFAULT_PERIOD][i % 4];
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.8, 3.6),
        new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.3 })
      );
      body.castShadow = true;
      body.position.y = 0.4;
      group.add(body);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.6, 1.8),
        new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.3, metalness: 0.5, transparent: true, opacity: 0.7 })
      );
      cabin.position.set(0, 0.9, -0.2);
      group.add(cabin);
      const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
      const wheels: THREE.Mesh[] = [];
      for (const [wx, wz] of [[-0.9, 1.1], [0.9, 1.1], [-0.9, -1.1], [0.9, -1.1]]) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, -0.05, wz);
        group.add(wheel);
        wheels.push(wheel);
      }
      if (r.axis === 'h') group.rotation.y = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
      else group.rotation.y = dir === 1 ? 0 : Math.PI;
      this.scene.add(group);
      this.vehicles.push({
        group, body, wheels,
        x, z,
        speed: 3 + Math.random() * 3,
        axis: r.axis, dir, offset: start,
        periodVisible: { 1945: true, 1965: true, 1985: true, 2005: true, 2025: true },
      });
    }
  }

  private createPedestrians(): void {
    for (let i = 0; i < 50; i++) {
      const axis = i % 2 === 0 ? 'h' : 'v';
      const pos = [-22, 0, 22][i % 3];
      const lane = (i % 2 === 0 ? 1 : -1) * 3.2;
      const dir: 1 | -1 = i % 3 === 0 ? 1 : -1;
      const start = -34 + Math.random() * 68;
      const x = axis === 'h' ? start : pos + lane;
      const z = axis === 'h' ? pos + lane : start;
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      const outfit = this.pedestrianColor(DEFAULT_PERIOD, i);
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.22, 0.6, 4, 8),
        new THREE.MeshStandardMaterial({ color: outfit, roughness: 0.8 })
      );
      body.position.y = 0.7;
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xc8a888, roughness: 0.7 })
      );
      head.position.y = 1.25;
      group.add(head);
      this.scene.add(group);
      this.pedestrians.push({
        group, body,
        x, z,
        speed: 0.6 + Math.random() * 0.5,
        axis, dir, offset: start,
        periodVisible: { 1945: true, 1965: true, 1985: true, 2005: true, 2025: true },
      });
    }
  }

  private pedestrianColor(period: TimePeriod, i: number): number {
    const sets: Record<TimePeriod, number[]> = {
      1945: [0x554433, 0x4a3a2a, 0x666055, 0x3a3530, 0x5a5048],
      1965: [0x5566aa, 0xaa6655, 0xddd0bb, 0x664466, 0x445566],
      1985: [0x334488, 0x884466, 0xaaaaaa, 0x446644, 0x664422],
      2005: [0x222244, 0x444466, 0x886655, 0x555566, 0x334455],
      2025: [0x1a1a22, 0x2a2a35, 0x334050, 0x506070, 0x222230],
    };
    return sets[period][i % sets[period].length];
  }

  private addProps(): void {
    // street lamps along roads
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.6, metalness: 0.5 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffeeaa, emissive: 0xffcc66, emissiveIntensity: 0.9 });
    for (const p of [-22, 0, 22]) {
      for (const off of [-30, -14, 14, 30]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 8), lampMat);
        pole.position.set(off, 2.25, p + 4.2);
        pole.castShadow = true;
        this.scene.add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), bulbMat);
        bulb.position.set(off, 4.5, p + 4.2);
        this.scene.add(bulb);
        const pole2 = pole.clone();
        pole2.position.set(p + 4.2, 2.25, off);
        this.scene.add(pole2);
        const bulb2 = bulb.clone();
        bulb2.position.set(p + 4.2, 4.5, off);
        this.scene.add(bulb2);
      }
    }
    // park / trees on one block
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a5a2a, roughness: 0.8 });
    for (let i = 0; i < 10; i++) {
      const tx = -30 + (i % 3) * 4;
      const tz = 28 + Math.floor(i / 3) * 4;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 8), trunkMat);
      trunk.position.set(tx, 1.2, tz);
      trunk.castShadow = true;
      this.scene.add(trunk);
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0), leafMat);
      leaves.position.set(tx, 3.0, tz);
      leaves.castShadow = true;
      this.scene.add(leaves);
    }
  }

  private applyPeriodImmediate(period: TimePeriod): void {
    this.currentPeriod = period;
    this.currentPalette = paletteForPeriod(period);
    for (const bm of this.buildings) {
      bm.targetFloors = bm.spec.floors[period];
      bm.currentFloors = bm.targetFloors;
      this.rebuildBuildingGeometry(bm, period);
      bm.group.visible = bm.periodVisible[period];
    }
    for (const v of this.vehicles) {
      this.recolorVehicle(v, period);
    }
    for (const p of this.pedestrians) {
      (p.body.material as THREE.MeshStandardMaterial).color.setHex(this.pedestrianColor(period, 0));
    }
    this.applyPalette(this.currentPalette);
  }

  private recolorVehicle(v: VehicleMesh, period: TimePeriod): void {
    const colors: Record<TimePeriod, number[]> = {
      1945: [0x3a2a1e, 0x4a3a2a, 0x2a2a2a, 0x5a4a3a],
      1965: [0x884422, 0x556677, 0xccccaa, 0x664422],
      1985: [0xaa3322, 0x224488, 0x888888, 0x333333],
      2005: [0x222222, 0xcccccc, 0x88aabb, 0x333366],
      2025: [0x111114, 0xf0f0f0, 0x222a33, 0x2a4a5a],
    };
    const seed = Math.abs(Math.round(v.x * 3.1 + v.z * 1.7));
    (v.body.material as THREE.MeshStandardMaterial).color.setHex(colors[period][seed % 4]);
  }

  private applyPalette(p: PeriodPalette): void {
    this.scene.background = new THREE.Color(p.skyBottom);
    this.scene.fog = new THREE.FogExp2(p.fogColor, p.fogDensity);
    (this.ambient.color as THREE.Color).setHex(p.ambient);
    this.ambient.intensity = 0.55;
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.setHex(p.skyTop);
    this.hemi.groundColor.setHex(p.ground);
    (this.ground.material as THREE.MeshStandardMaterial).color.setHex(p.ground);
  }
  transitionToPeriod(period: TimePeriod): void {
    if (period === this.currentPeriod && !this.isTransitioning) return;
    if (this.isTransitioning) {
      this.currentPeriod = this.toPeriod;
      this.applyPeriodImmediate(this.currentPeriod);
    }
    this.fromPeriod = this.currentPeriod;
    this.toPeriod = period;
    this.isTransitioning = true;
    this.transitionTime = 0;
    for (const bm of this.buildings) {
      bm.targetFloors = bm.spec.floors[period];
    }
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  private updateTransition(deltaTime: number): void {
    if (!this.isTransitioning) return;
    this.transitionTime += deltaTime;
    const raw = Math.min(1, this.transitionTime / TRANSITION_DURATION);
    const t = this.easeInOut(raw);

    const fromPal = paletteForPeriod(this.fromPeriod);
    const toPal = paletteForPeriod(this.toPeriod);
    this.currentPalette = lerpPalette(fromPal, toPal, t);
    this.applyPalette(this.currentPalette);

    for (const bm of this.buildings) {
      const fromF = bm.spec.floors[this.fromPeriod];
      const toF = bm.spec.floors[this.toPeriod];
      const f = Math.round(fromF + (toF - fromF) * t);
      if (f !== bm.currentFloors) {
        bm.currentFloors = f;
        if (f <= 0) {
          bm.group.visible = false;
        } else {
          bm.group.visible = true;
          const activePeriod = t < 0.5 ? this.fromPeriod : this.toPeriod;
          this.rebuildBuildingGeometry(bm, activePeriod);
        }
      }
    }

    if (t > 0.5) {
      for (const v of this.vehicles) this.recolorVehicle(v, this.toPeriod);
      for (let i = 0; i < this.pedestrians.length; i++) {
        const p = this.pedestrians[i];
        (p.body.material as THREE.MeshStandardMaterial).color.setHex(this.pedestrianColor(this.toPeriod, i));
      }
    }

    if (raw >= 1) {
      this.isTransitioning = false;
      this.currentPeriod = this.toPeriod;
      this.applyPeriodImmediate(this.currentPeriod);
    }
  }

  startSimulation(): void {
    this.simTime = 8 * 3600;
  }

  update(deltaTime: number): SimulationState {
    if (this.disposed) {
      return this.makeState();
    }
    this.simTime += deltaTime * 600;
    if (this.simTime > 24 * 3600) this.simTime -= 24 * 3600;

    this.updateTransition(deltaTime);
    this.updateVehicles(deltaTime);
    this.updatePedestrians(deltaTime);
    this.updateSun(deltaTime);
    this.cameraController.update(deltaTime);

    return this.makeState();
  }

  private makeState(): SimulationState {
    return {
      period: this.toPeriod,
      transitionProgress: this.isTransitioning ? Math.min(1, this.transitionTime / TRANSITION_DURATION) : 1,
      isTransitioning: this.isTransitioning,
      population: this.pedestrians.length,
      vehicles: this.vehicles.length,
      simHour: (this.simTime / 3600) % 24,
      periodLabel: String(this.toPeriod),
    };
  }

  private updateVehicles(deltaTime: number): void {
    for (const v of this.vehicles) {
      v.offset += v.speed * v.dir * deltaTime;
      if (v.offset > 38) v.offset = -38;
      if (v.offset < -38) v.offset = 38;
      const r = this.roadOf(v);
      if (v.axis === 'h') {
        v.group.position.set(v.offset, 0.45, r + v.offset === 0 ? 0 : r);
        v.group.position.z = r;
      } else {
        v.group.position.set(r, 0.45, v.offset);
      }
      v.x = v.group.position.x;
      v.z = v.group.position.z;
      for (const w of v.wheels) w.rotation.x += v.speed * v.dir * deltaTime * 2;
    }
  }

  private roadOf(v: VehicleMesh): number {
    const baseX = v.axis === 'v' ? v.x : v.z;
    const nearest = [-22, 0, 22].reduce((a, b) => (Math.abs(b - baseX) < Math.abs(a - baseX) ? b : a));
    return nearest;
  }

  private updatePedestrians(deltaTime: number): void {
    for (const p of this.pedestrians) {
      p.offset += p.speed * p.dir * deltaTime;
      if (p.offset > 34) p.offset = -34;
      if (p.offset < -34) p.offset = 34;
      const base = p.axis === 'h' ? p.z : p.x;
      const nearest = [-22, 0, 22].reduce((a, b) => (Math.abs(b - base) < Math.abs(a - base) ? b : a));
      const lane = p.dir === 1 ? 3.2 : -3.2;
      if (p.axis === 'h') {
        p.group.position.set(p.offset, 0, nearest + lane);
      } else {
        p.group.position.set(nearest + lane, 0, p.offset);
      }
      p.group.rotation.y = p.axis === 'h' ? (p.dir === 1 ? Math.PI / 2 : -Math.PI / 2) : (p.dir === 1 ? 0 : Math.PI);
      p.x = p.group.position.x;
      p.z = p.group.position.z;
      p.body.position.y = 0.7 + Math.sin(p.offset * 6) * 0.05;
    }
  }

  private updateSun(deltaTime: number): void {
    void deltaTime;
    const hour = (this.simTime / 3600) % 24;
    const angle = ((hour - 6) / 12) * Math.PI;
    const r = 80;
    this.sun.position.set(Math.cos(angle) * r, Math.sin(angle) * r + 10, 30);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
    const night = Math.max(0, Math.sin(angle));
    this.ambient.intensity = 0.25 + night * 0.4;
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.cameraController.camera);
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.cameraController.camera;
  }

  getWorldBounds(): CameraBounds {
    return { ...this.worldBounds };
  }

  getCurrentPeriod(): TimePeriod {
    return this.currentPeriod;
  }

  getPeriods(): readonly TimePeriod[] {
    return TIME_PERIODS;
  }

  private setupResize(): void {
    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.cameraController.setAspect(window.innerWidth / window.innerHeight);
  };

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.cameraController.dispose();
    this.renderer.dispose();
    this.scene.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
  }
}
