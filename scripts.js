/* 
 * Timeline Slider Interactivity 
 * Emits 'yearSelected' event when a year button is clicked 
 * Integrates with Three.js overlay 
 */
/* 
 * Era Post-Processing Configuration: 
 * - 1985 Era: Heavy neon bloom, high contrast, synth-wave sounds 
 * - 1965 Era: Mid-century modern with subtle neon accents, warm amber tint 
 * - 1945 Era: Warm sepia tone + light film grain 
 */

// Asset catalog integration for era-specific building materials

// Era constants for post-processing and audio
const Era = {
  Era1945: '1945',
  Era1965: '1965',
  Era1985: '1985',
  Era2005: '2005',
  Era2025: '2025',
};

// Store the currently selected year
let selectedYear = Era.Era2025;
let selectedEra = Era.Era2025;

// Audio context for synth-wave sounds
let audioContext = null;
let synthSource = null;
let isSynthPlaying = false;

// Initialize: set the currently selected year
function init() {
  setActiveYear(selectedYear);
  // Swap to initial era assets
  swapEraAssets(selectedYear);
}

// Initialize synth-wave era audio sounds
function initEraAudio() {
  if (audioContext) return; // Already initialized

  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // Create synth-wave lead sound
  const synthBuffer = createSynthBuffer();
  synthSource = audioContext.createBufferSource();
  synthSource.buffer = synthBuffer;
  synthSource.loop = true;
  synthSource.playbackRate.value = 1;
  synthSource.connect(audioContext.destination);
  synthSource.start(0);

  isSynthPlaying = true;
}

// Create a synth-wave buffer using OscillatorNode
function createSynthBuffer() {
  const sampleRate = audioContext ? audioContext.sampleRate : 44100;
  const duration = 4; // seconds
  const numChannels = 1;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const now = audioContext.currentTime;

  // Write audio data for synth-wave sound (square/pulse waves + filtered noise)
  const channels = buffer.getChannelData(0);

  // Generate synth-wave arpeggiated pattern
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Add harmonic content suggestive of 1980s synth-wave
    // Fundamental frequency with harmonics
    const freq = 220; // A3 base
    const value = 
      Math.sin(2 * Math.PI * freq * t) * // fundamental
      Math.sin(2 * Math.PI * freq * 2 * t) * // octave harmonic
      Math.sin(2 * Math.PI * freq * 4 * t) * // fifth harmonic
      Math.exp(-t * 0.2); // decay
    channels[i] = value * 0.5;
  }

  return buffer;
}

// Initialize street synth-wave ambience
function initStreetAmbience() {
  if (!audioContext) return;

  // Create filtered noise for ambient texture
  const noiseNode = audioContext.createJavaScriptNode(22050, 2, 2);
  noiseNode.connect(audioContext.destination);

  // Generate ambient noise buffer
  const sampleRate = audioContext.sampleRate;
  const bufferSize = 22050; // 1 second of noise
  const noiseBuffer = audioContext.createBuffer(2, bufferSize, sampleRate);

  const outputChannels = noiseBuffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    outputChannels[i] = Math.random() * 2 - 1; // Random noise
  }

  // Merge: add stereo channel support from feature branch
  noiseBuffer.getChannelData(1).set(outputChannels);

  // Filter the noise to create ambient texture
  const filter = audioContext.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800; // Low-pass filter for muffled ambience

  filter.connect(audioContext.destination);

  const filterNode = audioContext.createFilterNode ? audioContext.createFilterNode() : null;
  if (filterNode) {
    filterNode.connect ? filterNode.connect(filter) : filterNode.connect(filter);
  }

  noiseNode.onaudioprocess = () => {
    // Continue ambient synth texture
  };
}

