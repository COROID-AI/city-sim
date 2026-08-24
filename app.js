/** Three.js Café Timelapse Scene (ESM, single-file) */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- Scene / rendering ----------
const scene = new THREE.Scene();

// Year labels for UI
const yearLabels = {
  1945: 'Post-War Era',
  1965: 'Swinging Sixties',
  1985: 'Retro Eighties',
  2005: 'Digital Age',
  2025: 'Modern Times'
};

// Current year state
let currentYear = 1945;
let currentLayer = null;

// Year layers
const yearLayers = {
  1945: new THREE.Group(),
  1965: new THREE.Group(),
  1985: new THREE.Group(),
  2005: new THREE.Group(),
  2025: new THREE.Group()
};

// Create detailed café geometry for each era
function createCafeGeometry(year) {
  const meshes = [];
  
  // Base café structure (floor, walls simplified as blocks)
  const floorSize = 8;
  const wallHeight = 3;
  
  // Floor
  const floorGeometry = new THREE.BoxGeometry(floorSize, 0.2, floorSize);
  const floorMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x8B4513, 
    roughness: 0.8,
    metalness: 0.1
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.position.y = -wallHeight/2 + 0.1; // Just above center
  meshes.push(floor);
  
  // Back wall
  const backWallGeometry = new THREE.BoxGeometry(floorSize, wallHeight, 0.2);
  const backWallMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xD2B48C, 
    roughness: 0.9,
    metalness: 0.05
  });
  const backWall = new THREE.Mesh(backWallGeometry, backWallMaterial);
  backWall.position.set(0, 0, -floorSize/2 + 0.1);
  meshes.push(backWall);
  
  // Side walls
  const sideWallGeometry = new THREE.BoxGeometry(0.2, wallHeight, floorSize);
  const sideWallMaterial = backWallMaterial.clone();
  
  const leftWall = new THREE.Mesh(sideWallGeometry, sideWallMaterial);
  leftWall.position.set(-floorSize/2 + 0.1, 0, 0);
  meshes.push(leftWall);
  
  const rightWall = new THREE.Mesh(sideWallGeometry, sideWallMaterial);
  rightWall.position.set(floorSize/2 - 0.1, 0, 0);
  meshes.push(rightWall);
  
  // Era-specific furniture and decor
  switch (year) {
    case 1945: {
      // Post-War Era: Wooden, traditional
      
      // Wooden counter/bar
      const counterGeometry = new THREE.BoxGeometry(3, 1, 1.5);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x8B4513, 
        roughness: 0.7,
        metalness: 0.2
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-1.5, -wallHeight/2 + 0.5, -1);
      meshes.push(counter);
      
      // Booth seating
      const boothGeometry = new THREE.BoxGeometry(2, 0.8, 1.5);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xF5DEB3, 
        roughness: 0.6,
        metalness: 0.1
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(1.5, -wallHeight/2 + 0.4, 1);
      meshes.push(booth);
      
      // Traditional coffee machine
      const machineGeometry = new THREE.BoxGeometry(0.8, 0.6, 0.5);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2F4F4F, 
        roughness: 0.3,
        metalness: 0.8
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-1.2, -wallHeight/2 + 0.3, -0.8);
      meshes.push(machine);
      
      // Menu board/sign
      const menuGeometry = new THREE.BoxGeometry(1.5, 0.8, 0.1);
      const menuMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        roughness: 0.4,
        metalness: 0.1
      });
      const menu = new THREE.Mesh(menuGeometry, menuMaterial);
      menu.position.set(0, -wallHeight/2 + 1.5, -floorSize/2 + 0.05);
      meshes.push(menu);
      
      // Standing lamp/post
      const postGeometry = new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8);
      const postMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x8B4513, 
        roughness: 0.5,
        metalness: 0.3
      });
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(2, -wallHeight/2 + 0.75, -1.5);
      meshes.push(post);
      
      break;
    }
    case 1965: {
      // Swinging Sixties: Retro, colorful
      
      // Formica counter
      const counterGeometry = new THREE.BoxGeometry(3.5, 1.1, 1.8);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFD700, 
        roughness: 0.2,
        metalness: 0.9
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-1.5, -wallHeight/2 + 0.55, -1.2);
      meshes.push(counter);
      
      // Vinyl booth
      const boothGeometry = new THREE.BoxGeometry(2.2, 0.9, 1.8);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF4500, 
        roughness: 0.3,
        metalness: 0.2
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(1.8, -wallHeight/2 + 0.45, 1.5);
      meshes.push(booth);
      
      // Retro coffee machine
      const machineGeometry = new THREE.BoxGeometry(1, 0.8, 0.7);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00FFFF, 
        roughness: 0.2,
        metalness: 0.9
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-1.5, -wallHeight/2 + 0.4, -1);
      meshes.push(machine);
      
      // Poster/sign
      const posterGeometry = new THREE.BoxGeometry(2, 1.2, 0.1);
      const posterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF00FF, 
        roughness: 0.3,
        metalness: 0.2
      });
      const poster = new THREE.Mesh(posterGeometry, posterMaterial);
      poster.position.set(0, -wallHeight/2 + 1.6, -floorSize/2 + 0.05);
      meshes.push(poster);
      
      // Chrome post/stand
      const postGeometry = new THREE.CylinderGeometry(0.08, 0.08, 2, 8);
      const postMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xC0C0C0, 
        roughness: 0.1,
        metalness: 0.9
      });
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(2.2, -wallHeight/2 + 1, -1.8);
      meshes.push(post);
      
      break;
    }
    case 1985: {
      // Retro Eighties: Neon, geometric
      
      // Glossy counter
      const counterGeometry = new THREE.BoxGeometry(4, 1.2, 2);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF00FF, 
        roughness: 0.1,
        metalness: 0.9
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-1.8, -wallHeight/2 + 0.6, -1.5);
      meshes.push(counter);
      
      // Geometric booth
      const boothGeometry = new THREE.BoxGeometry(2.5, 1, 2);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00FF00, 
        roughness: 0.2,
        metalness: 0.3
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(2, -wallHeight/2 + 0.5, 2);
      meshes.push(booth);
      
      // 80s coffee machine
      const machineGeometry = new THREE.BoxGeometry(1.2, 1, 0.8);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFFF00, 
        roughness: 0.2,
        metalness: 0.8
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-1.6, -wallHeight/2 + 0.5, -1.2);
      meshes.push(machine);
      
      // Neon sign
      const signGeometry = new THREE.BoxGeometry(2.5, 0.8, 0.1);
      const signMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF00FF, 
        roughness: 0.1,
        metalness: 0.9,
        emissive: 0xFF00FF,
        emissiveIntensity: 0.5
      });
      const sign = new THREE.Mesh(signGeometry, signMaterial);
      sign.position.set(0, -wallHeight/2 + 1.8, -floorSize/2 + 0.05);
      meshes.push(sign);
      
      // Geometric post
      const postGeometry = new THREE.ConeGeometry(0.15, 1.5, 8);
      const postMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF00FF, 
        roughness: 0.2,
        metalness: 0.7
      });
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(2.5, -wallHeight/2 + 0.75, -2);
      meshes.push(post);
      
      break;
    }
    case 2005: {
      // Digital Age: Modern, sleek
      
      // Glass/metal counter
      const counterGeometry = new THREE.BoxGeometry(4.5, 1.3, 2.2);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xC0C0C0, 
        roughness: 0.2,
        metalness: 0.8
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-2, -wallHeight/2 + 0.65, -1.8);
      meshes.push(counter);
      
      // Modern booth
      const boothGeometry = new THREE.BoxGeometry(3, 1.1, 2.5);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x008000, 
        roughness: 0.3,
        metalness: 0.2
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(2.2, -wallHeight/2 + 0.55, 2);
      meshes.push(booth);
      
      // Digital coffee machine
      const machineGeometry = new THREE.BoxGeometry(1.5, 1.2, 1);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x606060, 
        roughness: 0.3,
        metalness: 0.7
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-1.8, -wallHeight/2 + 0.6, -1.5);
      meshes.push(machine);
      
      // LCD menu display
      const menuGeometry = new THREE.BoxGeometry(2, 1, 0.05);
      const menuMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00FF00, 
        roughness: 0.1,
        metalness: 0.2,
        emissive: 0x00FF00,
        emissiveIntensity: 0.3
      });
      const menu = new THREE.Mesh(menuGeometry, menuMaterial);
      menu.position.set(0, -wallHeight/2 + 1.7, -floorSize/2 + 0.025);
      meshes.push(menu);
      
      // LED post/stand
      const postGeometry = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8);
      const postMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00FF00, 
        roughness: 0.2,
        metalness: 0.8
      });
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(2.5, -wallHeight/2 + 1.1, -2.2);
      meshes.push(post);
      
      break;
    }
    case 2025: {
      // Modern Times: Smart, sustainable
      
      // Eco-friendly counter (recycled materials look)
      const counterGeometry = new THREE.BoxGeometry(5, 1.4, 2.5);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x8FBC8F, 
        roughness: 0.6,
        metalness: 0.3
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-2.2, -wallHeight/2 + 0.7, -2);
      meshes.push(counter);
      
      // Sustainable booth (bamboo-like)
      const boothGeometry = new THREE.BoxGeometry(3.5, 1.2, 3);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xDEB887, 
        roughness: 0.5,
        metalness: 0.1
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(2.5, -wallHeight/2 + 0.6, 2.5);
      meshes.push(booth);
      
      // Smart coffee machine
      const machineGeometry = new THREE.BoxGeometry(1.8, 1.4, 1.2);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2F4F4F, 
        roughness: 0.4,
        metalness: 0.6
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-2, -wallHeight/2 + 0.7, -1.8);
      meshes.push(machine);
      
      // Touch screen menu
      const menuGeometry = new THREE.BoxGeometry(1.8, 1, 0.02);
      const menuMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        roughness: 0.2,
        metalness: 0.1,
        emissive: 0xFFFFFF,
        emissiveIntensity: 0.5
      });
      const menu = new THREE.Mesh(menuGeometry, menuMaterial);
      menu.position.set(0, -wallHeight/2 + 1.8, -floorSize/2 + 0.01);
      meshes.push(menu);
      
      // Smart post with display
      const postGeometry = new THREE.CylinderGeometry(0.15, 0.15, 2.5, 8);
      const postMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        roughness: 0.3,
        metalness: 0.4
      });
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(2.8, -wallHeight/2 + 1.25, -2.5);
      meshes.push(post);
      
      break;
    }
  }
  
  return meshes;
}

