/** Three.js Café Timelapse Scene (single-file, global THREE build) */

// ---------- Scene / rendering ----------
const scene = new THREE.Scene();

const yearLayers = {
  1945: new THREE.Group(),
  1965: new THREE.Group(),
  1985: new THREE.Group(),
  2005: new THREE.Group(),
  2025: new THREE.Group()
};

function addLayerContent() {
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = {
    1945: new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8, metalness: 0.2, transparent: true }),
    1965: new THREE.MeshStandardMaterial({ color: 0x00FFFF, roughness: 0.6, metalness: 0.3, transparent: true }),
    1985: new THREE.MeshStandardMaterial({ color: 0xFF00FF, roughness: 0.6, metalness: 0.3, transparent: true }),
    2005: new THREE.MeshStandardMaterial({ color: 0x00FF00, roughness: 0.6, metalness: 0.3, transparent: true }),
    2025: new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.5, metalness: 0.4, transparent: true })
  };

  Object.entries(yearLayers).forEach(([year, layer]) => {
    const mesh = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({ color: materials[parseInt(year, 10)].color, roughness: 0.8, metalness: 0.2, transparent: true }));
    mesh.position.set((parseInt(year, 10) - 1945) * 1.5 - 1.5, 0, 0);
    layer.add(mesh);

    // Light decor so the layer isn't “empty” visually.
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 0.6),
      new THREE.MeshStandardMaterial({
        color: materials[parseInt(year, 10)].color,
        roughness: 0.9,
        metalness: 0.0,
        transparent: true,
        opacity: 0
      })
    );
    plane.position.set((parseInt(year, 10) - 1945) * 1.5 - 1.5, -0.9, -1.2);
    layer.add(plane);
  });
}
addLayerContent();

// Basic lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(2, 5, 3);
scene.add(dir);

Object.values(yearLayers).forEach(layer => {
  layer.visible = false;
  scene.add(layer);
});

// Camera
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 1.5, 3);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.querySelector('.scene').appendChild(renderer.domElement);

// Orbit controls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.5;
controls.maxDistance = 10;
controls.autoRotate = false;
controls.enableZoom = true;
controls.maxPolarAngle = Math.PI / 2;
controls.minPolarAngle = Math.PI / 6;

function animate() {
  requestAnimationFrame(animate);

  Object.values(yearLayers).forEach((layer, i) => {
    layer.rotation.y = i * 0.2 + Date.now() / 1000 / (5 + i);
  });

  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Year selection ----------
const yearLabels = {
  1945: 'Post-War Era',
  1965: 'Swinging Sixties',
  1985: 'Retro Eighties',
  2005: 'Digital Age',
  2025: 'Modern Times'
};

let currentYear = 1945;

function fadeLayer(layer, visible) {
  const fades = [];
  layer.children.forEach(child => {
    if (child.material) {
      fades.push(child.material);
    }
  });

  if (visible) {
    // Use requestAnimationFrame for smooth fading instead of setInterval
    fades.forEach(m => {
      m.opacity = 0;
      m.transparent = true;
    });
    layer.visible = true;

    const fadeIn = () => {
      let opacity = 0;
      const step = () => {
        opacity += 0.1;
        fades.forEach(m => (m.opacity = Math.min(opacity, 1)));
        if (opacity < 1) {
          requestAnimationFrame(step);
        } else {
          fades.forEach(m => (m.opacity = 1));
        }
      };
      requestAnimationFrame(step);
    };
    fadeIn();
  } else {
    fades.forEach(m => {
      m.opacity = 0;
    });
    layer.visible = false;
  }
}

function handleYearSelect(year) {
  currentYear = year;

  // Visual: hide all, then show selected.
  Object.entries(yearLayers).forEach(([y, layer]) => {
    const vy = parseInt(y, 10) === year;
    fadeLayer(layer, vy);
  });

  const sceneElement = document.querySelector('.scene');
  if (sceneElement) {
    const h2 = sceneElement.querySelector('h2');
    const p = sceneElement.querySelector('p');
    if (h2) h2.textContent = `Café ${yearLabels[year] || year}`;
    if (p) p.textContent = `Year: ${year} - Café timelapse transformation active`;
  }

  // Year indicator - always update to show current year
  const indicator = document.querySelector('.year-indicator');
  if (indicator) {
    indicator.textContent = `${year} - ${yearLabels[year] || ''}`.trim();
    indicator.style.display = 'block';
  }

  // Accessibility / state
  document.querySelectorAll('.year-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.year, 10) === year));
    btn.classList.toggle('selected', parseInt(btn.dataset.year, 10) === year);
  });

  // Audio (if initialized)
  if (typeof window.setEraMusic === 'function') {
    window.setEraMusic(year);
  }

  // Coffee SFX should fire on year change when audio is active.
  if (typeof window.playCoffeeMachineSFX === 'function') {
    window.playCoffeeMachineSFX();
  }
}

