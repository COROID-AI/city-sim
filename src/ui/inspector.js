/**
 * Entity inspector — click-to-inspect detail panel.
 *
 * Provides a DOM overlay (a side panel, not canvas drawing) so every citizen,
 * building, company, and vehicle can be inspected in great detail. The panel
 * is wired to the main canvas: a click is converted from screen coordinates
 * to world coordinates through the Camera (screenToWorld), and the world point
 * is resolved to an entity:
 *
 *   - Buildings are picked by tile hit-test on their footprint.
 *   - Citizens and vehicles are picked by proximity (within a pick radius).
 *
 * While a panel is open it refreshes every animation frame, so wealth, current
 * schedule stage, activity, path progress, vehicle speed/position, and company
 * books stay live as the simulation advances.
 *
 * The module is DOM-safe: in a headless (Node) environment initInspector still
 * records world/camera state and inspectAt still performs picking, but no DOM
 * work is attempted.
 *
 * Usage (from main.js or an integration harness):
 *   import { initInspector } from './ui/inspector.js';
 *   initInspector(city, camera, () => city.vehicles);
 */

// --- Tuning ------------------------------------------------------------------

/** Proximity radius (world px) used for clicking citizens/vehicles. */
const PICK_RADIUS = 18;

/** Maximum pointer movement (CSS px) before a click counts as a camera pan. */
const DRAG_TOLERANCE = 6;

const ZONE_LABELS = {
  residential: 'Residential',
  workplace: 'Workplace',
  entertainment: 'Entertainment',
  service: 'Service',
};

const SUBTYPE_LABELS = {
  shop: 'Shop',
  restaurant: 'Restaurant',
  park: 'Park',
};

const STAGE_LABELS = {
  sleep: 'Sleeping at home',
  'to-work': 'Commuting to work',
  work: 'Working',
  'to-entertain': 'Heading to entertainment',
  entertain: 'Entertaining',
  'to-home': 'Commuting home',
};

const ACTIVITY_LABELS = {
  walking: 'Walking',
  asleep: 'Asleep',
  'at-work': 'Working',
  entertain: 'Entertaining',
  idle: 'Idle',
};

const KIND_LABELS = {
  car: 'Car',
  bus: 'Bus',
  truck: 'Truck',
  bike: 'Bike',
};

// ----------------------------------------------------------------------------
// Module state (initialized by initInspector).
// ----------------------------------------------------------------------------

let state = null;

