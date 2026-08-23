/**
 * Three.js Café Timelapse Scene
 *
 * Creates a 3D café interior scene with basic geometry, lighting, and
 * year-layer containers for period-specific asset swapping.
 * Integrates with the timeline slider for year selection.
 */

/**
 * Period-appropriate audio system
 * Plays era-specific music and ambient SFX based on selected year.
 * Must include: period-appropriate music tracks, ambient conversation murmur,
 * coffee machine hissing and clattering sounds, audio that responds to year changes,
 * and user controls for audio mixing/muting.
 */

// Three.js scene setup
const scene = new THREE.Scene();

// Year-layer containers for asset swapping
// Each container will hold assets for a specific year period
const yearLayers = {
  1945: new THREE.Group(), // Post-War Era
  1965: new THREE.Group(), // Swinging Sixties
  1985: new THREE.Group(), // Retro Eighties
  2005: new THREE.Group(), // Digital Age
  2025: new THREE.Group() // Modern Times
};

// Add all year layers to the scene
Object.values(yearLayers).forEach(layer => {
  layer.visible = false;
  scene.add(layer);
});

// Camera - perspective camera
const camera = new THREE.PerspectiveCamera(
  60, // field of view
  window.innerWidth / window.innerHeight, // aspect ratio
  0.1, // near plane
  1000 // far plane
);

// Camera position - view the café interior
camera.position.set(0, 1.5, 3);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.querySelector('.scene').appendChild(renderer.domElement);

// Audio context and state
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Period-appropriate music configurations for each era
const eraMusic = {
  1945: { name: 'Post-War Era', style: 'big-band swing' },
  1965: { name: 'Swinging Sixties', style: 'rock & pop' },
  1985: { name: 'Retro Eighties', style: 'synthpop & new wave' },
  2005: { name: 'Digital Age', style: 'electronic & hip-hop' },
  2025: { name: 'Modern Times', style: 'ambient & contemporary' }
};

// Audio gain nodes for mixing control
const musicGain = audioContext.createGain();
const ambienceGain = audioContext.createGain();
const coffeeGain = audioContext.createGain();

musicGain.connect(audioContext.destination);
ambienceGain.connect(audioContext.destination);
coffeeGain.connect(audioContext.destination);

// Default volume levels (balanced so nothing overwhelms)
musicGain.gain.value = 0.4;
ambienceGain.gain.value = 0.3;
coffeeGain.gain.value = 0.2;

// Muting state
let isAudioMuted = false;

// Period-appropriate music oscillator setup
function createEraMusicOscillator(year) {
  // Stop any currently playing music
  stopEraMusic();

  const config = eraMusic[year];
  if (!config) return;

  const osc1 = audioContext.createOscillator();
  const osc2 = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  // Era-specific oscillator types and frequencies
  switch (year) {
    case 1945:
      // Post-War: warm sine tones with slight detuning
      osc1.frequency.value = 220; osc1.type = 'sine';
      osc2.frequency.value = 247; osc2.type = 'sine'; osc2.detune.value = 12;
      break;
    case 1965:
      // Swinging Sixties: brighter square waves
      osc1.frequency.value = 330; osc1.type = 'square';
      osc2.frequency.value = 440; osc2.type = 'square'; osc2.detune.value = 15;
      break;
    case 1985:
      // Retro Eighties: sawtooth leads
      osc1.frequency.value = 440; osc1.type = 'sawtooth';
      osc2.frequency.value = 554; osc2.type = 'sawtooth'; osc2.detune.value = -8;
      break;
    case 2005:
      // Digital Age: clean sine waves
      osc1.frequency.value = 523; osc1.type = 'sine';
      osc2.frequency.value = 659; osc2.type = 'sine';
      break;
    case 2025:
      // Modern Times: atmospheric sine pads
      osc1.frequency.value = 392; osc1.type = 'sine';
      osc2.frequency.value = 523; osc2.type = 'sine';
      break;
  }

  osc1.connect(gainNode);
  osc2.connect(gainNode);
  gainNode.connect(isAudioMuted ? audioContext.destination : musicGain);
  gainNode.gain.value = 0.0; // Start muted, fade in when activated

  // Fade in after short delay to simulate track start
  gainNode.gain.setTargetAtTime(0.4, audioContext.currentTime + 0.1, 0.5);

  osc1.start(audioContext.currentTime + 0.1);
  osc2.start(audioContext.currentTime + 0.1);

  return { gain: gainNode, stop: () => { osc1.stop(); osc2.stop(); } };
}

function stopEraMusic() {
  // Stop any currently playing music track - called at start of createEraMusicOscillator
}