// Add café elements to each year layer
Object.entries(yearLayers).forEach(([year, layer]) => {
  // Position layer appropriately
  layer.position.set(0, 0, 0);
  
  // Add all meshes for this era
  const meshes = createCafeGeometry(parseInt(year));
  meshes.forEach(mesh => layer.add(mesh));
});

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 6);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.querySelector('.scene').appendChild(renderer.domElement);

// Orbit controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 2;
controls.maxDistance = 15;
controls.autoRotate = false;
controls.enableZoom = true;
controls.maxPolarAngle = Math.PI / 2 * 0.9; // Limit looking straight up
controls.minPolarAngle = Math.PI / 6; // Limit looking straight down

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(3, 6, 3);
scene.add(dirLight);

// Add some spot lights for highlights
const spotLight = new THREE.SpotLight(0xffffff, 0.5);
spotLight.position.set(2, 4, 2);
spotLight.target.position.set(0, 0, 0);
scene.add(spotLight);
scene.add(spotLight.target);

// Audio system
let audioContext = null;
let isAudioMuted = false;
let musicGain = null;
let ambienceGain = null;
let coffeeGain = null;
let currentEraOscillators = null;
let ambienceSource = null;

// Initialize audio context
function initAudioSystem() {
  if (!audioContext) {
    const AudioCxtor = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCxtor();
  }
  
  const ctx = audioContext;
  
  // Create gain nodes
  musicGain = ctx.createGain();
  ambienceGain = ctx.createGain();
  coffeeGain = ctx.createGain();
  
  musicGain.gain.value = 0.4;
  ambienceGain.gain.value = 0.3;
  coffeeGain.gain.value = 0.2;
  
  // Connect to destination
  musicGain.connect(ctx.destination);
  ambienceGain.connect(ctx.destination);
  coffeeGain.connect(ctx.destination);
  
  // Create ambience murmur
  createAmbienceMurmur();
  
  // Resume audio context
  ctx.resume().catch(() => { /* Handle error */ });
}