// Apply era-specific post-processing (color grading, bloom, synth sounds)
function applyEraPostProcessing(era) {
  const renderer = window.renderer;

  if (!renderer) return;

  const composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));

  if (era === Era.Era1985) {
    // 1985 era: heavy neon bloom + high contrast color grading + synth-wave sounds

    // Add heavy bloom pass for neon glow effect
    const bloomPass = new THREE.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5,    // strength (heavy bloom)
      0.4,    // radius
      0.85    // threshold (only bright areas bloom)
    );
    composer.addPass(bloomPass);

    // Add contrast adjustment for high contrast 1980s aesthetic
    const contrastPass = new THREE.ShaderPass(
      THREE.ShaderPasss.MergeShaders(
        THREE.ShaderPasss.VertexShaders['screen'],
        `
          uniform float contrast;
          void main() {
            vec4 color = texture2D( map, vUv );
            color.rgb = pow(color.rgb, vec3(0.9)); // Gamma correction
            color.rgb = (color.rgb - 0.5) * contrast + 0.5;
            gl_FragColor = color;
          }
        `
      )
    );
    contrastPass.uniforms['contrast'].value = 2.0;
    composer.addPass(contrastPass);

    // Apply neon color grading tint
    const colorPass = new THREE.ShaderPass(
      THREE.ShaderPasss.MergeShaders(
        THREE.ShaderPasss.VertexShaders['screen'],
        `
          uniform vec3 neonTint;
          void main() {
            vec4 color = texture2D( map, vUv );
            // Add neon cyan/magenta tint for 1980s aesthetic
            color.rgb += neonTint * 0.3;
            gl_FragColor = color;
          }
        `
      )
    );
    colorPass.uniforms['neonTint'].value = new THREE.Color(0x00ffff); // Neon cyan
    composer.addPass(colorPass);

    // Play synth-wave ambient sounds
    initEraAudio();
    initStreetAmbience();
  } else if (era === Era.Era1965) {
    // 1965 era: mid-century modern with subtle neon accents

    // Add moderate bloom pass for gentle neon glow
    const bloomPass = new THREE.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.5,    // strength (moderate bloom for subtle neon)
      0.5,    // radius
      0.7     // threshold
    );
    composer.addPass(bloomPass);

    // Add warm color grading for mid-century modern feel
    const colorPass = new THREE.ShaderPass(
      THREE.ShaderPasss.MergeShaders(
        THREE.ShaderPasss.VertexShaders['screen'],
        `
          uniform vec3 colorTint;
          void main() {
            vec4 color = texture2D( map, vUv );
            // Add warm amber tint for 1960s mid-century modern aesthetic
            color.rgb += colorTint * 0.15;
            gl_FragColor = color;
          }
        `
      )
    );
    colorPass.uniforms['colorTint'].value = new THREE.Color(0xFFB74D); // Warm amber
    composer.addPass(colorPass);

    // Add subtle contrast enhancement
    const contrastPass = new THREE.ShaderPass(
      THREE.ShaderPasss.MergeShaders(
        THREE.ShaderPasss.VertexShaders['screen'],
        `
          uniform float contrast;
          void main() {
            vec4 color = texture2D( map, vUv );
            color.rgb = pow(color.rgb, vec3(0.95)); // Slight gamma correction
            color.rgb = (color.rgb - 0.5) * contrast + 0.5;
            gl_FragColor = color;
          }
        `
      )
    );
    contrastPass.uniforms['contrast'].value = 1.2;
    composer.addPass(contrastPass);
  } else if (era === Era.Era1945) {
    // 1945 era: warm sepia tone + light film grain
    const filmPass = new THREE.FilmPass(
      0.1,    // luminance
      0.05,   // saturation (reduce for warm sepia)
      0.001,  // contrast
      0.0005  // grain (light vintage film grain)
    );

    // Set sepia color transformation matrix
    filmPass.sepia = 0.8;  // Strong sepia tint
    filmPass.vignette = 0.3;  // Light vignette

    composer.addPass(filmPass);
  } else {
    // Default: no post-processing
    composer.addPass(new THREE.RenderPass(scene, camera));
  }

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

// Swap era assets when year changes
async function swapEraAssets(year) {
  const eraMap = {
    1945: Era.Era1945,
    1965: Era.Era1965,
    1985: Era.Era1985,
    2005: Era.Era2005,
    2025: Era.Era2025,
  };
  const targetEra = eraMap[year] || Era.Era2025;
  const assets = await AssetCatalog.swapAssets(selectedEra, targetEra);
  selectedEra = targetEra;
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
  swapEraAssets(year);
  emitYearSelected(year);

  // Apply era-appropriate post-processing when year changes
  applyEraPostProcessing(year);
}

// Add click listeners to all year buttons
const yearButtons = document.querySelectorAll('.year-btn');
yearButtons.forEach(btn => {
  btn.addEventListener('click', handleYearClick);
});

// Initialize the slider
init();

