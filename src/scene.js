// Three.js Scene Foundation for Café Time Period Timelapse
// This module sets up the shared scene graph, renderer, camera, lighting,
// and animation loop that all era-specific tasks will build upon.
// 2025 ERA TRANSFORMATION: Modern minimalist furniture, automated coffee stations,
// smartphone music streaming, digital menu boards, tech/sustainability ads,
// contemporary patrons, smart lighting with app control

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Scene globals
let renderer, scene, camera, ambientLight, directionalLight;
let orbitControls;
let yearButtons = [];
let currentYear = 2025;

// Smart lighting controls (2025 era)
let smartLightingMode = 'warm'; // 'warm' or 'cool'
let lightingIntensity = 0.6;

// Audio system globals
let audioListener, sound;
let musicSource, ambienceSource, coffeeSoundSource;
let currentEraMusic = null;
let isCoffeeBrewing = false;
let closeUpMode = false;

// Era definitions with audio configuration
const ERAS = {
  1945: {
    name: '1945 - Wireless Radio Era',
    musicFile: 'audio/1945_radio.mp3',
    musicType: 'radio',
    equipment: 'wireless radio'
  },
  1965: {
    name: '1965 - Jukebox Era',
    musicFile: 'audio/1965_jukebox.mp3',
    musicType: 'jukebox',
    equipment: 'jukebox'
  },
  1985: {
    name: '1985 - Boombox Era',
    musicFile: 'audio/1985_boombox.mp3',
    musicType: 'boombox',
    equipment: 'boombox'
  },
  2005: {
    name: '2005 - iPod Dock Era',
    musicFile: 'audio/2005_ipod.mp3',
    musicType: 'ipod',
    equipment: 'iPod dock'
  },
  2025: {
    name: '2025 - Smartphone Era',
    musicFile: 'audio/2025_smartphone.mp3',
    musicType: 'smartphone',
    equipment: 'smartphone'
  }
};

// Audio volume settings (acceptance criteria: music ~30%, ambience/coffee ~70%)
const AUDIO_VOLUMES = {
  music: 0.3,
  ambience: 0.7,
  coffee: 0.7
};

// Interaction distance thresholds for close-up triggers
const INTERACTION_THRESHOLDS = {
  patron: 2.0,
  coffeeMachine: 1.5,
  tableware: 1.0
};

// Initialize the Three.js scene
function initScene() {
  // Create scene
  scene = new THREE.Scene();

  // Create WebGL renderer that fills the viewport
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  // Create perspective camera positioned for interior navigation
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 1.6, 5); // Eye level in café
  camera.lookAt(0, 0, 0);

  // --- Orbit Camera Controls ---
  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.05;
  orbitControls.enablePan = true;
  orbitControls.minDistance = 2;
  orbitControls.maxDistance = 20;
  orbitControls.maxPolarAngle = Math.PI / 2 - 0.1; // Prevent going under floor

  // --- Audio System ---
  audioListener = new THREE.AudioListener();
  camera.add(audioListener);
  scene.add(camera);

  // Initialize audio sources
  initAudio();

  // --- Smart/Dimmable Lighting (2025 era) ---
  // Smart ambient lighting with warm/cool temperature options
  ambientLight = new THREE.AmbientLight(0xffffff, lightingIntensity);
  scene.add(ambientLight);

  // Cool ambient for temperature control
  const coolAmbient = new THREE.AmbientLight(0x87CEEB, lightingIntensity * 0.5);
  scene.add(coolAmbient);

  // Smart directional lighting - configurable via app
  directionalLight = new THREE.DirectionalLight(0xfff5e1, 0.7);
  directionalLight.position.set(5, 10, 7.5);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // Secondary directional for dynamic lighting effects
  const secondaryDirectional = new THREE.DirectionalLight(0xe0f7ff, 0.3);
  secondaryDirectional.position.set(-5, 10, -7.5);
  scene.add(secondaryDirectional);

  // Smart LED strip lighting along ceiling (2025 era)
  const ledStripGeometry = new THREE.PlaneGeometry(10, 0.2);
  const ledStripMaterial = new THREE.MeshStandardMaterial({
    color: 0x4A90E2,
    emissive: 0x4A90E2,
    emissiveIntensity: 0.5,
    roughness: 0.1,
    metalness: 0.3
  });
  const ledStrip = new THREE.Mesh(ledStripGeometry, ledStripMaterial);
  ledStrip.position.set(0, 6.1, 0);
  ledStrip.rotation.x = -Math.PI / 2;
  scene.add(ledStrip);

  // Modern accent lighting - subtle geometric shapes
  const accentGeometry = new THREE.SphereGeometry(0.2, 16, 16);
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF,
    emissive: 0xFFFFFF,
    emissiveIntensity: 0.3,
    roughness: 0.1,
    metalness: 0.5
  });
  for (let i = 0; i < 4; i++) {
    const accent = new THREE.Mesh(accentGeometry, accentMaterial);
    accent.position.set(
      (Math.random() - 0.5) * 6,
      5.5 + Math.random() * 1,
      (Math.random() - 0.5) * 6
    );
    scene.add(accent);
  }

  // Warm dark background (2025 modern)
  const envColor = 0x1a1a2e;
  renderer.setClearColor(envColor, 1);

  addCaféGeometry();
  addTimelineSlider();

  // Handle resize
  window.addEventListener('resize', onWindowResize);

  // Start animation loop
  animate();
}