// Create ambient conversation murmur
function createAmbienceMurmur() {
  if (!audioContext) return;
  
  const ctx = audioContext;
  
  // Create noise buffer for murmur
  const frameCount = ctx.sampleRate * 2; // 2 seconds of noise
  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3; // Lower volume for murmur
  }
  
  // Create noise source
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = buffer;
  noiseSource.loop = true;
  
  // Filter for murmur effect (mid-range frequencies)
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800; // Voice frequencies
  filter.Q.value = 1.0;
  
  // Additional filtering for realism
  const highPass = ctx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 200;
  
  const lowPass = ctx.createBiquadFilter();
  lowPass.type = 'lowpass';
  lowPass.frequency.value = 3000;
  
  // Gain for level control
  const ambienceLevel = ctx.createGain();
  ambienceLevel.gain.value = 0.0;
  
  // Connect chain: noise -> highpass -> lowpass -> bandpass -> gain -> output
  noiseSource.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(filter);
  filter.connect(ambienceLevel);
  ambienceLevel.connect(ambienceGain);
  
  // Start with fade in
  ambienceLevel.gain.setTargetAtTime(0.2, ctx.currentTime + 0.1, 0.5);
  noiseSource.start();
  
  // Store reference for cleanup
  ambienceSource = noiseSource;
}

