/* Weapon systems: projectiles, held laser with heat, incoming asteroids,
 * descending nukes, black holes, and hitscan railgun slugs.
 *
 * All six weapons funnel through impact(): decal queue -> effects burst ->
 * audio -> trauma -> damage callback. Damage numbers come from config.js.
 */

import * as THREE from 'three';
import { PLANET_RADIUS as R, WEAPONS } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);

function randUnit(target) {
  const u = Math.random() * Math.PI * 2;
  const v = Math.acos(2 * Math.random() - 1);
  return target.set(
    Math.sin(v) * Math.cos(u),
    Math.cos(v),
    Math.sin(v) * Math.sin(u)
  );
}

/* Quadratic bezier flight for arcing projectiles. */
function bezier(out, a, b, c, t) {
  const it = 1 - t;
  out.set(
    it * it * a.x + 2 * it * t * b.x + t * t * c.x,
    it * it * a.y + 2 * it * t * b.y + t * t * c.y,
    it * it * a.z + 2 * it * t * b.z + t * t * c.z
  );
  return out;
}

export class Weapons {
  constructor({ scene, planet, effects, audio, ui, shake, flashScreen, onDamage, onShot }) {
    this.scene = scene;
    this.planet = planet;
    this.effects = effects;
    this.audio = audio;
    this.ui = ui;
    this.shake = shake;              // (amount) => void
    this.flashScreen = flashScreen;  // (opacity) => void
    this.onDamage = onDamage;        // (power, def) => void
    this.onShot = onShot;            // () => void

    this.selected = 0;
    this.firing = false;
    this.aim = null;                 // { point:Vector3, normal:Vector3 } | null
    this.cds = WEAPONS.map(() => 0);
    this.projectiles = [];
    this.holes = [];
    this.tracers = [];
    this.satPos = new THREE.Vector3();

    /* laser state */
    this.heat = 0;
    this.overheated = false;
    this.laserTickT = 0;
    this.beamCore = null;
    this.beamGlow = null;

    /* shared geometry / materials */
    this.missileGeo = new THREE.ConeGeometry(0.16, 0.9, 8);
    this.missileMat = new THREE.MeshBasicMaterial({ color: 0xd8e2ec });
    this.flameTex = this._makeFlame();
    this.rockGeo = new THREE.IcosahedronGeometry(1, 1);
    this.rockMat = new THREE.MeshStandardMaterial({
      color: 0x6f5b48, roughness: 0.95, metalness: 0.05, flatShading: true
    });
    this.warheadGeo = new THREE.CapsuleGeometry(0.22, 1.1, 4, 10);
    this.warheadMat = new THREE.MeshStandardMaterial({
      color: 0x9aa7b4, roughness: 0.4, metalness: 0.6
    });
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xff4a2a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.beamGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff8855, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.tracerMat = new THREE.MeshBasicMaterial({
      color: 0xbfe4ff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.unitCyl.translate(0, 0.5, 0); // origin at base -> scale to length

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();

    this._buildBeam();
  }

  _makeFlame() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,230,1)');
    g.addColorStop(0.35, 'rgba(255,170,60,0.9)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  _buildBeam() {
    this.beamCore = new THREE.Mesh(this.unitCyl, this.beamMat);
    this.beamGlow = new THREE.Mesh(this.unitCyl, this.beamGlowMat);
    this.beamCore.visible = false;
    this.beamGlow.visible = false;
    this.scene.add(this.beamCore, this.beamGlow);
  }

  select(i) {
    if (this.firing) this.endFire();
    this.selected = i;
    this.ui.setSelectedRef(i);
    this.ui.select(i);
    this.audio.uiClick(500 + i * 70);
  }

  reset() {
    this.endFire();
    for (const p of this.projectiles) this._removeMesh(p.mesh, p.flame);
    this.projectiles.length = 0;
    for (const h of this.holes) this._collapseHole(h, true);
    for (const tr of this.tracers) this.scene.remove(tr.mesh);
    this.tracers.length = 0;
    this.cds.fill(0);
    this.heat = 0;
    this.overheated = false;
    this.ui.hot(false);
    this.audio.stopLaser();
  }

  _removeMesh(mesh, flame) {
    this.scene.remove(mesh);
    if (flame) this.scene.remove(flame);
  }

  /* ---------------- firing ---------------- */

  beginFire(aim, camera) {
    this.firing = true;
    this.aim = aim;
    if (!aim) return;
    const def = WEAPONS[this.selected];
    if (def.id === 'laser') { this.laserTickT = 999; return; }
    if (this.cds[this.selected] > 0) return;
    this.onShot();
    this.cds[this.selected] = def.cooldown;

    switch (def.id) {
      case 'missile': this._launchMissile(def, aim, camera); break;
      case 'asteroid': this._dropRock(def, aim); break;
      case 'nuke': this._dropNuke(def, aim); break;
      case 'blackhole': this._openHole(def, aim); break;
      case 'railgun': this._fireRailgun(def, aim); break;
    }
  }

  endFire() {
    this.firing = false;
    this.beamCore.visible = false;
    this.beamGlow.visible = false;
    this.audio.stopLaser();
  }

  update(dt, aim, camera, time) {
    void time;
    this.aim = aim;

    for (let i = 0; i < this.cds.length; i++) {
      if (this.cds[i] > 0) {
        this.cds[i] = Math.max(0, this.cds[i] - dt);
        this.ui.cooldown(i, this.cds[i] / WEAPONS[i].cooldown);
      } else {
        this.ui.cooldown(i, 0);
      }
    }

    /* orbital emitter platform the beam comes from */
    this.satPos.copy(camera.position).normalize().applyAxisAngle(UP, 0.22)
      .multiplyScalar(R * 2.1);

    if (this.firing && this.selected === 1 && aim) this._updateLaser(dt, aim);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const u = Math.min(1, p.t / p.dur);
      bezier(p.mesh.position, p.a, p.mid, p.b, u);
      // orient along velocity
      bezier(this._v1, p.a, p.mid, p.b, Math.min(1, u + 0.02))
        .sub(p.mesh.position).negate().normalize();
      p.mesh.quaternion.setFromUnitVectors(UP, this._v1.negate());
      if (p.spin) p.mesh.rotation.x += p.spin * dt;
      if (p.flame && Math.random() < 0.9) this.effects.trail(p.mesh.position, this._v1, 1);
      if (u >= 1) {
        this.projectiles.splice(i, 1);
        this._removeMesh(p.mesh, p.flame);
        this._impact(p.def, p.b, p.normal);
      }
    }

    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      h.age += dt;
      h.attractor.pos.copy(h.group.position);
      const grow = 0.75 + (h.age / h.life) * 0.65;
      h.group.scale.setScalar(grow);
      h.ring.rotation.z += dt * 2.4;
      h.group.lookAt(camera.position);

      h.craterT += dt;
      if (h.craterT >= 0.24 && this.planet.mesh.visible) {
        h.craterT = 0;
        const ang = Math.sin(h.age * 1.9 + h.seed) * 0.55 + (Math.random() - 0.5) * 0.3;
        const axis = this._v1.crossVectors(h.normal, UP).normalize();
        if (!isFinite(axis.x) || axis.lengthSq() < 0.01) axis.set(1, 0, 0);
        const dir = this._v2.copy(h.dirLocal).applyAxisAngle(axis, ang).normalize();
        const wp = this.planet.group.localToWorld(this._v3.copy(dir).multiplyScalar(R));
        const n = wp.clone().normalize();
        this.planet.queueDamage(wp, WEAPONS[4].crater.radiusDeg, 0.7, 0.95);
        this.effects.jet(wp, n, 0.7);
        this._damage(WEAPONS[4].power / 20, WEAPONS[4]);
      }
      // infalling streaks
      if (Math.random() < 0.5) {
        randUnit(this._v1).multiplyScalar(R * 1.6).add(h.group.position);
        this.effects.trail(this._v1, this._v2.subVectors(h.group.position, this._v1), 1.2);
      }

      if (h.age >= h.life) {
        this.holes.splice(i, 1);
        this._collapseHole(h, false);
      }
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      tr.mesh.material.opacity = Math.max(0, tr.life / tr.maxLife) * 0.9;
      if (tr.life <= 0) {
        this.scene.remove(tr.mesh);
        this.tracers.splice(i, 1);
      }
    }
  }

  /* ---------------- individual weapons ---------------- */

  _launchMissile(def, aim, camera) {
    const mesh = new THREE.Mesh(this.missileGeo, this.missileMat);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.flameTex, color: 0xffc080, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    flame.scale.setScalar(0.85);
    this.scene.add(mesh, flame);

    const start = camera.position.clone()
      .addScaledVector(this._v1.setFromMatrixColumn(camera.matrixWorld, 0), 3.5)
      .addScaledVector(this._v2.setFromMatrixColumn(camera.matrixWorld, 1), 2.2);
    const mid = start.clone().lerp(aim.point, 0.45)
      .addScaledVector(aim.normal, R * 0.5);

    this.projectiles.push({
      kind: 'missile', def, mesh, flame,
      a: start, mid, b: aim.point.clone(), normal: aim.normal.clone(),
      t: 0, dur: 0.55, spin: 0
    });
    this.shake(0.06);
  }

  _dropRock(def, aim) {
    const mesh = new THREE.Mesh(this.rockGeo, this.rockMat);
    mesh.scale.setScalar(0.95 + Math.random() * 0.5);
    this.scene.add(mesh);
    const tangent = this._v1.crossVectors(aim.normal, UP).normalize();
    if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
    const start = aim.point.clone()
      .addScaledVector(tangent, R * 1.4)
      .addScaledVector(aim.normal, R * 1.7);
    const mid = start.clone().lerp(aim.point, 0.4).addScaledVector(aim.normal, R * 0.9);
    this.audio.riser(1.15);
    this.projectiles.push({
      kind: 'asteroid', def, mesh, flame: null,
      a: start, mid, b: aim.point.clone(), normal: aim.normal.clone(),
      t: 0, dur: 1.45, spin: 6
    });
    this.shake(0.08);
  }

  _dropNuke(def, aim) {
    const mesh = new THREE.Mesh(this.warheadGeo, this.warheadMat);
    this.scene.add(mesh);
    const blink = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.flameTex, color: 0xff3020, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    blink.scale.setScalar(0.5);
    this.scene.add(blink);
    const tangent = this._v1.crossVectors(aim.normal, UP).normalize();
    if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
    const start = aim.point.clone()
      .addScaledVector(tangent, R * 0.7)
      .addScaledVector(aim.normal, R * 2.4);
    const mid = start.clone().lerp(aim.point, 0.5).addScaledVector(aim.normal, R * 0.25);
    this.audio.riser(2.6);
    this.projectiles.push({
      kind: 'nuke', def, mesh, flame: blink,
      a: start, mid, b: aim.point.clone(), normal: aim.normal.clone(),
      t: 0, dur: 2.8, spin: 0
    });
    this.shake(0.05);
  }

  _fireRailgun(def, aim) {
    const dir = this._v1.subVectors(aim.point, this.satPos).normalize();
    const start = aim.point.clone().addScaledVector(dir, -42);
    const len = 44;
    const mesh = new THREE.Mesh(this.unitCyl, this.tracerMat.clone());
    mesh.position.copy(start);
    mesh.quaternion.setFromUnitVectors(UP, dir);
    mesh.scale.set(0.05, len, 0.05);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.12, maxLife: 0.12 });

    this.effects.flash(aim.point, 3, 14, 0.3, 0xbfe4ff);
    this.audio.railgun();
    this._impact(def, aim.point, aim.normal);
  }

  _openHole(def, aim) {
    const group = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.9, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff9a4d, side: THREE.DoubleSide, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    group.add(ball, ring);
    group.position.copy(aim.point).addScaledVector(aim.normal, R * 0.34);
    this.scene.add(group);

    const hole = {
      def, group, ring,
      age: 0, life: 4.5, craterT: 0.2, seed: Math.random() * 10,
      normal: aim.normal.clone(),
      dirLocal: this.planet.localDir(aim.point, new THREE.Vector3()),
      attractor: this.effects.addAttractor(group.position, 26)
    };
    this.holes.push(hole);
    this.audio.startBlackHole(hole.life);
    this.effects.flash(group.position, 1, 9, 0.5, 0x88aaff);
  }

  _collapseHole(h, silent) {
    this.effects.removeAttractor(h.attractor);
    this.scene.remove(h.group);
    h.group.children.forEach((c) => {
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    });
    if (silent) return;
    this.audio.collapseBlackHole();
    this.effects.flash(h.group.position, 9, 0.5, 0.3, 0xaaccff);
    this.effects.burst(h.group.position, h.group.position.clone().normalize(), 1.6);
    this.shake(0.4);
  }

  _updateLaser(dt, aim) {
    if (this.overheated) {
      this.heat -= dt * 0.30;
      if (this.heat <= 0.32) {
        this.heat = Math.min(this.heat, 0.3);
        this.overheated = false;
        this.ui.hot(false);
        this.ui.toast('LASER COOLED', true);
      }
      this.beamCore.visible = false;
      this.beamGlow.visible = false;
      return;
    }

    this.heat += dt / 2.5;
    if (this.heat >= 1) {
      this.heat = 1;
      this.overheated = true;
      this.ui.hot(true);
      this.ui.toast('LASER OVERHEAT');
      this.audio.stopLaser();
      this.beamCore.visible = false;
      this.beamGlow.visible = false;
      return;
    }

    const def = WEAPONS[1];
    this.beamCore.visible = true;
    this.beamGlow.visible = true;
    const end = aim.point;
    this._beamTo(this.beamCore, this.satPos, end, 0.05);
    this._beamTo(this.beamGlow, this.satPos, end, 0.17);

    this.audio.startLaser();
    this.shake(0.02);

    this.laserTickT += dt;
    if (this.laserTickT >= 0.07) {
      this.laserTickT = 0;
      this.planet.queueDamage(end, def.crater.radiusDeg, def.crater.char, def.crater.lava);
      this.effects.jet(end, aim.normal, 0.8);
      this._damage(0.55, def);
    }
  }

  _beamTo(mesh, from, to, radius) {
    const dir = this._v3.subVectors(to, from);
    const len = dir.length();
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.scale.set(radius, len, radius);
  }

  /* ---------------- shared impact pipeline ---------------- */

  _damage(power, def) { this.onDamage(power, def); }

  _impact(def, point, normal) {
    if (this.planet.mesh.visible) {
      const c = def.crater;
      this.planet.queueDamage(point, c.radiusDeg * (def.fxScale > 2 ? 1.15 : 1), c.char, c.lava);
      if (def.id === 'nuke') {
        // continent-scale scar: three staggered stamps around ground zero
        const axis = this._v1.crossVectors(normal, UP).normalize();
        for (let k = 0; k < 3; k++) {
          const off = this._v2.copy(point).addScaledVector(axis, (k - 1) * 1.9).normalize().multiplyScalar(R);
          this.planet.queueDamage(off, c.radiusDeg * 0.62, 0.8, 0.5);
        }
      }
    }
    this.effects.burst(point, normal, def.fxScale);
    this.effects.shockwave(point, normal, def.fxScale);
    this.effects.flash(point, 1.2 * def.fxScale, 7 + 5 * def.fxScale, 0.38);
    this.audio.explosion(Math.min(def.fxScale, 3));
    this.shake(def.shake);

    if (def.id === 'nuke') {
      this.flashScreen(1.15);
      this.effects.shockwave(point, normal, def.fxScale * 1.7);
      setTimeout(() => {
        if (this.planet.mesh.visible) this.effects.shockwave(point, normal, def.fxScale * 2.6);
      }, 160);
      this.audio.nukeExtra();
    }
    this._damage(def.power, def);
  }
}