/** Deterministic hash used for building condition / deterministic detail. */
function hashSeed(n) {
  let x = (n >>> 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Building map fallback so a bare world (without buildingById) still works. */
function buildingById(world) {
  if (world.buildingById instanceof Map) return world.buildingById;
  const m = new Map();
  for (const b of world.buildings || []) m.set(b.id, b);
  return m;
}

function fmtMoney(v) {
  if (!Number.isFinite(v)) return '—';
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtPct(v) {
  if (!Number.isFinite(v)) return '—';
  return `${Math.round(v)}%`;
}

function fmtNum(v) {
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString();
}

// ----------------------------------------------------------------------------
// Panel DOM
// ----------------------------------------------------------------------------

function buildPanelDom() {
  const panel = state.panel;
  if (!panel) return;

  // Inline layout so the panel works even if the page has no matching CSS.
  Object.assign(panel.style, {
    position: 'fixed',
    right: '16px',
    top: '56px',
    width: '288px',
    maxHeight: 'calc(100vh - 76px)',
    overflowY: 'auto',
    background: 'rgba(13, 16, 26, 0.96)',
    color: '#d8dce4',
    border: '1px solid #2a2f3a',
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.55)',
    font: '13px/1.45 system-ui, sans-serif',
    zIndex: '100',
    display: 'none',
    padding: '0',
  });

  // Inject panel-specific scoped styles once.
  if (!document.getElementById('inspector-style')) {
    const style = document.createElement('style');
    style.id = 'inspector-style';
    style.textContent = `
      .insp-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 10px 12px;
        border-bottom: 1px solid #2a2f3a; background: rgba(255,255,255,0.03);
        border-radius: 8px 8px 0 0;
      }
      .insp-title { font-weight: 700; font-size: 14px; color: #f2f4f8; min-width: 0; }
      .insp-kind { font-size: 11px; color: #8b93a7; text-transform: uppercase; letter-spacing: 0.06em; }
      .insp-close {
        border: 1px solid #3a4152; background: transparent; color: #b9c0cf;
        border-radius: 5px; width: 24px; height: 24px; cursor: pointer;
        font-size: 15px; line-height: 1; flex: 0 0 auto;
      }
      .insp-close:hover { background: #3a4152; color: #fff; }
      .insp-body { padding: 8px 12px 12px; }
      .insp-row {
        display: flex; justify-content: space-between; gap: 12px;
        padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
      }
      .insp-row:last-child { border-bottom: none; }
      .insp-key { color: #8b93a7; white-space: nowrap; }
      .insp-val { color: #eef1f8; text-align: right; }
      .insp-list { color: #cdd3e1; padding: 2px 0 0; }
      .insp-list li { margin: 1px 0; }
      .insp-sect {
        margin-top: 8px; padding-top: 8px; border-top: 1px solid #2a2f3a;
        font-weight: 700; color: #a9c2ff; font-size: 11px;
        text-transform: uppercase; letter-spacing: 0.05em;
      }
    `;
    document.head.appendChild(style);
  }

  panel.innerHTML = '';
  state.title = document.createElement('div');
  state.title.className = 'insp-title';
  const kind = document.createElement('div');
  kind.className = 'insp-kind';
  state.kind = kind;
  const head = document.createElement('div');
  head.className = 'insp-head';
  const titleWrap = document.createElement('div');
  titleWrap.style.minWidth = '0';
  titleWrap.appendChild(kind);
  titleWrap.appendChild(state.title);
  const close = document.createElement('button');
  close.className = 'insp-close';
  close.textContent = '✕';
  close.title = 'Close inspector';
  close.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeInspector();
  });
  head.appendChild(titleWrap);
  head.appendChild(close);

  state.body = document.createElement('div');
  state.body.className = 'insp-body';

  panel.appendChild(head);
  panel.appendChild(state.body);
}

function getPanel() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('inspector-panel') || (() => {
    const el = document.createElement('div');
    el.id = 'inspector-panel';
    document.body.appendChild(el);
    return el;
  })();
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Attach the inspector to a running simulation.
 * @param {object} world  CityState (has buildings/citizens/companies).
 * @param {object} camera  Camera with screenToWorld() for click conversion.
 * @param {() => object[]} getVehicles  Callback returning the vehicle list.
 * @returns {object} Inspector state ({ close, refresh, isOpen }).
 */
export function initInspector(world, camera, getVehicles) {
  state = {
    world,
    camera,
    getVehicles: typeof getVehicles === 'function' ? getVehicles : () => [],
    panel: null,
    body: null,
    title: null,
    kind: null,
    pick: null,
    open: false,
    rafId: null,
    dragStart: null,
  };

  if (typeof document !== 'undefined' && world) {
    state.panel = getPanel();
    buildPanelDom();
    attachCanvasClick(camera);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeInspector();
      });
    }
  }

  return {
    close: closeInspector,
    refresh: refreshInspector,
    isOpen: () => !!state.open,
    inspectAt,
  };
}

/** Convert a canvas click to world space via the camera, then inspect. */
function attachCanvasClick(camera) {
  const canvas = document.getElementById('main-canvas') ||
    document.querySelector('canvas');
  if (!canvas) return;
  canvas.style.cursor = 'crosshair';

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && camera) {
      state.dragStart = { x: e.clientX, y: e.clientY };
    }
  });

  canvas.addEventListener('click', (e) => {
    // A pointer drag that moves the camera must NOT count as a click pick.
    if (state.dragStart) {
      const dx = e.clientX - state.dragStart.x;
      const dy = e.clientY - state.dragStart.y;
      state.dragStart = null;
      if (Math.hypot(dx, dy) > DRAG_TOLERANCE) return;
    }
    if (!camera || typeof camera.screenToWorld !== 'function') return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wp = camera.screenToWorld(sx, sy);
    inspectAt(wp.x, wp.y);
  });
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

/**
 * Inspect the entity under the given world (pixel) coordinate.
 * Picks the containing building first (tile hit-test), then the nearest
 * citizen or vehicle within the pick radius.
 *
 * @param {number} worldX  World-space x (px).
 * @param {number} worldY  World-space y (px).
 * @returns {{type: string, entity: object, company: ?object, distance: number}|null}
 */