// Create era-specific music
function createEraMusicOscillator(year) {
  if (!audioContext) return;
  
  // Stop previous oscillators
  if (currentEraOscillators) {
    try { currentEraOscillators.osc1.stop(); } catch (_) {}
    try { currentEraOscillators.osc2.stop(); } catch (_) {}
  }
  
  const ctx = audioContext;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  // Era-specific musical themes
  switch (year) {
    case 1945: {
      // Jazz era - walking bass + chords
      osc1.type = 'sine';
      osc1.frequency.value = 110; // A2 - bass note
      osc2.type = 'sine';
      osc2.frequency.value = 220; // A3 - chord
      break;
    }
    case 1965: {
      // Rock/pop era - brighter tones
      osc1.type = 'square';
      osc1.frequency.value = 220; // A3
      osc2.type = 'triangle';
      osc2.frequency.value = 330; // E4
      break;
    }
    case 1985: {
      // Synth era - sawtooth waves
      osc1.type = 'sawtooth';
      osc1.frequency.value = 261.63; // C4
      osc2.type = 'sawtooth';
      osc2.frequency.value = 329.63; // E4
      break;
    }
    case 2005: {
      // Digital era - clean sine waves
      osc1.type = 'sine';
      osc1.frequency.value = 329.63; // E4
      osc2.type = 'sine';
      osc2.frequency.value = 392.00; // G4
      break;
    }
    case 2025: {
      // Modern era - plucky, digital
      osc1.type = 'triangle';
      osc1.frequency.value = 261.63; // C4
      osc2.type = 'sine';
      osc2.frequency.value = 523.25; // C5
      break;
    }
    default:
      osc1.type = 'sine';
      osc1.frequency.value = 220;
      osc2.type = 'sine';
      osc2.frequency.value = 330;
  }
  
  osc1.connect(gainNode);
  osc2.connect(gainNode);
  gainNode.connect(isAudioMuted ? ctx.destination : musicGain);
  
  const target = isAudioMuted ? 0 : 0.4;
  gainNode.gain.setTargetAtTime(target, ctx.currentTime + 0.05, 0.15);
  
  osc1.start(ctx.currentTime + 0.05);
  osc2.start(ctx.currentTime + 0.05);
  
  currentEraOscillators = { osc1, osc2, gainNode };
}

