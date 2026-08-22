/* 
 * Timeline Slider Interactivity 
 * Emits 'yearSelected' event when a year button is clicked 
 * Integrates with Three.js overlay 
 */

const yearButtons = document.querySelectorAll('.year-btn');

// Store the currently selected year
let selectedYear = 2025;

// Audio context for 1940s era sounds
let audioContext = null;
let jazzSource = null;
let isJazzPlaying = false;

// Initialize: set 2025 as the initially active year
function init() {
  setActiveYear(selectedYear);
}

// Initialize 1940s era audio sounds
function initEraAudio() {
  if (audioContext) return; // Already initialized

  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // Create jazz piano loop (1940s style)
  const jazzBuffer = createJazzBuffer();
  jazzSource = audioContext.createBufferSource();
  jazzSource.buffer = jazzBuffer;
  jazzSource.loop = true;
  jazzSource.playbackRate.value = 1;
  jazzSource.connect(audioContext.destination);
  jazzSource.start(0);

  isJazzPlaying = true;
}

// Create a simple jazz buffer using OscillatorNode
function createJazzBuffer() {
  const sampleRate = audioContext ? audioContext.sampleRate : 44100;
  const duration = 2; // seconds
  const numChannels = 1;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const now = audioContext.currentTime;

  // Write audio data for jazz-like sound (piano chords + brush drums)
  const channels = buffer.getChannelData(0);

  // Generate a chord sequence with decay
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Add harmonic content suggestive of 1940s jazz
    const value = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t * 0.5);
    channels[i] = value * 0.3;
  }

  return buffer;
}

// Initialize street sounds old radio ambience
function initStreetAmbience() {
  if (!audioContext) return;

  // Create old radio static/noise
  const radioNode = audioContext.createJavaScriptNode(22050, 2, 2);
  radioNode.connect(audioContext.destination);
  radioNode.start();
}

// Apply era-specific post-processing (color grading, film grain)
function applyEraPostProcessing(era) {
  // Access the existing renderer from scene.ts
  const renderer = window.renderer;

  if (!renderer) return;

  // Create FilmPass for sepia tone and film grain
  // 1945 era: warm sepia tone + light film grain
  const filmPass = new THREE.FilmPass(
    0.1,    // luminance
    0.05,   // saturation (reduce for warm sepia)
    0.001,  // contrast
    0.0005  // grain (light vintage film grain)
  );

  // Set sepia color transformation matrix
  // 1940s aesthetic: warm brown sepia tones
  filmPass.sepia = 0.8;  // Strong sepia tint
  filmPass.vignette = 0.3;  // Light vignette

  // Replace renderer with composer for post-processing
  const composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  composer.addPass(filmPass);

  // Animation loop using composer
  function animate() {
    requestAnimationFrame(animate);
    composer.render();
  }
  animate();
}

// Emit yearSelected custom event
function emitYearSelected(year) {
  const event = new CustomEvent('yearSelected', {
    detail: { year },
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(event);
}

// Click handler for year buttons
function handleYearClick(event) {
  const btn = event.currentTarget;
  const year = parseInt(btn.dataset.year);

  // Don't do anything if already selected
  if (year === selectedYear) {
    return;
  }

  selectedYear = year;
  setActiveYear(year);
  emitYearSelected(year);

  // Apply era-appropriate post-processing when year changes
  applyEraPostProcessing(year);
}

// Add click listeners to all year buttons
yearButtons.forEach(btn => {
  btn.addEventListener('click', handleYearClick);
});

// Initialize the slider
init();

// Apply 1945 era post-processing on load
applyEraPostProcessing(Era.Era1945);

// Export for integration with Three.js overlay
window.timelineSlider = {
  getSelectedYear: () => selectedYear,
  setSelectedYear: (year) => {
    selectedYear = year;
    setActiveYear(year);
    emitYearSelected(year);
  }
};