/* CitySim citizens — daily schedule state machine and movement. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  var FIRST = ['Adam', 'Bella', 'Carla', 'Dmitri', 'Elena', 'Felix', 'Grace', 'Hugo', 'Iris', 'Jonas', 'Kira', 'Liam', 'Mia', 'Nora', 'Oscar', 'Petra', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Umar', 'Vera', 'Walt', 'Yara', 'Zane', 'Ava', 'Ben', 'Cleo', 'Dan', 'Eve', 'Finn', 'Gia', 'Hank', 'Ivy', 'Jude', 'Lena', 'Milo', 'Nina', 'Owen', 'Pia', 'Rex', 'Sofia', 'Theo', 'Uma', 'Vince', 'Wendy', 'Xander', 'Zoe'];
  var LAST = ['Adams', 'Baker', 'Chen', 'Davis', 'Evans', 'Foster', 'Garcia', 'Hughes', 'Ivanov', 'Johnson', 'Kim', 'Lopez', 'Miller', 'Novak', 'Olsen', 'Patel', 'Quinn', 'Rossi', 'Smith', 'Tanaka', 'Ueda', 'Vogel', 'Walsh', 'Yamada', 'Zhang', 'Brown', 'Clark', 'Diaz', 'Edwards', 'Ford', 'Green', 'Hill', 'Irwin', 'Jones', 'Klein', 'Lewis', 'Moore', 'Nelson', 'Owens', 'Parker', 'Reed', 'Sato', 'Turner', 'Upton', 'Walker', 'Young', 'Zimmer'];
  var GENDERS = ['male', 'female'];

  function buildingById(buildings, id) {
    for (var i = 0; i < buildings.length; i++) {
      if (buildings[i].id === id) return buildings[i];
    }
    return null;
  }

  function entranceTileOf(ctx, buildingId) {
    var b = buildingById(ctx.buildings, buildingId);
    return b ? b.entrance : { x: 0, y: 0 };
  }

  function entranceWorldOf(ctx, buildingId) {
    var b = buildingById(ctx.buildings, buildingId);
    return b ? CitySim.buildings.entranceWorld(ctx.city, b) : { x: 0, y: 0 };
  }

  function create(cfg, city, buildings, companies) {
    var utils = CitySim.utils;
    var rng = city.rng;
    var residents = buildings.filter(function (b) { return b.type === 'residential'; });
    var entBuildings = buildings.filter(function (b) { return b.type === 'entertainment'; });
    var citizens = [];

    for (var i = 0; i < cfg.citizens; i++) {
      var home = utils.pick(rng, residents);
      var employed = !utils.chance(rng, cfg.unemployedRate);
      var work = null, company = null;
      if (employed && companies.length) {
        // Prefer an employer reasonably far from home so the morning commute is
        // actually visible (citizens are mid-travel at load and during work hours).
        for (var tries = 0; tries < 4; tries++) {
          company = utils.pick(rng, companies);
          work = buildingById(buildings, company.buildingId);
          if (work) {
            var hx = home.entrance.x + 0.5, hy = home.entrance.y + 0.5;
            var wx = work.entrance.x + 0.5, wy = work.entrance.y + 0.5;
            if (utils.distSq(hx, hy, wx, wy) >= 8 * 8) break;
          }
        }
        if (!work) { employed = false; company = null; }
      }

      var ent = entBuildings.length ? utils.pick(rng, entBuildings) : home;
      var workStartMin = utils.randInt(rng, 480, 540);       // 08:00-09:00
      var wakeMin = utils.randInt(rng, 360, 450);            // 06:00-07:30
      if (workStartMin - wakeMin < 45) wakeMin = workStartMin - 75;
      var leaveHomeMin = wakeMin + utils.randInt(rng, 15, 25);

      var lunchId = null;
      var entRest = buildings.filter(function (b) { return b.type === 'entertainment' && b.id !== ent.id; });
      if (entRest.length && utils.chance(rng, 0.6)) lunchId = utils.pick(rng, entRest).id;

      var citizen = {
        id: i,
        name: utils.pick(rng, FIRST) + ' ' + utils.pick(rng, LAST),
        gender: utils.pick(rng, GENDERS),
        age: utils.randInt(rng, 18, 75),
        homeId: home.id,
        workId: employed ? work.id : null,
        companyId: employed ? company.id : null,
        wage: employed ? company.wage : 0,
        cash: utils.randInt(rng, 200, 2000),
        mood: 0.8 + rng() * 0.2,
        workStartMin: workStartMin,
        wakeMin: wakeMin,
        leaveHomeMin: leaveHomeMin,
        lunchId: lunchId,
        entId: ent.id,
        speed: utils.rand(rng, cfg.speeds.walk * 0.8, cfg.speeds.walk * 1.2),
        current: null,
        stats: { workDays: 0, trips: 0 }
      };

      home.residents.push(citizen.id);
      if (employed) company.employees.push(citizen.id);
      citizens.push(citizen);
    }
    return citizens;
  }

  // Schedule planner: given minutes-of-day m, return the activity descriptor.
  function planAt(citizen, m) {
    if (!citizen.workId) {
      // Unemployed: sleep, home, entertainment out, home
      if (m < citizen.wakeMin) return { activity: 'SLEEP', endMin: citizen.wakeMin, targetId: citizen.homeId };
      if (m < 720) return { activity: 'HOME', endMin: 720, targetId: citizen.homeId };
      if (m < 750) return { activity: 'TRAVEL', endMin: 750, targetId: citizen.entId, destActivity: 'ENTERTAINMENT', destEndMin: 1260 };
      if (m < 1260) return { activity: 'ENTERTAINMENT', endMin: 1260, targetId: citizen.entId };
      return { activity: 'HOME', endMin: 1440, targetId: citizen.homeId };
    }

    if (m < citizen.wakeMin) return { activity: 'SLEEP', endMin: citizen.wakeMin, targetId: citizen.homeId };
    if (m < citizen.leaveHomeMin) return { activity: 'HOME', endMin: citizen.leaveHomeMin, targetId: citizen.homeId };
    if (m < citizen.workStartMin) return { activity: 'TRAVEL', endMin: citizen.workStartMin, targetId: citizen.workId, destActivity: 'WORK', destEndMin: 720 };
    if (m < 720) return { activity: 'WORK', endMin: 720, targetId: citizen.workId };
    if (m < 750) {
      if (citizen.lunchId) return { activity: 'TRAVEL', endMin: 750, targetId: citizen.lunchId, destActivity: 'LUNCH', destEndMin: 780 };
      return { activity: 'WORK', endMin: 750, targetId: citizen.workId };
    }
    if (m < 780) {
      if (citizen.lunchId) return { activity: 'LUNCH', endMin: 780, targetId: citizen.lunchId };
      return { activity: 'WORK', endMin: 780, targetId: citizen.workId };
    }
    if (m < 1020) return { activity: 'WORK', endMin: 1020, targetId: citizen.workId };
    if (m < 1080) return { activity: 'TRAVEL', endMin: 1080, targetId: citizen.entId, destActivity: 'ENTERTAINMENT', destEndMin: 1260 };
    if (m < 1260) return { activity: 'ENTERTAINMENT', endMin: 1260, targetId: citizen.entId };
    if (m < 1320) return { activity: 'TRAVEL', endMin: 1320, targetId: citizen.homeId, destActivity: 'HOME', destEndMin: 1440 };
    return { activity: 'HOME', endMin: 1440, targetId: citizen.homeId };
  }

  function startActivity(citizen, plan, ctx, atMin, day) {
    var prevPos = citizen.current
      ? { x: citizen.current.pos.x, y: citizen.current.pos.y }
      : entranceWorldOf(ctx, citizen.homeId);

    citizen.current = {
      activity: plan.activity,
      endMin: plan.endMin,
      targetId: plan.targetId,
      destActivity: plan.destActivity || null,
      destEndMin: plan.destEndMin || null,
      path: [],
      pathIndex: 0,
      pos: { x: prevPos.x, y: prevPos.y },
      travelFromMin: atMin,
      day: day
    };

    if (plan.activity === 'TRAVEL') {
      var from = ctx.city.worldToTile(prevPos.x, prevPos.y);
      var to = entranceTileOf(ctx, plan.targetId);
      var path = CitySim.pathfinding.cachedFindPath(ctx.city, from.x, from.y, to.x, to.y, ctx.city.isPassableCitizen, 'citizen');
      citizen.current.path = path || [];
      citizen.current.pos = ctx.city.tileToWorld(from.x, from.y);
    } else {
      citizen.current.pos = entranceWorldOf(ctx, plan.targetId);
    }
  }

  function advancePath(citizen, distPx, ctx) {
    var path = citizen.current.path;
    if (!path.length) return;
    var ts = ctx.config.tileSize;
    var remaining = distPx;
    var guard = 0;
    while (remaining > 0 && citizen.current.pathIndex < path.length && guard++ < 256) {
      var wp = path[citizen.current.pathIndex];
      var wpX = (wp.x + 0.5) * ts, wpY = (wp.y + 0.5) * ts;
      var dx = wpX - citizen.current.pos.x, dy = wpY - citizen.current.pos.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= remaining || d < 0.001) {
        citizen.current.pos.x = wpX;
        citizen.current.pos.y = wpY;
        citizen.current.pathIndex++;
        remaining -= d;
      } else {
        citizen.current.pos.x += (dx / d) * remaining;
        citizen.current.pos.y += (dy / d) * remaining;
        remaining = 0;
      }
    }
  }

  function arrive(citizen, ctx, day) {
    var cur = citizen.current;
    citizen.current = {
      activity: cur.destActivity || 'HOME',
      endMin: cur.destEndMin != null ? cur.destEndMin : 1440,
      targetId: cur.targetId,
      destActivity: null,
      destEndMin: null,
      path: [],
      pathIndex: 0,
      pos: entranceWorldOf(ctx, cur.targetId),
      travelFromMin: cur.endMin,
      day: day
    };
    citizen.stats.trips++;
    if (citizen.current.activity === 'WORK') citizen.stats.workDays++;
  }

  // Fast-forward a citizen from 00:00 to simMin (teleporting through travel legs).
  function syncToTime(citizen, simMin, ctx) {
    citizen.current = {
      activity: 'SLEEP',
      endMin: citizen.wakeMin,
      targetId: citizen.homeId,
      destActivity: null,
      destEndMin: null,
      path: [],
      pathIndex: 0,
      pos: entranceWorldOf(ctx, citizen.homeId),
      travelFromMin: 0,
      day: 1
    };
    var guard = 0;
    while (guard++ < 80) {
      var cur = citizen.current;
      if (cur.activity === 'TRAVEL') {
        // If this travel leg is still ongoing at simMin, keep it (positioned
        // part way below); only teleport past legs that already ended.
        if (simMin >= cur.endMin) {
          citizen.current.activity = cur.destActivity;
          citizen.current.endMin = cur.destEndMin != null ? cur.destEndMin : 1440;
          citizen.current.targetId = cur.targetId;
          citizen.current.destActivity = null;
          citizen.current.destEndMin = null;
          citizen.current.path = [];
          citizen.current.pathIndex = 0;
          citizen.current.pos = entranceWorldOf(ctx, cur.targetId);
          continue;
        }
        break;
      }
      if (simMin < cur.endMin) break;
      var next = planAt(citizen, cur.endMin);
      startActivity(citizen, next, ctx, cur.endMin, 1);
      if (citizen.current.activity === 'TRAVEL' && simMin < citizen.current.endMin) break;
    }
    // If we ended mid-travel, place the citizen part way so the city is alive at load.
    if (citizen.current.activity === 'TRAVEL') {
      var elapsed = Math.max(0, simMin - citizen.current.travelFromMin);
      advancePath(citizen, elapsed * citizen.speed * ctx.config.tileSize, ctx);
      if (citizen.current.pathIndex >= citizen.current.path.length) {
        arrive(citizen, ctx, 1);
      }
    }
  }

  function update(citizen, sim, ctx) {
    var cur = citizen.current;
    var dtSim = sim.dtSimMin || 0;
    if (cur.activity === 'TRAVEL') {
      advancePath(citizen, dtSim * citizen.speed * ctx.config.tileSize, ctx);
      if (citizen.current.pathIndex >= citizen.current.path.length) {
        arrive(citizen, ctx, sim.day);
      }
    } else if (sim.min >= cur.endMin || citizen.current.day < sim.day) {
      // A night HOME anchor (endMin 1440) survives the clock rollover; when the
      // day flips, plan the next day's start instead of looping on 1440.
      var dayRolled = citizen.current.day < sim.day || cur.endMin >= 1440;
      var transitionAt = dayRolled ? 0 : cur.endMin;
      var next = planAt(citizen, transitionAt);
      startActivity(citizen, next, ctx, dayRolled ? 1440 : cur.endMin, sim.day);
    }
  }

  function citizenById(citizens, id) {
    for (var i = 0; i < citizens.length; i++) {
      if (citizens[i].id === id) return citizens[i];
    }
    return null;
  }

  CitySim.citizens = {
    create: create,
    syncToTime: syncToTime,
    update: update,
    planAt: planAt,
    buildingById: buildingById,
    citizenById: citizenById
  };
})(typeof window !== 'undefined' ? window : globalThis);