// Create coffee machine SFX
function createCoffeeMachineSFX() {
  if (!audioContext) return;
  
  const ctx = audioContext;
  
  // Hiss (steam noise)
  const hissSource = ctx.createBufferSource();
  const hissFrameCount = ctx.sampleRate * 3; // 3 seconds
  const hissBuffer = ctx.createBuffer(1, hissFrameCount, ctx.sampleRate);
  const hissData = hissBuffer.getChannelData(0);
  for (let i = 0; i < hissFrameCount; i++) {
    hissData[i] = (Math.random() * 2 - 1) * 0.4; // Steam hiss
  }
  hissSource.buffer = hissBuffer;
  hissSource.loop = true;
  
  // Filter for coffee machine hiss (mid-high frequencies)
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'bandpass';
  hissFilter.frequency.value = 3000;
  hissFilter.Q.value = 2.0;
  
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.0;
  
  hissSource.connect(hissFilter);
  hissFilter.connect(hissGain);
  hissGain.connect(coffeeGain);
  
  hissGain.gain.setTargetAtTime(0.25, ctx.currentTime + 0.01, 0.03);
  hissSource.start();
  
  // Clatter (cup/tamper sounds)
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  const clatterFilter = ctx.createBiquadFilter();
  clatterFilter.type = 'highpass';
  clatterFilter.frequency.value = 800;
  
  oscA.type = 'triangle';
  oscA.frequency.value = 200;
  oscB.type = 'sawtooth';
  oscB.frequency.value = 400;
  
  const clatterGain = ctx.createGain();
  clatterGain.gain.value = 0.0;
  
  oscA.connect(clatterFilter);
  oscB.connect(clatterFilter);
  clatterFilter.connect(clatterGain);
  clatterGain.connect(coffeeGain);
  
  clatterGain.gain.setTargetAtTime(0.18, ctx.currentTime + 0.02, 0.01);
  
  oscA.start(ctx.currentTime + 0.02);
  oscB.start(ctx.currentTime + 0.02);
  
  const endAt = ctx.currentTime + 1.6;
  clatterGain.gain.setTargetAtTime(0.0, endAt, 0.05);
  
  // Cleanup
  setTimeout(() => {
    try { hissSource.stop(); } catch (_) {}
    try { oscA.stop(); } catch (_) {}
    try { oscB.stop(); } catch (_) {}
  }, 1700);
}

// Expose audio control functions on window
window.initAudioSystem = initAudioSystem;
window.setEraMusic = createEraMusicOscillator;
window.playCoffeeMachineSFX = createCoffeeMachineSFX;
window.setAudioMute = (muted) => {
  isAudioMuted = muted;
  if (isAudioMuted) {
    if (musicGain) musicGain.gain.value = 0;
    if (ambienceGain) ambienceGain.gain.value = 0;
    if (coffeeGain) coffeeGain.gain.value = 0;
    if (audioContext) audioContext.suspend();
  } else {
    if (musicGain) musicGain.gain.value = 0.4;
    if (ambienceGain) ambienceGain.gain.value = 0.3;
    if (coffeeGain) coffeeGain.gain.value = 0.2;
    if (audioContext) audioContext.resume();
  }
};

