/* 
 * Timeline Slider Interactivity 
 * Emits 'yearSelected' event when a year button is clicked 
 * Integrates with Three.js overlay 
 */

/* 
 * 1985 Era Post-Processing Configuration: 
 * - Heavy neon bloom 
 * - High contrast color grading 
 * - Synth-wave ambient sounds 
 * - 1980s aesthetic color grading 
 */

const yearButtons = document.querySelectorAll('.year-btn');

// Store the currently selected year
let selectedYear = 2025;

// Audio context for synth-wave sounds
let audioContext = null;
let synthSource = null;
let isSynthPlaying = false;

// Initialize: set the currently selected year
function init() {
  setActiveYear(selectedYear);
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
  
  // Filter the noise to create ambient texture
  const filter = audioContext.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800; // Low-pass filter for muffled ambience
  noiseBuffer.getChannelData(1).set(outputChannels);
  
  const filterNode = audioContext.createFilterNode ? audioContext.createFilterNode() : null;
  if (filterNode) {
    filterNode.connect ? filterNode.connect(filter) : filterNode.connect(filter);
  }
  filter.connect(audioContext.destination);
  
  noiseNode.onaudioprocess = () => {
    // Continue ambient synth texture
  };
}

// Apply era-specific post-processing (color grading, bloom, synth sounds)
function applyEraPostProcessing(era) {
  // Access the existing renderer from scene.ts
  const renderer = window.renderer;

  if (!renderer) return;

  // Create post-processing composer
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

// Apply 1985 era post-processing on load (matching 1985 aesthetic)
applyEraPostProcessing(Era.Era1985);

// Export for integration with Three.js overlay
window.timelineSlider = {
  getSelectedYear: () => selectedYear,
  setSelectedYear: (year) => {
    selectedYear = year;
    setActiveYear(year);
    emitYearSelected(year);
  }
};