// Initialize audio system
function initAudio() {
  // Create audio context if not available
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  
  // Create background music (era-specific)
  musicSource = new THREE.Audio(audioListener);
  musicSource.setVolume(AUDIO_VOLUMES.music);
  musicSource.loop = true;
  scene.add(musicSource);

  // Create ambient conversation murmur (continuous)
  ambienceSource = new THREE.Audio(audioListener);
  ambienceSource.setVolume(AUDIO_VOLUMES.ambience);
  ambienceSource.loop = true;
  scene.add(ambienceSource);

  // Create coffee machine sound effects
  coffeeSoundSource = new THREE.Audio(audioListener);
  coffeeSoundSource.setVolume(AUDIO_VOLUMES.coffee);
  scene.add(coffeeSoundSource);

  // Start ambient conversation
  playAmbience();
}

// Play era-appropriate music based on year
function playEraMusic(year) {
  // Unload previous era audio cleanly (acceptance criteria)
  if (currentEraMusic && currentEraMusic.isPlaying) {
    currentEraMusic.stop();
  }

  const era = ERAS[year];
  if (!era) return;

  // Create new audio for the era
  if (currentEraMusic) {
    currentEraMusic.dispose();
  }
  
  currentEraMusic = new THREE.Audio(audioListener);
  currentEraMusic.setVolume(AUDIO_VOLUMES.music);
  currentEraMusic.loop = true;

  // Load era-specific music file
  const audioLoader = new THREE.AudioLoader();
  audioLoader.load(era.musicFile, (buffer) => {
    currentEraMusic.setBuffer(buffer);
    currentEraMusic.play();
  }, undefined, (error) => {
    console.warn(`Could not load era music for ${year}:`, error);
    // Play fallback tone for development
    playFallbackMusic(year);
  });
}

// Play fallback music when audio files aren't available
function playFallbackMusic(year) {
  // Generate era-appropriate audio using Web Audio API
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  // Set frequency based on era (musical scales)
  const eraNotes = {
    1945: 330,  // A4 - radio era
    1965: 349,  // B4 - jukebox era
    1985: 392,  // G4 - boombox era
    2005: 440,  // A4 - iPod era
    2025: 494   // B4 - smartphone era
  };
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(eraNotes[year] || 440, audioContext.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  gainNode.gain.setValueAtTime(AUDIO_VOLUMES.music * 0.3, audioContext.currentTime);
  
  oscillator.start();
  
  // Store reference for cleanup
  if (!window._eraOscillators) window._eraOscillators = [];
  window._eraOscillators.push({ oscillator, gainNode, audioContext });
}

// Play ambient conversation murmur throughout café
function playAmbience() {
  // Create ambient sound with white noise filtered for conversation-like quality
  const audioLoader = new THREE.AudioLoader();
  audioLoader.load('audio/ambience_conversation.mp3', (buffer) => {
    ambienceSource.setBuffer(buffer);
    ambienceSource.play();
  }, undefined, () => {
    // Generate conversation-like ambient sound
    playFallbackAmbience();
  });
}

// Generate conversation-like ambient sound
function playFallbackAmbience() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 5, audioContext.sampleRate);
  const output = audioContext.createGain();
  
  // Fill with noise
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // Create a filtered noise pattern for conversation-like ambience
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioContext.sampleRate * 2)) * 0.1;
  }
  
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  source.connect(output);
  output.connect(audioContext.destination);
  output.gain.setValueAtTime(AUDIO_VOLUMES.ambience, audioContext.currentTime);
  source.start();
}