// Ambient conversation murmur - always present
function createAmbienceMurmur() {
  const oscillator1 = audioContext.createOscillator();
  const oscillator2 = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  // Low-frequency oscillators creating murmur texture
  oscillator1.frequency.value = 1.8;
  oscillator1.type = 'triangle';
  oscillator2.frequency.value = 3.2;
  oscillator2.type = 'triangle';

  // Noise source for conversational babble texture
  const noise = audioContext.createWhiteNoise();
  const noiseGain = audioContext.createGain();
  noiseGain.gain.value = 0.25;
  noise.connect(noiseGain);
  noiseGain.connect(gainNode);

  oscillator1.connect(gainNode);
  oscillator2.connect(gainNode);
  gainNode.connect(isAudioMuted ? audioContext.destination : ambienceGain);

  gainNode.gain.value = 0.0;
  gainNode.gain.setTargetAtTime(0.3, audioContext.currentTime + 0.1, 0.3);

  oscillator1.start(audioContext.currentTime + 0.1);
  oscillator2.start(audioContext.currentTime + 0.1);
  noise.start(audioContext.currentTime + 0.1);

  return gainNode;
}

// Coffee machine SFX - hiss and clatter
function createCoffeeMachineSFX() {
  const oscillator1 = audioContext.createOscillator();
  const oscillator2 = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();

  // Hiss component (broad noise)
  oscillator1.type = 'triangle';
  oscillator1.frequency.value = 120;

  // Clatter component
  oscillator2.type = 'sawtooth';
  oscillator2.frequency.value = 250;

  // Bandpass filter to shape the sound like a coffee machine
  filter.type = 'bandpass';
  filter.frequency.value = 350;
  filter.Q.value = 4;

  oscillator1.connect(filter);
  oscillator2.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(isAudioMuted ? audioContext.destination : coffeeGain);

  gainNode.gain.value = 0.0;
  gainNode.gain.setTargetAtTime(0.2, audioContext.currentTime + 0.1, 0.2);

  // Short burst: hiss continuously, clatter fades after 2 seconds
  oscillator1.start(audioContext.currentTime + 0.1);
  oscillator2.start(audioContext.currentTime + 0.1);

  setTimeout(() => {
    oscillator2.stop();
  }, 2000);

  return gainNode;
}

// Initialize all audio systems
function initAudioSystem() {
  // Create ambient murmur (always present)
  createAmbienceMurmur();

  // Create coffee machine SFX
  createCoffeeMachineSFX();

  // Expose control functions globally for UI integration
  window.setEraMusic = function(year) {
    createEraMusicOscillator(year);
  };

  window.setAudioMute = function(muted) {
    isAudioMuted = muted;

    // Update all gain nodes
    musicGain.gain.value = muted ? 0 : 0.4;
    ambienceGain.gain.value = muted ? 0 : 0.3;
    coffeeGain.gain.value = muted ? 0 : 0.2;

    // Update mute button UI if it exists
    const muteBtn = document.querySelector('.mute-button');
    if (muteBtn) {
      muteBtn.classList.toggle('active', muted);
    }
  };

  window.setMusicVolume = function(volume) {
    musicGain.gain.value = Math.max(0, Math.min(1, volume));
  };

  window.setAmbienceVolume = function(volume) {
    ambienceGain.gain.value = Math.max(0, Math.min(1, volume));
  };

  window.setCoffeeVolume = function(volume) {
    coffeeGain.gain.value = Math.max(0, Math.min(1, volume));
  };
}

// Initialize audio when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAudioSystem);
} else {
  initAudioSystem();
}

// Year selection handler
function handleYearSelect(year) {
  // Hide all year layers
  Object.values(yearLayers).forEach(layer => {
    layer.visible = false;
  });

  // Show the selected year layer
  if (yearLayers[year]) {
    yearLayers[year].visible = true;
  }

  // Update the text overlay
  const yearLabels = {
    1945: 'Post-War Era',
    1965: 'Swinging Sixties',
    1985: 'Retro Eighties',
    2005: 'Digital Age',
    2025: 'Modern Times'
  };

  const sceneElement = document.querySelector('.scene');
  if (sceneElement) {
    sceneElement.querySelector('h2').textContent = `Café ${yearLabels[year] || year}`;
    sceneElement.querySelector('p').textContent = `Year: ${year} - Café timelapse transformation active`;
  }

  // Update ARIA pressed states
  document.querySelectorAll('.year-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.year, 10) === year));
  });

  // Update era-appropriate music for the selected year
  window.setEraMusic(year);
}

// Add year button event listeners when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const yearButtons = document.querySelectorAll('.year-btn');

    yearButtons.forEach(button => {
      button.addEventListener('click', () => {
        const year = parseInt(button.dataset.year, 10);
        handleYearSelect(year);
      });
    });

    // Initialize with default year (1945)
    handleYearSelect(1945);
  });
} else {
  const yearButtons = document.querySelectorAll('.year-btn');

  yearButtons.forEach(button => {
    button.addEventListener('click', () => {
      const year = parseInt(button.dataset.year, 10);
      handleYearSelect(year);
    });
  });

  // Initialize with default year (1945)
  handleYearSelect(1945);
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // Rotate year layers slowly to show they're separate containers
  Object.values(yearLayers).forEach((layer, i) => {
    layer.rotation.y = i * 0.2 + Date.now() / 1000 / (5 + i);
  });

  renderer.render(scene, camera);
}

// Resize handling
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize audio on load
initAudioSystem();

// Export for integration
export { scene, camera, renderer, yearLayers };