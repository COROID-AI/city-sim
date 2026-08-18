/* CitySim inspector — entity detail panel and pick logic. */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function init(panel) {
    var body = panel.querySelector('[data-testid="inspector-body"]');
    return { panel: panel, body: body, selected: null, kind: null };
  }

  function buildingAt(buildings, tx, ty) {
    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      if (tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) return b;
    }
    return null;
  }

  // Nearest-entity picking with a generous pixel radius; buildings as fallback.
  function pickAt(sx, sy, camera, ctx, cfg) {
    var utils = CitySim.utils;
    var best = null, bestD = cfg.pickRadiusPx;
    var i, d;

    for (i = 0; i < ctx.citizens.length; i++) {
      var c = ctx.citizens[i];
      d = utils.dist(sx, sy, (c.current.pos.x - camera.x) * camera.zoom, (c.current.pos.y - camera.y) * camera.zoom);
      if (d <= bestD) { bestD = d; best = { kind: 'citizen', entity: c, distPx: d }; }
    }
    for (i = 0; i < ctx.vehicles.length; i++) {
      var v = ctx.vehicles[i];
      d = utils.dist(sx, sy, (v.pos.x - camera.x) * camera.zoom, (v.pos.y - camera.y) * camera.zoom);
      if (d <= bestD) { bestD = d; best = { kind: 'vehicle', entity: v, distPx: d }; }
    }
    if (best) return best;

    var world = CitySim.camera.screenToWorld(camera, sx, sy);
    var tile = ctx.city.worldToTile(world.x, world.y);
    var b = buildingAt(ctx.buildings, tile.x, tile.y);
    if (b) return { kind: 'building', entity: b, distPx: 0 };
    return null;
  }

  function select(insp, sel) {
    insp.selected = sel ? sel.entity : null;
    insp.kind = sel ? sel.kind : null;
    if (insp.panel) insp.panel.classList.toggle('open', !!sel);
  }

  function deselect(insp) { select(insp, null); }

  function rowsToHtml(rows) {
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="row"><span class="kv">' + rows[i][0] + '</span><b>' + rows[i][1] + '</b></div>';
    }
    return html;
  }

  function scheduleSummary(c) {
    var u = CitySim.utils;
    var parts = [];
    parts.push(u.formatTime(c.wakeMin) + ' wake');
    if (c.workId != null) {
      parts.push(u.formatTime(c.leaveHomeMin) + ' work');
      parts.push('12:00 lunch');
      parts.push('17:00 out');
    }
    parts.push('21:00 home');
    return parts.join(' · ');
  }

  function renderDetail(kind, entity, sim, ctx) {
    var u = CitySim.utils;
    var bById = CitySim.buildings.buildingById;
    var cById = CitySim.citizens.citizenById;
    var compById = CitySim.companies.companyById;

    if (kind === 'citizen') {
      var c = entity;
      var home = bById(ctx.buildings, c.homeId);
      var work = c.workId != null ? bById(ctx.buildings, c.workId) : null;
      var company = c.companyId != null ? compById(ctx.companies, c.companyId) : null;
      var rows = [
        ['Name', c.name],
        ['Age', String(c.age)],
        ['Gender', c.gender],
        ['Activity', c.current.activity],
        ['Cash', u.formatMoney(c.cash)],
        ['Wage', c.wage > 0 ? '$' + c.wage + '/day' : '—'],
        ['Home', home ? home.name : '—'],
        ['Work', work ? work.name : 'Unemployed'],
        ['Employer', company ? company.name : '—'],
        ['Wake', u.formatTime(c.wakeMin)],
        ['Leave home', u.formatTime(c.leaveHomeMin)],
        ['Work start', c.workId != null ? u.formatTime(c.workStartMin) : '—'],
        ['Schedule', scheduleSummary(c)]
      ];
      return rowsToHtml(rows);
    }

    if (kind === 'vehicle') {
      var v = entity;
      var owner = v.ownerId != null ? cById(ctx.citizens, v.ownerId) : null;
      var ownerName = owner ? owner.name : v.kind === 'bus' ? 'City Transit' : v.kind === 'truck' ? 'Freight Co.' : '—';
      var rows = [
        ['Vehicle', v.kind.charAt(0).toUpperCase() + v.kind.slice(1)],
        ['Plate', v.plate],
        ['Speed', v.speed.toFixed(1) + ' tiles/min'],
        ['Status', v.path.length ? 'Driving' : 'Parked'],
        ['Owner', ownerName]
      ];
      return rowsToHtml(rows);
    }

    if (kind === 'building') {
      var b = entity;
      var comp = b.companyId != null ? compById(ctx.companies, b.companyId) : null;
      var rows = [
        ['Building', b.name],
        ['Type', b.type.charAt(0).toUpperCase() + b.type.slice(1)],
        ['Size', b.w + '×' + b.h + ' tiles'],
        ['Jobs', String(b.jobs)],
        ['Residents', String(b.residents.length)],
        ['Company', comp ? comp.name : '—']
      ];
      if (comp) {
        rows.push(['Employees', String(comp.employees.length)]);
        rows.push(['Revenue (hr)', u.formatMoney(comp.revenue)]);
        rows.push(['Expenses (hr)', u.formatMoney(comp.expenses)]);
        rows.push(['Profit (hr)', u.formatMoney(comp.profit)]);
        rows.push(['Budget', u.formatMoney(comp.budget)]);
        rows.push(['Hours', u.formatTime(comp.openHour * 60) + ' – ' + u.formatTime(comp.closeHour * 60)]);
      }
      return rowsToHtml(rows);
    }

    return '<p class="hint">Select an entity.</p>';
  }

  function update(insp, sim, ctx) {
    if (!insp.selected || !insp.body) return;
    var html = renderDetail(insp.kind, insp.selected, sim, ctx);
    if (insp.body.innerHTML !== html) insp.body.innerHTML = html;
  }

  CitySim.inspector = {
    init: init,
    pickAt: pickAt,
    select: select,
    deselect: deselect,
    update: update,
    renderDetail: renderDetail
  };
})(typeof window !== 'undefined' ? window : globalThis);