// Play coffee machine sound effects
function playCoffeeHiss() {
  const audioLoader = new THREE.AudioLoader();
  audioLoader.load('audio/coffee_hiss.mp3', (buffer) => {
    coffeeSoundSource.setBuffer(buffer);
    coffeeSoundSource.play();
  }, undefined, () => {
    // Generate hiss sound
    playCoffeeHissFallback();
  });
}

function playCoffeeClatter() {
  const audioLoader = new THREE.AudioLoader();
  audioLoader.load('audio/coffee_clatter.mp3', (buffer) => {
    coffeeSoundSource.setBuffer(buffer);
    coffeeSoundSource.play();
  }, undefined, () => {
    // Generate clatter sound
    playCoffeeClatterFallback();
  });
}

function playCoffeePump() {
  const audioLoader = new THREE.AudioLoader();
  audioLoader.load('audio/coffee_pump.mp3', (buffer) => {
    coffeeSoundSource.setBuffer(buffer);
    coffeeSoundSource.play();
  }, undefined, () => {
    // Generate pump sound
    playCoffeePumpFallback();
  });
}

// Fallback sounds for development
function playCoffeeHissFallback() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.5, audioContext.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  
  // High-frequency filtered noise for hiss
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.15;
  }
  
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  source.connect(audioContext.destination);
  source.gain.setValueAtTime(AUDIO_VOLUMES.coffee * 0.5, audioContext.currentTime);
  source.start();
}

function playCoffeeClatterFallback() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  // Random clatter frequencies
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(200 + Math.random() * 300, audioContext.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  gainNode.gain.setValueAtTime(AUDIO_VOLUMES.coffee * 0.4, audioContext.currentTime);
  
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.1);
}

function playCoffeePumpFallback() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(80, audioContext.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  gainNode.gain.setValueAtTime(AUDIO_VOLUMES.coffee * 0.6, audioContext.currentTime);
  
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.3);
}

// Check for close-up interactions (acceptance criteria)
function checkCloseUpInteractions() {
  const cameraPos = camera.position;
  
  // Check distance to patrons
  const patrons = [];
  scene.traverse((object) => {
    if (object.userData && object.userData.isPatron) {
      patrons.push(object);
    }
  });
  
  patrons.forEach(patron => {
    const distance = cameraPos.distanceTo(patron.position);
    if (distance < INTERACTION_THRESHOLDS.patron) {
      if (!closeUpMode) {
        closeUpMode = true;
        patron.material.emissive?.setHex(0x4A90E2);
        console.log('Close-up mode activated for patron');
      }
    } else {
      if (closeUpMode) {
        closeUpMode = false;
        patron.material.emissive?.setHex(0x000000);
      }
    }
  });

  // Check distance to coffee machine
  scene.traverse((object) => {
    if (object.userData && object.userData.isCoffeeMachine) {
      const distance = cameraPos.distanceTo(object.position);
      if (distance < INTERACTION_THRESHOLDS.coffeeMachine) {
        // Trigger coffee sound effect when near machine
        if (!isCoffeeBrewing) {
          playCoffeeHiss();
          playCoffeeClatter();
          playCoffeePump();
          isCoffeeBrewing = true;
          setTimeout(() => { isCoffeeBrewing = false; }, 2000);
        }
      }
    }
  });
}