// Ensure coffee SFX is always available as a no-op if audio not initialized
if (!window.playCoffeeMachineSFX) {
  window.playCoffeeMachineSFX = () => {
    // SFX will be enabled after audio initialization via user gesture
  };
}

// ---------- Audio (lazy, user-gesture gated) ----------
let audioContext = null;
let audioInitialized = false;

let musicGain;
let ambienceGain;
let coffeeGain;

let isAudioMuted = false;

let currentEraOscillators = null; // { osc1, osc2, gainNode }
let ambienceNodes = null; // { source, gain }
let coffeeNodes = null; // not persistent

function ensureAudioContext() {
  if (!audioContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioContext = new Ctor();
  }
  return audioContext;
}

async function resumeAudioContextIfNeeded() {
  if (!audioContext) return;
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
    } catch (e) {
      // ignore
    }
  }
}

function createNoiseBuffer(context, seconds = 1) {
  const frameCount = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createWhiteNoiseSource(context, loop = true) {
  const source = context.createBufferSource();
  source.buffer = createNoiseBuffer(context, 1);
  source.loop = loop;
  return source;
}

function initAudioSystem() {
  if (audioInitialized) return;
  audioInitialized = true;

  const context = ensureAudioContext();

  musicGain = context.createGain();
  ambienceGain = context.createGain();
  coffeeGain = context.createGain();

  musicGain.connect(context.destination);
  ambienceGain.connect(context.destination);
  coffeeGain.connect(context.destination);

  musicGain.gain.value = 0.4;
  ambienceGain.gain.value = 0.3;
  coffeeGain.gain.value = 0.2;

  // Ambience: murmur via filtered noise
  const ambienceFilter = context.createBiquadFilter();
  ambienceFilter.type = 'bandpass';
  ambienceFilter.frequency.value = 500;
  ambienceFilter.Q.value = 0.8;

  const ambienceLow = context.createBiquadFilter();
  ambienceLow.type = 'lowpass';
  ambienceLow.frequency.value = 1500;

  const ambienceSource = createWhiteNoiseSource(context, true);
  const ambienceLevel = context.createGain();
  ambienceLevel.gain.value = 0.0;

  ambienceSource.connect(ambienceLow);
  ambienceLow.connect(ambienceFilter);
  ambienceFilter.connect(ambienceLevel);
  ambienceLevel.connect(isAudioMuted ? context.destination : ambienceGain);

  // Fade in
  ambienceLevel.gain.setTargetAtTime(0.35, context.currentTime + 0.05, 0.3);

  ambienceSource.start();

  ambienceNodes = { ambienceSource, ambienceLevel, ambienceFilter, ambienceLow };

  // Expose controls
  window.setAudioMute = (muted) => {
    isAudioMuted = !!muted;
    if (!context) return;

    const m = isAudioMuted ? 0 : 0.4;
    const a = isAudioMuted ? 0 : 0.3;
    const c = isAudioMuted ? 0 : 0.2;

    if (musicGain) musicGain.gain.value = m;
    if (ambienceGain) ambienceGain.gain.value = a;
    if (coffeeGain) coffeeGain.gain.value = c;
  };

  window.setMusicVolume = (v) => {
    if (!musicGain) return;
    musicGain.gain.value = Math.max(0, Math.min(1, v));
  };

  window.setAmbienceVolume = (v) => {
    if (!ambienceGain) return;
    ambienceGain.gain.value = Math.max(0, Math.min(1, v));
  };

  window.setCoffeeVolume = (v) => {
    if (!coffeeGain) return;
    coffeeGain.gain.value = Math.max(0, Math.min(1, v));
  };

  window.setEraMusic = (year) => {
    if (!year) year = currentYear;

    if (currentEraOscillators) {
      try {
        currentEraOscillators.osc1.stop();
      } catch (_) {}
      try {
        currentEraOscillators.osc2.stop();
      } catch (_) {}
      currentEraOscillators = null;
    }

    const osc1 = context.createOscillator();
    const osc2 = context.createOscillator();
    const gainNode = context.createGain();
    gainNode.gain.value = 0.0;

    // Types / frequencies per era (simple synth placeholders)
    switch (year) {
      case 1945:
        osc1.type = 'sine';
        osc1.frequency.value = 220;
        osc2.type = 'sine';
        osc2.frequency.value = 247;
        osc2.detune.value = 12;
        break;
      case 1965:
        osc1.type = 'square';
        osc1.frequency.value = 330;
        osc2.type = 'square';
        osc2.frequency.value = 440;
        osc2.detune.value = 15;
        break;
      case 1985:
        osc1.type = 'sawtooth';
        osc1.frequency.value = 440;
        osc2.type = 'sawtooth';
        osc2.frequency.value = 554;
        osc2.detune.value = -8;
        break;
      case 2005:
        osc1.type = 'sine';
        osc1.frequency.value = 523;
        osc2.type = 'sine';
        osc2.frequency.value = 659;
        break;
      case 2025:
      default:
        osc1.type = 'sine';
        osc1.frequency.value = 392;
        osc2.type = 'sine';
        osc2.frequency.value = 523;
        break;
    }

    osc1.connect(gainNode);
    osc2.connect(gainNode);

    gainNode.connect(isAudioMuted ? context.destination : musicGain);

    const target = isAudioMuted ? 0 : 0.4;
    gainNode.gain.setTargetAtTime(target, context.currentTime + 0.05, 0.15);

    osc1.start(context.currentTime + 0.05);
    osc2.start(context.currentTime + 0.05);

    currentEraOscillators = { osc1, osc2, gainNode };
  };

  window.playCoffeeMachineSFX = () => {
    if (isAudioMuted) return;

    // Hiss + clatter (quick transient)
    const hissSource = createWhiteNoiseSource(context, true);
    const hissFilter = context.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 400;
    hissFilter.Q.value = 2.5;

    const hissGain = context.createGain();
    hissGain.gain.value = 0.0;

    hissSource.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(coffeeGain);

    hissGain.gain.setTargetAtTime(0.25, context.currentTime + 0.01, 0.03);
    hissSource.start();

    // Clatter: two short oscillators with decay
    const oscA = context.createOscillator();
    const oscB = context.createOscillator();
    const clatterFilter = context.createBiquadFilter();
    clatterFilter.type = 'highpass';
    clatterFilter.frequency.value = 250;

    oscA.type = 'triangle';
    oscA.frequency.value = 140;
    oscB.type = 'sawtooth';
    oscB.frequency.value = 280;

    const clatterGain = context.createGain();
    clatterGain.gain.value = 0.0;

    oscA.connect(clatterFilter);
    oscB.connect(clatterFilter);
    clatterFilter.connect(clatterGain);
    clatterGain.connect(coffeeGain);

    clatterGain.gain.setTargetAtTime(0.18, context.currentTime + 0.02, 0.01);

    oscA.start(context.currentTime + 0.02);
    oscB.start(context.currentTime + 0.02);

    const endAt = context.currentTime + 1.6;
    clatterGain.gain.setTargetAtTime(0.0, endAt, 0.05);

    // Stop nodes shortly after
    setTimeout(() => {
      try { hissSource.stop(); } catch (_) {}
      try { oscA.stop(); } catch (_) {}
      try { oscB.stop(); } catch (_) {}
    }, 1700);
  };
}

function ensureAudioOnGesture() {
  if (audioInitialized) {
    // already created; just resume if needed
    resumeAudioContextIfNeeded();
    return;
  }

  initAudioSystem();
  resumeAudioContextIfNeeded();

  // Apply current year music after audio comes up
  if (typeof window.setEraMusic === 'function') {
    window.setEraMusic(currentYear);
  }

  if (typeof window.playCoffeeMachineSFX === 'function') {
    window.playCoffeeMachineSFX();
  }
}

// ---------- Wire UI events ----------
function installYearButtonHandlers() {
  const yearButtons = document.querySelectorAll('.year-btn');

  yearButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Click counts as a user gesture; init/resume audio.
      ensureAudioOnGesture();

      const year = parseInt(btn.dataset.year, 10);
      handleYearSelect(year);
    });
  });
}

// Any early tap/click should prime audio as well (but still gesture-gated).
let gestureArmed = false;
function armGestureOnce() {
  if (gestureArmed) return;
  gestureArmed = true;

  const onGesture = () => {
    ensureAudioOnGesture();
    document.removeEventListener('pointerdown', onGesture);
    document.removeEventListener('touchstart', onGesture);
    document.removeEventListener('mousedown', onGesture);
  };

  document.addEventListener('pointerdown', onGesture, { passive: true });
  document.addEventListener('touchstart', onGesture, { passive: true });
  document.addEventListener('mousedown', onGesture, { passive: true });
}

// Initialize visuals immediately.
function boot() {
  installYearButtonHandlers();
  armGestureOnce();

  // Default year shown without requiring audio.
  handleYearSelect(currentYear);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