// Fade layer with smooth opacity transition
function fadeLayer(layer, visible) {
  const fades = [];
  layer.traverse(child => {
    if (child.isMesh && child.material) {
      fades.push(child.material);
    }
  });
  
  if (visible) {
    // Fade in
    layer.visible = true;
    fades.forEach(m => {
      m.opacity = 0;
      m.transparent = true;
    });
    
    let opacity = 0;
    const fadeIn = () => {
      opacity += 0.02; // Slower, smoother fade
      fades.forEach(m => (m.opacity = Math.min(opacity, 1)));
      if (opacity < 1) {
        requestAnimationFrame(fadeIn);
      }
    };
    requestAnimationFrame(fadeIn);
  } else {
    // Fade out
    fades.forEach(m => {
      m.opacity = 1;
      m.transparent = true;
    });
    
    let opacity = 1;
    const fadeOut = () => {
      opacity -= 0.02;
      fades.forEach(m => (m.opacity = Math.max(opacity, 0)));
      if (opacity > 0) {
        requestAnimationFrame(fadeOut);
      } else {
        layer.visible = false;
      }
    };
    requestAnimationFrame(fadeOut);
  }
}

// Handle year selection
function handleYearSelect(year) {
  currentYear = year;
  
  // Fade out current layer
  if (currentLayer) {
    fadeLayer(currentLayer, false);
  }
  
  // Update current layer
  currentLayer = yearLayers[year];
  currentLayer.visible = true;
  
  // Fade in new layer
  fadeLayer(currentLayer, true);
  
  // Update year indicator
  const indicator = document.querySelector('.year-indicator');
  if (indicator) {
    indicator.textContent = `${year} - ${yearLabels[year] || ''}`;
  }
  
  // Update button states
  document.querySelectorAll('.year-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.year, 10) === year));
    btn.classList.toggle('selected', parseInt(btn.dataset.year, 10) === year);
  });
  
  // Play era music
  if (typeof window.setEraMusic === 'function') {
    window.setEraMusic(year);
  }
  
  // Play coffee SFX
  if (typeof window.playCoffeeMachineSFX === 'function') {
    window.playCoffeeMachineSFX();
  }
}

// Initialize audio system on gesture
function ensureAudioOnGesture() {
  if (!audioContext) {
    initAudioSystem();
    if (typeof window.setEraMusic === 'function') {
      window.setEraMusic(currentYear);
    }
    if (typeof window.playCoffeeMachineSFX === 'function') {
      window.playCoffeeMachineSFX();
    }
  }
}

// Arm audio on first gesture
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

// Wire UI events
function installYearButtonHandlers() {
  const yearButtons = document.querySelectorAll('.year-btn');
  
  yearButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Click counts as user gesture
      ensureAudioOnGesture();
      
      const year = parseInt(btn.dataset.year, 10);
      handleYearSelect(year);
    });
  });
  
  // Add mute button handler
  const muteBtn = document.querySelector('.mute-button');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      window.setAudioMute(!isAudioMuted);
      // Update button text/appearance
      muteBtn.textContent = isAudioMuted ? 'Unmute' : 'Mute';
    });
  }
}

// Initialize scene on DOM ready
function boot() {
  // Add layers to scene
  Object.values(yearLayers).forEach(layer => {
    if (!scene.children.includes(layer)) {
      scene.add(layer);
    }
  });
  
  // Initialize all layers as hidden
  Object.values(yearLayers).forEach(layer => {
    layer.visible = false;
  });
  
  // Install event handlers
  installYearButtonHandlers();
  armGestureOnce();
  
  // Initialize audio
  try {
    initAudioSystem();
  } catch (_) {
    // Audio may be gesture-restricted
  }
  
  // Set initial year
  handleYearSelect(currentYear);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Handle resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Render loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();