// Add café interior geometry compatible across 5 eras
function addCaféGeometry() {
  // Floor - modern neutral tone
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x2D2D34,
    roughness: 0.4,
    metalness: 0.1
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Subtle geometric floor pattern
  const tileGeometry = new THREE.BoxGeometry(1, 0.02, 1);
  const tileColors = [0x2D2D34, 0x35353D];
  for (let ix = 0; ix < 10; ix++) {
    for (let iz = 0; iz < 10; iz++) {
      const tile = new THREE.Mesh(
        tileGeometry,
        new THREE.MeshStandardMaterial({
          color: tileColors[(ix + iz) % tileColors.length],
          roughness: 0.4,
          metalness: 0.1
        })
      );
      tile.position.set(ix - 4.5 + 0.5, 0.025, iz - 4.5 + 0.5);
      scene.add(tile);
    }
  }

  // Walls - clean modern white with subtle texture
  const wallGeometry = new THREE.PlaneGeometry(10, 6);

  const backWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0xF8F8F8, roughness: 0.7 })
  );
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  const leftWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0xF0F0F0, roughness: 0.8 })
  );
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  const rightWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0xF0F0F0, roughness: 0.8 })
  );
  rightWall.position.set(5, 3, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // Ceiling - smooth modern finish
  const ceilingGeometry = new THREE.PlaneGeometry(10, 6);
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xE8E8E8, roughness: 0.9 });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(0, 6, 0);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // --- 2025 Era Furniture ---
  // Modern minimalist table - clean lines, neutral tone, mixed materials
  const tableGeometry = new THREE.BoxGeometry(2, 0.5, 1.2);
  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.2, metalness: 0.6 });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.set(0, 0.25, -2);
  table.castShadow = true;
  scene.add(table);

  // Modern chairs - clean design, mixed materials (wood legs, fabric seat)
  const chairGeometry = new THREE.BoxGeometry(0.5, 0.7, 0.5);
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.3, metalness: 0.4 });
  const chairPositions = [
    [-1.8, 0.35, -2],
    [1.8, 0.35, -2],
    [-0.8, 0.35, -3],
    [0.8, 0.35, -3]
  ];
  for (const [x,y,z] of chairPositions) {
    const chair = new THREE.Mesh(chairGeometry, chairMaterial);
    chair.position.set(x,y,z);
    scene.add(chair);
  }

  // 2025 era minimalist seating - sleek modern design
  const sofaGeometry = new THREE.BoxGeometry(2, 0.4, 1.5);
  const sofaMaterial = new THREE.MeshStandardMaterial({ color: 0xE8E8E8, roughness: 0.2, metalness: 0.3 });
  const sofa = new THREE.Mesh(sofaGeometry, sofaMaterial);
  sofa.position.set(0, 0.2, -4);
  sofa.castShadow = true;
  scene.add(sofa);

  const modernChairGeometry = new THREE.BoxGeometry(0.4, 0.5, 0.4);
  const modernChairMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.3, metalness: 0.4 });
  const armchair1 = new THREE.Mesh(modernChairGeometry, modernChairMaterial);
  armchair1.position.set(-2.5, 0.25, -3);
  scene.add(armchair1);
  const armchair2 = new THREE.Mesh(modernChairGeometry, modernChairMaterial);
  armchair2.position.set(2.5, 0.25, -3);
  scene.add(armchair2);

  // --- 2025 Era Coffee Station ---
  // Fully automated coffee machine with contactless payment interface
  const coffeeMachineGeometry = new THREE.BoxGeometry(1, 1.8, 0.5);
  const coffeeMachineMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.1, metalness: 0.9 });
  const coffeeMachine = new THREE.Mesh(coffeeMachineGeometry, coffeeMachineMaterial);
  coffeeMachine.position.set(0, 0.9, -3.5);
  coffeeMachine.castShadow = true;
  coffeeMachine.userData.isCoffeeMachine = true;
  scene.add(coffeeMachine);

  // Contactless payment interface screen
  const paymentScreenGeometry = new THREE.PlaneGeometry(0.6, 0.3);
  const paymentScreenMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.95 });
  const paymentScreen = new THREE.Mesh(paymentScreenGeometry, paymentScreenMaterial);
  paymentScreen.position.set(0, 1.4, -3.7);
  scene.add(paymentScreen);

  // Coffee machine digital display
  const displayGeometry = new THREE.PlaneGeometry(0.7, 0.25);
  const displayMaterial = new THREE.MeshStandardMaterial({ color: 0x00FF00, transparent: true, opacity: 0.9 });
  const display = new THREE.Mesh(displayGeometry, displayMaterial);
  display.position.set(0, 1.7, -3.7);
  scene.add(display);

  // --- 2025 Era Music Streaming ---
  // Smartphone music streaming station
  const phoneStandGeometry = new THREE.BoxGeometry(0.3, 0.2, 0.5);
  const phoneStandMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.2, metalness: 0.7 });
  const phoneStand = new THREE.Mesh(phoneStandGeometry, phoneStandMaterial);
  phoneStand.position.set(-2, 0.1, -2);
  scene.add(phoneStand);

  // Smartphone screen with streaming app UI
  const phoneScreenGeometry = new THREE.PlaneGeometry(0.2, 0.12);
  const phoneScreenMaterial = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, transparent: true, opacity: 0.95 });
  const phoneScreen = new THREE.Mesh(phoneScreenGeometry, phoneScreenMaterial);
  phoneScreen.position.set(-2, 0.18, -1.95);
  scene.add(phoneScreen);

  // Bluetooth/WiFi indicator
  const wifiGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.05);
  const wifiMaterial = new THREE.MeshStandardMaterial({ color: 0x4A90E2, transparent: true, opacity: 0.8 });
  const wifiIndicator = new THREE.Mesh(wifiGeometry, wifiMaterial);
  wifiIndicator.position.set(-1.85, 0.25, -1.9);
  scene.add(wifiIndicator);

  // Wireless charging stations
  const chargingGeometry = new THREE.CircleGeometry(0.3, 32);
  const chargingMaterial = new THREE.MeshStandardMaterial({ color: 0x00FF00, transparent: true, opacity: 0.3, roughness: 0.2 });
  const chargingCoil1 = new THREE.Mesh(chargingGeometry, chargingMaterial);
  chargingCoil1.position.set(2, 0.05, -2);
  chargingCoil1.rotation.x = Math.PI / 2;
  scene.add(chargingCoil1);

  const chargingCoil2 = new THREE.Mesh(chargingGeometry, chargingMaterial);
  chargingCoil2.position.set(-3, 0.05, 2);
  chargingCoil2.rotation.x = Math.PI / 2;
  scene.add(chargingCoil2);

  // --- 2025 Era Menu Board ---
  // Large digital screen with dynamic, updating pricing
  const menuGeometry = new THREE.PlaneGeometry(4, 2.5);
  const menuMaterial = new THREE.MeshStandardMaterial({ color: 0x0A0A14, roughness: 0.1 });
  const menuBoard = new THREE.Mesh(menuGeometry, menuMaterial);
  menuBoard.position.set(0, 2.8, -5);
  menuBoard.rotation.y = Math.PI / 2;
  scene.add(menuBoard);

  // Digital screen display
  const menuScreenGeometry = new THREE.PlaneGeometry(3.6, 2.2);
  const menuScreenMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.95 });
  const menuScreen = new THREE.Mesh(menuScreenGeometry, menuScreenMaterial);
  menuScreen.position.set(0, 2.9, -4.9);
  menuScreen.rotation.y = Math.PI / 2;
  scene.add(menuScreen);

  // Dynamic pricing labels (digital display)
  const pricingColors = [0x4A90E2, 0x50C878, 0xFF6B6B, 0x9B59B6];
  for (let i = 0; i < 10; i++) {
    const pricingGeometry = new THREE.BoxGeometry(0.35, 0.12, 0.12);
    const pricingMaterial = new THREE.MeshStandardMaterial({
      color: pricingColors[i % pricingColors.length],
      roughness: 0.1,
      metalness: 0.5
    });
    const pricingLabel = new THREE.Mesh(pricingGeometry, pricingMaterial);
    pricingLabel.position.set(
      -1.5 + (i % 5) * 0.7,
      2.4 + Math.floor(i / 5) * 0.15,
      -4.51
    );
    scene.add(pricingLabel);
  }

  // --- 2025 Era Wall Posters ---
  // Wall posters reference current technology, sustainability, or coffee culture
  const posterGeometry = new THREE.PlaneGeometry(1.5, 2);
  const posterMaterial = new THREE.MeshStandardMaterial({ color: 0x2D2D34, transparent: true, opacity: 0.95 });

  // Poster 1: Sustainability & Coffee Culture
  const poster1 = new THREE.Mesh(posterGeometry, posterMaterial);
  poster1.position.set(0, 1.5, -4.9);
  poster1.rotation.y = Math.PI / 2;
  scene.add(poster1);

  // Poster 2: Technology & Innovation
  const poster2 = new THREE.Mesh(posterGeometry, posterMaterial.clone());
  poster2.position.set(-4.5, 1.5, 0);
  poster2.rotation.y = Math.PI;
  scene.add(poster2);

  // Poster 3: Modern Coffee Culture
  const poster3 = new THREE.Mesh(posterGeometry, posterMaterial.clone());
  poster3.position.set(4.5, 1.5, 0);
  poster3.rotation.y = Math.PI;
  scene.add(poster3);

  // --- 2025 Era Tableware ---
  // Sleek modern ceramic/glass styling
  const plateGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 32);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.15, metalness: 0.7 });
  const plate1 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate1.position.set(0, 0.1, -1.8);
  scene.add(plate1);

  const plate2 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate2.position.set(0.5, 0.1, -1.6);
  scene.add(plate2);

  const plate3 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate3.position.set(-0.5, 0.1, -1.6);
  scene.add(plate3);

  // Modern ceramic mugs with sleek styling
  const mugGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.9, 32);
  const mugMaterial = new THREE.MeshStandardMaterial({ color: 0xF8F8F8, roughness: 0.1, metalness: 0.8 });
  const mug1 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug1.position.set(-1, 0.2, -1.5);
  scene.add(mug1);
  const mug2 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug2.position.set(1, 0.2, -1.5);
  scene.add(mug2);

  // Modern glassware - sleek glass styling
  const glassGeometry = new THREE.CylinderGeometry(0.08, 0.12, 0.5, 32);
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0xE8E8FF, transparent: true, opacity: 0.7, roughness: 0.1 });
  const glass1 = new THREE.Mesh(glassGeometry, glassMaterial);
  glass1.position.set(-0.5, 0.35, -1.8);
  scene.add(glass1);
  const glass2 = new THREE.Mesh(glassGeometry, glassMaterial);
  glass2.position.set(0.5, 0.35, -1.8);
  scene.add(glass2);

  // --- 2025 Era Decorative Items ---
  // Modern geometric decorative items
  const decorativeColors = [0x4A90E2, 0x2E8B57, 0xF0E0FF, 0xFFD700];
  for (let i = 0; i < 6; i++) {
    const boxGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const boxMaterial = new THREE.MeshStandardMaterial({ 
      color: decorativeColors[i % decorativeColors.length], 
      roughness: 0.2,
      metalness: 0.4
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.set(
      (Math.random() - 0.5) * 3,
      0.3 + Math.random() * 0.4,
      (Math.random() - 0.5) * 3
    );
    box.castShadow = true;
    scene.add(box);
  }

  // --- 2025 Era Patrons ---
  // Contemporary modern fashion patrons (smart casual, tech accessories)
  // Patron 1 - tech-savvy customer
  const patronGeometry = new THREE.BoxGeometry(0.4, 1.6, 0.3);
  const patronMaterial = new THREE.MeshStandardMaterial({ color: 0x4A90E2, roughness: 0.3 });
  const patron1 = new THREE.Mesh(patronGeometry, patronMaterial);
  patron1.position.set(-3, 0.8, 0);
  patron1.userData.isPatron = true;
  scene.add(patron1);

  // Patron 2 - fashion-conscious customer
  const patron2 = new THREE.Mesh(patronGeometry, new THREE.MeshStandardMaterial({ color: 0xFF6B6B, roughness: 0.3 }));
  patron2.position.set(3, 0.8, 0);
  patron2.userData.isPatron = true;
  scene.add(patron2);

  // Patron 3 - business casual
  const patron3 = new THREE.Mesh(patronGeometry, new THREE.MeshStandardMaterial({ color: 0x2E8B57, roughness: 0.3 }));
  patron3.position.set(-1, 0.8, 1);
  patron3.userData.isPatron = true;
  scene.add(patron3);

  // Patron 4 - casual modern
  const patron4 = new THREE.Mesh(patronGeometry, new THREE.MeshStandardMaterial({ color: 0x9B59B6, roughness: 0.3 }));
  patron4.position.set(1, 0.8, 1);
  patron4.userData.isPatron = true;
  scene.add(patron4);

  // Tech accessories (smartwatches, earbuds) on patrons
  const accessoryGeometry = new THREE.BoxGeometry(0.08, 0.03, 0.02);
  const accessoryMaterial = new THREE.MeshStandardMaterial({ color: 0x00FF00, roughness: 0.2 });
  for (let i = 0; i < 4; i++) {
    const accessory = new THREE.Mesh(accessoryGeometry, accessoryMaterial);
    accessory.position.set(
      -3 + (i % 2) * 2,
      0.9,
      0.5 + Math.floor(i / 2) * 2
    );
    scene.add(accessory);
  }
}

// Add timeline slider container with all 5 eras
function addTimelineSlider() {
  // Create slider container
  const sliderContainer = document.createElement('div');
  sliderContainer.style.position = 'absolute';
  sliderContainer.style.top = '20px';
  sliderContainer.style.left = '50%';
  sliderContainer.style.transform = 'translateX(-50%)';
  sliderContainer.style.display = 'flex';
  sliderContainer.style.gap = '10px';
  sliderContainer.style.zIndex = '100';

  // Year options for all 5 eras
  const years = [1945, 1965, 1985, 2005, 2025];

  years.forEach(year => {
    const button = document.createElement('button');
    button.className = 'year-btn';
    button.innerText = year;
    button.dataset.year = year;
    button.style.padding = '8px 16px';
    button.style.border = '2px solid #8B4513';
    button.style.background = 'transparent';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.fontFamily = 'sans-serif';
    button.style.fontSize = '14px';
    button.style.color = '#8B4513';

    // Highlight current year
    if (year === currentYear) {
      button.style.background = '#8B4513';
      button.style.color = 'white';
    }

    button.addEventListener('click', () => {
      selectYear(parseInt(button.dataset.year));
    });

    sliderContainer.appendChild(button);
    yearButtons.push(button);
  });

  document.body.appendChild(sliderContainer);
}

// Select a specific year - era-specific tasks will extend this
function selectYear(year) {
  // Unload previous era audio cleanly (acceptance criteria)
  if (currentEraMusic && currentEraMusic.isPlaying) {
    currentEraMusic.stop();
  }
  
  // Stop any existing oscillators
  if (window._eraOscillators) {
    window._eraOscillators.forEach(o => {
      try { o.oscillator.stop(); } catch(e) {}
    });
    window._eraOscillators = [];
  }

  currentYear = year;
  
  // Update button visuals
  yearButtons.forEach(button => {
    if (parseInt(button.dataset.year) === year) {
      button.style.background = '#8B4513';
      button.style.color = 'white';
    } else {
      button.style.background = 'transparent';
      button.style.color = '#8B4513';
    }
  });

  // Apply era-specific scene transformations
  // Update lighting colors to match the era
  const eraColors = {
    1945: { ambient: 0x8B4513, directional: 0xCD8500 }, // Warm radio era
    1965: { ambient: 0xFFD700, directional: 0xFF4500 },  // Mod jukebox era
    1985: { ambient: 0x00FFFF, directional: 0xFF00FF }, // Boombox era
    2005: { ambient: 0x808080, directional: 0xFFFFFF }, // iPod era
    2025: { ambient: 0x1a1a2e, directional: 0xfff5e1 }  // Smartphone era
  };

  // Update ambient and directional light colors for the selected era
  if (ambientLight) {
    ambientLight.color.setHex(eraColors[year].ambient);
  }
  if (directionalLight) {
    directionalLight.color.setHex(eraColors[year].directional);
  }
  
  // Transform key scene objects based on the selected era
  scene.traverse((object) => {
    // Update coffee machine appearance for the selected era
    if (object.userData && object.userData.isCoffeeMachine) {
      if (year === 1945) {
        object.material.color.setHex(0xCD8500);
        object.material.metalness = 0.3;
      } else if (year === 1965) {
        object.material.color.setHex(0xFF4500);
        object.material.metalness = 0.5;
      } else if (year === 1985) {
        object.material.color.setHex(0x00FFFF);
        object.material.metalness = 0.8;
      } else if (year === 2005) {
        object.material.color.setHex(0x808080);
        object.material.metalness = 0.9;
      } else {
        object.material.color.setHex(0xFFFFFF);
        object.material.metalness = 0.9;
      }
    }
    
    // Update table appearance for the selected era
    if (object.geometry && object.geometry.type === 'BoxGeometry' && 
        Math.abs(object.position.z + 2) < 0.1 && Math.abs(object.position.y - 0.25) < 0.1) {
      if (year === 1945) {
        object.material.color.setHex(0x8B4513);
        object.material.roughness = 0.5;
      } else if (year === 1965) {
        object.material.color.setHex(0xCD853F);
        object.material.roughness = 0.4;
      } else if (year === 1985) {
        object.material.color.setHex(0x00FFFF);
        object.material.roughness = 0.3;
      } else if (year === 2005) {
        object.material.color.setHex(0xA9A9A9);
        object.material.roughness = 0.2;
      }
    }
    
    // Update lighting fixtures (led strip) for the selected era
    if (object.geometry && object.geometry.type === 'PlaneGeometry' && 
        object.geometry.parameters.width > 8 && object.geometry.parameters.height < 1) {
      if (year === 1945) {
        object.material.color.setHex(0x8B4513);
        object.material.emissiveIntensity = 0.2;
      } else if (year === 1965) {
        object.material.color.setHex(0xFF6B6B);
        object.material.emissiveIntensity = 0.3;
      } else if (year === 1985) {
        object.material.color.setHex(0x00FFFF);
        object.material.emissiveIntensity = 0.5;
      } else if (year === 2005) {
        object.material.color.setHex(0xFFFFFF);
        object.material.emissiveIntensity = 0.4;
      }
    }
  });
  
  // Update wall poster colors for the selected era
  scene.traverse((object) => {
    if (object.geometry && object.geometry.type === 'PlaneGeometry' && 
        object.userData && object.userData.isPoster) {
      if (year === 1945) {
        object.material.color.setHex(0x654321);
      } else if (year === 1965) {
        object.material.color.setHex(0xFF69B4);
      } else if (year === 1985) {
        object.material.color.setHex(0x00FF00);
      } else if (year === 2005) {
        object.material.color.setHex(0x87CEEB);
      }
    }
  });
  
  // Update menu board colors for the selected era
  scene.traverse((object) => {
    if (object.geometry && object.geometry.type === 'PlaneGeometry' && 
        Math.abs(object.position.z + 5) < 0.5 && Math.abs(object.position.y - 2.9) < 0.1) {
      if (year === 1945) {
        object.material.color.setHex(0x4A3A2A);
      } else if (year === 1965) {
        object.material.color.setHex(0x2A2A2A);
      } else if (year === 1985) {
        object.material.color.setHex(0x333333);
      } else if (year === 2005) {
        object.material.color.setHex(0x1A1A1A);
      }
    }
  });
  
  // Update pricing labels colors for the selected era
  scene.traverse((object) => {
    if (object.geometry && object.geometry.type === 'BoxGeometry' && 
        Math.abs(object.position.z + 4.51) < 0.1 && object.position.y > 2.3) {
      if (year === 1945) {
        object.material.color.setHex(0x8B0000);
      } else if (year === 1965) {
        object.material.color.setHex(0x0000CD);
      } else if (year === 1985) {
        object.material.color.setHex(0x00CD00);
      } else if (year === 2005) {
        object.material.color.setHex(0xCD00CD);
      }
    }
  });
  
  // Update patrons' appearance for the selected era
  scene.traverse((object) => {
    if (object.userData && object.userData.isPatron) {
      if (year === 1945) {
        object.material.color.setHex(0x8B4513);
      } else if (year === 1965) {
        object.material.color.setHex(0xFFB6C1);
      } else if (year === 1985) {
        object.material.color.setHex(0x00FF00);
      } else if (year === 2005) {
        object.material.color.setHex(0x87CEEB);
      }
    }
  });

  // Play era-appropriate music
  playEraMusic(year);
  
  console.log(`Year selected: ${year}`);
}

// Handle window resize
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start animation loop
function animate() {
  requestAnimationFrame(animate);
  
  // Update orbit controls
  if (orbitControls) {
    orbitControls.update();
  }
  
  // Check for close-up interactions
  checkCloseUpInteractions();
  
  renderer.render(scene, camera);
}

// Initialize scene on load
window.addEventListener('load', initScene);