// Apply 1985 era post-processing on load (matching 1985 aesthetic)
applyEraPostProcessing(Era.Era1985);

// Export for integration with Three.js overlay
window.timelineSlider = {
  getSelectedYear: () => selectedYear,
  setSelectedYear: (year) => {
    selectedYear = year;
    setActiveYear(year);
    swapEraAssets(year);
    emitYearSelected(year);
  }
};
function init1965Audio() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // Create rock and roll beat
  createRockAndRollBeat();

  // Create early TV broadcast subcarrier
  createTVSubcarrier();

  // Mix audio sources
  mixAudioSources();
}

function createRockAndRollBeat() {
  const sampleRate = audioContext.sampleRate;
  const duration = 8;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const channels = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const bass = Math.floor(t * 120) % 2 === 0 ? 0.5 : 0;
    const snare = Math.floor(t * 120) % 2 === 1 ? 0.7 : 0;
    const hiHat = (Math.floor(t * 120 / 30) % 2 === 0) ? 0.3 : 0;
    channels[i] = bass + snare * 0.7 + hiHat;
  }

  window.rockBeat = audioContext.createBufferSource();
  window.rockBeat.buffer = buffer;
  window.rockBeat.loop = true;
  window.rockBeat.connect(audioContext.destination);
  window.rockBeat.start(0);
}

function createTVSubcarrier() {
  const sampleRate = audioContext.sampleRate;
  const duration = 8;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const channels = buffer.getChannelData(0);

  const carrierFreq = 3580000;
  const carrierRad = 2 * Math.PI * carrierFreq / sampleRate;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const value = Math.sin(carrierRad * t) * 0.1 + (Math.random() - 0.5) * 0.05;
    channels[i] = value;
  }

  window.tvSubcarrier = audioContext.createBufferSource();
  window.tvSubcarrier.buffer = buffer;
  window.tvSubcarrier.loop = true;
  window.tvSubcarrier.connect(audioContext.destination);
  window.tvSubcarrier.start(0);
}

function mixAudioSources() {
  if (window.rockBeat) window.rockBeat.volume.setValueAtTime(0.6, audioContext.currentTime);
  if (window.tvSubcarrier) window.tvSubcarrier.volume.setValueAtTime(0.3, audioContext.currentTime);
}

// Update audio handling in year selection
function handleYearClick(event) {
  const btn = event.currentTarget;
  const year = parseInt(btn.dataset.year);

  swapEraAssets(year);
  emitYearSelected(year);
  applyEraPostProcessing(year);
  if (year === Era.Era1965) init1965Audio();
}

// Initialize 1965 audio on load
if (selectedYear === Era.Era1965) {
  init1965Audio();
}
function createRockAndRollBeat() {
  const sampleRate = audioContext.sampleRate;
  const duration = 8;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const channels = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const bass = Math.floor(t * 120) % 2 === 0 ? 0.5 : 0;
    const snare = Math.floor(t * 120) % 2 === 1 ? 0.7 : 0;
    const hiHat = (Math.floor(t * 120 / 30) % 2 === 0) ? 0.3 : 0;
    channels[i] = bass + snare * 0.7 + hiHat;
  }

  window.rockBeat = audioContext.createBufferSource();
  window.rockBeat.buffer = buffer;
  window.rockBeat.loop = true;
  window.rockBeat.connect(audioContext.destination);
  window.rockBeat.start(0);
}

function createTVSubcarrier() {
  const sampleRate = audioContext.sampleRate;
  const duration = 8;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const channels = buffer.getChannelData(0);

  const carrierFreq = 3580000;
  const carrierRad = 2 * Math.PI * carrierFreq / sampleRate;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const value = Math.sin(carrierRad * t) * 0.1 + (Math.random() - 0.5) * 0.05;
    channels[i] = value;
  }

  window.tvSubcarrier = audioContext.createBufferSource();
  window.tvSubcarrier.buffer = buffer;
  window.tvSubcarrier.loop = true;
  window.tvSubcarrier.connect(audioContext.destination);
  window.tvSubcarrier.start(0);
}

function mixAudioSources() {
  if (window.rockBeat) window.rockBeat.volume.setValueAtTime(0.6, audioContext.currentTime);
  if (window.tvSubcarrier) window.tvSubcarrier.volume.setValueAtTime(0.3, audioContext.currentTime);
}