export function inspectAt(worldX, worldY) {
  if (!state || !state.world) return null;
  const world = state.world;
  const ts = world.tileSize || 32;

  // 1) Building hit-test by tile footprint.
  const tileX = worldX / ts;
  const tileY = worldY / ts;
  for (const b of world.buildings || []) {
    const fp = b.footprint;
    if (!fp) continue;
    if (tileX >= fp.x && tileX < fp.x + fp.w && tileY >= fp.y && tileY < fp.y + fp.h) {
      const company = (world.companies || []).find((co) => co.buildingId === b.id) || null;
      const pick = { type: 'building', entity: b, company, distance: 0 };
      return showPick(pick);
    }
  }

  // 2) Nearest citizen / vehicle by proximity.
  const radius = Math.max(PICK_RADIUS, ts * 0.6);
  let best = null;
  for (const c of world.citizens || []) {
    if (c.tile && Number.isFinite(c.tile.x)) {
      const d = Math.hypot(c.tile.x * ts - worldX, c.tile.y * ts - worldY);
      if (d <= radius && (!best || d < best.distance)) {
        best = { type: 'citizen', entity: c, company: null, distance: d };
      }
    }
  }
  const vehicles = state.getVehicles ? state.getVehicles() : [];
  for (const v of vehicles || []) {
    const pos = vehiclePos(v, ts);
    if (!pos) continue;
    const d = Math.hypot(pos.x - worldX, pos.y - worldY);
    if (d <= radius && (!best || d < best.distance)) {
      best = { type: 'vehicle', entity: v, company: null, distance: d };
    }
  }

  if (best) return showPick(best);

  // 3) Nothing under the cursor: close the panel.
  closeInspector();
  return null;
}

/** World-space (px) position of a vehicle, tolerant of tile or raw coords. */
function vehiclePos(v, ts) {
  if (v && Number.isFinite(v.tileX) && Number.isFinite(v.tileY)) {
    return { x: v.tileX * ts, y: v.tileY * ts };
  }
  if (v && v.tile && Number.isFinite(v.tile.x)) {
    return { x: v.tile.x * ts, y: v.tile.y * ts };
  }
  if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) {
    return { x: v.x, y: v.y };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Panel lifecycle
// ---------------------------------------------------------------------------

function showPick(pick) {
  state.pick = pick;
  state.open = true;
  if (state.panel) state.panel.style.display = 'block';
  refreshInspector();
  ensureLoop();
  return pick;
}

function closeInspector() {
  if (!state) return;
  state.open = false;
  state.pick = null;
  if (state.rafId !== null) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  if (state.panel) state.panel.style.display = 'none';
}

function ensureLoop() {
  if (state.rafId !== null) return;
  if (typeof requestAnimationFrame !== 'function') return;
  const step = () => {
    if (!state.open) {
      state.rafId = null;
      return;
    }
    refreshInspector();
    state.rafId = requestAnimationFrame(step);
  };
  state.rafId = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function row(key, value) {
  if (value === undefined || value === null) value = '—';
  return `<div class="insp-row"><span class="insp-key">${key}</span><span class="insp-val">${value}</span></div>`;
}

/** Render the current pick into the panel body (no-op when DOMless). */
function refreshInspector() {
  if (!state || !state.body || !state.pick) return;
  const pick = state.pick;
  let html = '';
  let kind = pick.type;
  let title = '';
  if (pick.type === 'citizen') {
    title = pick.entity.name || 'Citizen';
    html = renderCitizen(pick.entity);
  } else if (pick.type === 'building') {
    title = pick.entity.name || 'Building';
    kind = pick.company ? 'Building + Company' : 'Building';
    html = renderBuilding(pick.entity, pick.company);
  } else if (pick.type === 'vehicle') {
    title = `${KIND_LABELS[pick.entity.kind] || pick.entity.kind || 'Vehicle'} #${pick.entity.id}`;
    html = renderVehicle(pick.entity);
  } else {
    return;
  }
  state.kind.textContent = kind;
  state.title.textContent = title;
  state.body.innerHTML = html;
  if (state.panel) state.panel.scrollTop = 0;
}

/** Resolve the citizens assigned to a company (roster or by id). */
function companyEmployees(company, world) {
  if (Array.isArray(company.employeeRoster) && company.employeeRoster.length) {
    return company.employeeRoster;
  }
  const byId = new Map((world.citizens || []).map((c) => [c.id, c]));
  return (company.employeeIds || [])
    .map((id) => byId.get(id))
    .filter(Boolean);
}

function lis(items, max = 99) {
  if (!items.length) return 'None';
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}`;
}

// --- Citizen ----------------------------------------------------------------

function destinationFor(c, world) {
  const bm = buildingById(world);
  const b = (cid) => (cid != null ? bm.get(cid) : null);
  if (c.phase === 'to-work' || c.phase === 'work') {
    const wb = b(c.workplaceId);
    return wb ? wb.name : (c.workplaceName || '—');
  }
  if (c.phase === 'to-entertain' || c.phase === 'entertain') {
    const vb = b(c.venueId);
    return vb ? vb.name : (c.venueName || 'Entertainment venue');
  }
  if (c.phase === 'to-home') {
    const hb = b(c.homeId);
    return hb ? hb.name : (c.homeName || 'Home');
  }
  if (c.phase === 'sleep') {
    const hb = b(c.homeId);
    return hb ? hb.name : (c.homeName || 'Home');
  }
  return '—';
}

function pathProgress(c) {
  const path = c.path;
  if (!Array.isArray(path) || !path.length) return '—';
  const idx = Math.min(c.pathIndex || 0, path.length);
  const pct = Math.round((idx / path.length) * 100);
  return `${pct}% (${idx}/${path.length} steps)`;
}

function renderCitizen(c) {
  const bm = buildingById(state.world);
  const home = bm.get(c.homeId);
  const rows = [];
  rows.push(row('Age', `${c.age} · ${c.gender || '—'}`));
  rows.push(row('Job', c.jobTitle || (c.employed ? 'Employed' : 'Unemployed')));
  rows.push(row('Employer', c.companyName || (c.employed ? '—' : 'Unemployed')));
  rows.push(row('Home', home ? home.name : (c.homeName || '—')));
  rows.push(row('Stage', STAGE_LABELS[c.phase] || c.phase || '—'));
  rows.push(row('Destination', destinationFor(c, state.world)));
  rows.push(row('Wealth', fmtMoney(c.wallet ?? c.money)));
  rows.push(row('Salary', c.salary > 0 ? `${fmtMoney(c.salary)}/day` : '—'));
  rows.push(row('Happiness', `${c.happiness ?? '—'}%`));
  rows.push(row('Activity', ACTIVITY_LABELS[c.animation] || c.animation || '—'));
  rows.push(row('Path progress', pathProgress(c)));
  rows.push(row('Position', `(${c.tile ? c.tile.x.toFixed(1) : '—'}, ${c.tile ? c.tile.y.toFixed(1) : '—'})`));
  return rows.join('');
}

// --- Building ----------------------------------------------------------------

function residentsOf(b, world) {
  return (world.citizens || []).filter((c) => c.homeId === b.id);
}

function workersOf(b, world) {
  return (world.citizens || []).filter((c) => c.workplaceId === b.id);
}

function occupantsOf(b, world, ts) {
  const fp = b.footprint;
  return (world.citizens || []).filter((c) =>
    c.tile &&
    c.tile.x >= fp.x && c.tile.x < fp.x + fp.w &&
    c.tile.y >= fp.y && c.tile.y < fp.y + fp.h);
}

function conditionFor(b) {
  const raw = hashSeed(b.detailSeed || b.id || 1) % 100;
  const label = raw >= 75 ? 'Excellent' : raw >= 55 ? 'Good' : raw >= 30 ? 'Fair' : 'Poor';
  return `${label} (${raw}%)`;
}

function renderBuilding(b, company) {
  const ts = state.world.tileSize || 32;
  const fp = b.footprint;
  const residents = residentsOf(b, state.world);
  const workers = workersOf(b, state.world);
  const occupants = occupantsOf(b, state.world, ts);
  const rows = [];
  rows.push(row('Type', `${ZONE_LABELS[b.zone] || b.zone}${b.subType ? ` · ${SUBTYPE_LABELS[b.subType] || b.subType}` : ''}`));
  rows.push(row('Address', `${b.name} · tiles (${fp.x}–${fp.x + fp.w - 1}, ${fp.y}–${fp.y + fp.h - 1})`));
  rows.push(row('ID', b.id));
  rows.push(row('Occupants', fmtNum(occupants.length)));
  rows.push(row('Residents', `${fmtNum(residents.length)}${residents.length ? `: ${lis(residents.slice(0, 3).map((c) => c.name))}` : ''}`));
  rows.push(row('Workers', workers.length));
  rows.push(row('Capacity', b.capacity ?? '—'));
  rows.push(row('Condition', conditionFor(b)));
  const html = rows.join('');

  if (company) {
    return `${html}${renderCompany(company)}`;
  }
  return html;
}

// --- Company ------------------------------------------------------------------

function renderCompany(co) {
  const employees = companyEmployees(co, state.world);
  const rows = [];
  rows.push('<div class="insp-sect">Company</div>');
  rows.push(row('Name', co.name));
  rows.push(row('Industry', co.industry || co.sector || '—'));
  rows.push(row('Located', co.building ? co.building.name : '—'));
  rows.push(row('Employees', `${fmtNum(employees.length)}${employees.length ? `: ${lis(employees.slice(0, 8).map((c) => `${c.name} (${c.jobTitle || 'staff'})`))}` : ''}`));
  rows.push(row('Revenue', `${fmtMoney(co.revenue)}/hr`));
  rows.push(row('Expenses', `${fmtMoney(co.expenses)}/hr`));
  if (Number.isFinite(co.wages)) {
    rows.push(row('Wages', `${fmtMoney(co.wages)}/hr`));
  } else if (Number.isFinite(co.wageBill)) {
    rows.push(row('Wages', `${fmtMoney(co.wageBill)}/day`));
  }
  rows.push(row('Profit', `${fmtMoney(co.profit)}/hr`));
  if (Number.isFinite(co.cash)) rows.push(row('Cash reserve', fmtMoney(co.cash)));
  if (Number.isFinite(co.reputation)) rows.push(row('Reputation', fmtPct(co.reputation)));
  return rows.join('');
}

// --- Vehicle -------------------------------------------------------------------

function vehicleRoute(v) {
  if (v && (v.origin || v.destination)) {
    const o = typeof v.origin === 'object' ? (v.origin.name || `${v.origin.x},${v.origin.y}`) : (v.origin ?? '—');
    const d = typeof v.destination === 'object' ? (v.destination.name || `${v.destination.x},${v.destination.y}`) : (v.destination ?? '—');
    return `${o} → ${d}`;
  }
  if (v && Array.isArray(v.route) && v.route.length) {
    const o = v.route[0];
    const d = v.route[v.route.length - 1];
    const fmt = (p) => (typeof p === 'object' ? (p.name || `${p.x},${p.y}`) : p);
    return `${fmt(o)} → ${fmt(d)}`;
  }
  return '—';
}

function vehicleOccupant(v, world) {
  if (v.occupant && typeof v.occupant === 'object') {
    if (v.occupant.name) return v.occupant.name;
    if (v.occupant.id != null) {
      const c = (world.citizens || []).find((cit) => cit.id === v.occupant.id);
      return c ? c.name : `citizen #${v.occupant.id}`;
    }
  }
  const id = v.occupantId ?? v.passengerId ?? v.ownerId ?? v.driverId;
  if (id != null) {
    const c = (world.citizens || []).find((cit) => cit.id === id);
    if (c) return c.name;
    return `citizen #${id}`;
  }
  if (typeof v.occupant === 'string') return v.occupant;
  return 'None';
}

function renderVehicle(v) {
  const rows = [];
  rows.push(row('ID', v.id));
  rows.push(row('Type', KIND_LABELS[v.kind] || v.kind || 'Vehicle'));
  rows.push(row('Route', vehicleRoute(v)));
  rows.push(row('State', v.state || '—'));
  rows.push(row('Speed', `${v.speed ?? '—'} t/s`));
  rows.push(row('Occupant', vehicleOccupant(v, state.world)));
  if (v.tile || (Number.isFinite(v.x) && Number.isFinite(v.y))) {
    const p = vehiclePos(v, state.world.tileSize || 32);
    if (p) rows.push(row('Position', `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`));
  }
  if (Number.isFinite(v.progress)) rows.push(row('Progress', `${Math.round(v.progress * 100)}%`));
  return rows.join('');
}