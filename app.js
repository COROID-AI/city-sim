/** Three.js Café Timelapse Scene (ESM, single-file) */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Three.js Café Timelapse Scene (ESM, single-file) */

const scene = new THREE.Scene();

const yearLabels = {
  1945: 'Post-War Era',
  1965: 'Swinging Sixties',
  1985: 'Retro Eighties',
  2005: 'Digital Age',
  2025: 'Modern Times'
};

let currentYear = 1945;
let currentLayer = null;

const yearLayers = {
  1945: new THREE.Group(),
  1965: new THREE.Group(),
  1985: new THREE.Group(),
  2005: new THREE.Group(),
  2025: new THREE.Group()
};

function createCafeGeometry(year) {
  const meshes = [];
  
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
  floor.position.y = -wallHeight/2 + 0.1;
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
      const counterGeometry = new THREE.BoxGeometry(3, 1, 1.5);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x8B4513, 
        roughness: 0.7,
        metalness: 0.2
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-1.5, -wallHeight/2 + 0.5, -1);
      meshes.push(counter);
      
      const boothGeometry = new THREE.BoxGeometry(2, 0.8, 1.5);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xF5DEB3, 
        roughness: 0.6,
        metalness: 0.1
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(1.5, -wallHeight/2 + 0.4, 1);
      meshes.push(booth);
      
      const machineGeometry = new THREE.BoxGeometry(0.8, 0.6, 0.5);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2F4F4F, 
        roughness: 0.3,
        metalness: 0.8
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-1.2, -wallHeight/2 + 0.3, -0.8);
      meshes.push(machine);
      
      const menuGeometry = new THREE.BoxGeometry(1.5, 0.8, 0.1);
      const menuMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF, 
        roughness: 0.4,
        metalness: 0.1
      });
      const menu = new THREE.Mesh(menuGeometry, menuMaterial);
      menu.position.set(0, -wallHeight/2 + 1.5, -floorSize/2 + 0.05);
      meshes.push(menu);
      break;
    }
    case 1965: {
      // Swinging Sixties: Retro, colorful
      const counterGeometry = new THREE.BoxGeometry(3.5, 1.1, 1.8);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFD700, 
        roughness: 0.2,
        metalness: 0.9
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-1.5, -wallHeight/2 + 0.55, -1.2);
      meshes.push(counter);
      
      const boothGeometry = new THREE.BoxGeometry(2.2, 0.9, 1.8);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF4500, 
        roughness: 0.3,
        metalness: 0.2
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(1.8, -wallHeight/2 + 0.45, 1.5);
      meshes.push(booth);
      
      const machineGeometry = new THREE.BoxGeometry(1, 0.8, 0.7);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00FFFF, 
        roughness: 0.2,
        metalness: 0.9
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-1.5, -wallHeight/2 + 0.4, -1);
      meshes.push(machine);
      
      const posterGeometry = new THREE.BoxGeometry(2, 1.2, 0.1);
      const posterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF00FF, 
        roughness: 0.3,
        metalness: 0.2
      });
      const poster = new THREE.Mesh(posterGeometry, posterMaterial);
      poster.position.set(0, -wallHeight/2 + 1.6, -floorSize/2 + 0.05);
      meshes.push(poster);
      
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
      const counterGeometry = new THREE.BoxGeometry(4, 1.2, 2);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFF00FF, 
        roughness: 0.1,
        metalness: 0.9
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-1.8, -wallHeight/2 + 0.6, -1.5);
      meshes.push(counter);
      
      const boothGeometry = new THREE.BoxGeometry(2.5, 1, 2);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00FF00, 
        roughness: 0.2,
        metalness: 0.3
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(2, -wallHeight/2 + 0.5, 2);
      meshes.push(booth);
      
      const machineGeometry = new THREE.BoxGeometry(1.2, 1, 0.8);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFFF00, 
        roughness: 0.2,
        metalness: 0.8
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-1.6, -wallHeight/2 + 0.5, -1.2);
      meshes.push(machine);
      
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
      const counterGeometry = new THREE.BoxGeometry(4.5, 1.3, 2.2);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xC0C0C0, 
        roughness: 0.2,
        metalness: 0.8
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-2, -wallHeight/2 + 0.65, -1.8);
      meshes.push(counter);
      
      const boothGeometry = new THREE.BoxGeometry(3, 1.1, 2.5);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x008000, 
        roughness: 0.3,
        metalness: 0.2
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(2.2, -wallHeight/2 + 0.55, 2);
      meshes.push(booth);
      
      const machineGeometry = new THREE.BoxGeometry(1.5, 1.2, 1);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x606060, 
        roughness: 0.3,
        metalness: 0.7
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-1.8, -wallHeight/2 + 0.6, -1.5);
      meshes.push(machine);
      
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
      const counterGeometry = new THREE.BoxGeometry(5, 1.4, 2.5);
      const counterMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x8FBC8F, 
        roughness: 0.6,
        metalness: 0.3
      });
      const counter = new THREE.Mesh(counterGeometry, counterMaterial);
      counter.position.set(-2.2, -wallHeight/2 + 0.7, -2);
      meshes.push(counter);
      
      const boothGeometry = new THREE.BoxGeometry(3.5, 1.2, 3);
      const boothMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xDEB887, 
        roughness: 0.5,
        metalness: 0.1
      });
      const booth = new THREE.Mesh(boothGeometry, boothMaterial);
      booth.position.set(2.5, -wallHeight/2 + 0.6, 2.5);
      meshes.push(booth);
      
      const machineGeometry = new THREE.BoxGeometry(1.8, 1.4, 1.2);
      const machineMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2F4F4F, 
        roughness: 0.4,
        metalness: 0.6
      });
      const machine = new THREE.Mesh(machineGeometry, machineMaterial);
      machine.position.set(-2, -wallHeight/2 + 0.7, -1.8);
      meshes.push(machine);
      
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
controls.maxPolarAngle = Math.PI / 2 * 0.9;
controls.minPolarAngle = Math.PI / 6;

// Add lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(3, 6, 3);
scene.add(dirLight);

// Add spotlight
const spotLight = new THREE.SpotLight(0xffffff, 0.5);
spotLight.position.set(2, 4, 2);
spotLight.target.position.set(0, 0, 0);
scene.add(spotLight);
scene.add(spotLight.target);

// Audio system initialization
let audioContext = null;
let isAudioMuted = false;
let musicGain = null;
let ambienceGain = null;
let coffeeGain = null;
let currentEraOscillators = null;
let ambienceSource = null;

function initAudioSystem() {
  if (!audioContext) {
    const AudioCxtor = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCxtor();
  }
  
  const ctx = audioContext;
  
  musicGain = ctx.createGain();
  ambienceGain = ctx.createGain();
  coffeeGain = ctx.createGain();
  
  musicGain.gain.value = 0.4;
  ambienceGain.gain.value = 0.3;
  coffeeGain.gain.value = 0.2;
  
  musicGain.connect(isAudioMuted ? ctx.destination : musicGain);
  ambienceGain.connect(isAudioMuted ? ctx.destination : ambienceGain);
  coffeeGain.connect(isAudioMuted ? ctx.destination : coffeeGain);
  
  const noiseSource = ctx.createBufferSource();
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseBuffer.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const highPass = ctx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 200;
  const lowPass = ctx.createBiquadFilter();
  lowPass.type = 'lowpass';
  lowPass.frequency.value = 3000;
  const ambientFilter = ctx.createBiquadFilter();
  ambientFilter.type = 'bandpass';
  ambientFilter.frequency.value = 800;
  const ambientLevel = ctx.createGain();
  ambientLevel.gain.value = 0.0;
  
  noiseSource.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(ambientFilter);
  ambientFilter.connect(ambienceLevel);
  ambienceLevel.connect(ambienceGain);
  
  noiseSource.start();
  ambienceLevel.gain.setTargetAtTime(0.2, ctx.currentTime + 0.1, 0.5);
  
  ambienceSource = noiseSource;
}

function createEraMusicOscillator(year) {
  if (!audioContext) return;
  
  if (currentEraOscillators) {
    try { currentEraOscillators.osc1.stop(); } catch (_) { }
    try { currentEraOscillators.osc2.stop(); } catch (_) { }
  }
  
  const ctx = audioContext;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  switch (year) {
    case 1945: {
      osc1.type = 'sine';
      osc1.frequency.value = 110;
      osc2.type = 'sine';
      osc2.frequency.value = 220;
      break;
    }
    case 1965: {
      osc1.type = 'square';
      osc1.frequency.value = 220;
      osc2.type = 'triangle';
      osc2.frequency.value = 330;
      break;
    }
    case 1985: {
      osc1.type = 'sawtooth';
      osc1.frequency.value = 261.63;
      osc2.type = 'sawtooth';
      osc2.frequency.value = 329.63;
      break;
    }
    case 2005: {
      osc1.type = 'sine';
      osc1.frequency.value = 329.63;
      osc2.type = 'sine';
      osc2.frequency.value = 392;
      break;
    }
    case 2025: {
      osc1.type = 'triangle';
      osc1.frequency.value = 261.63;
      osc2.type = 'sine';
      osc2.frequency.value = 523.25;
      break;
    }
    default: {
      osc1.type = 'sine';
      osc1.frequency.value = 220;
      osc2.type = 'sine';
      osc2.frequency.value = 330;
    }
  }
  
  osc1.connect(gainNode);
  osc2.connect(gainNode);
  const target = isAudioMuted ? 0 : 0.4;
  gainNode.gain.setTargetAtTime(target, ctx.currentTime + 0.05, 0.15);
  osc1.start(ctx.currentTime + 0.05);
  osc2.start(ctx.currentTime + 0.05);
  
  currentEraOscillators = { osc1, osc2, gainNode };
}

function createCoffeeMachineSFX() {
  if (!audioContext) return;
  
  const ctx = audioContext;
  const hissSource = ctx.createBufferSource();
  const hissFrameCount = ctx.sampleRate * 3;
  const hissBuffer = ctx.createBuffer(1, hissFrameCount, ctx.sampleRate);
  const hissData = hissBuffer.getChannelData(0);
  for (let i = 0; i < hissFrameCount; i++) {
    hissData[i] = (Math.random() * 2 - 1) * 0.4;
  }
  hissSource.buffer = hissBuffer;
  hissSource.loop = true;
  
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
  
  oscA.stop(endAt);
  oscB.stop(endAt);
  hissSource.stop();
  
  setTimeout(() => {
    try { hissSource.stop(); } catch (_) { }
    try { oscA.stop(); } catch (_) { }
    try { oscB.stop(); } catch (_) { }
  }, 1700);
}

window.initAudioSystem = initAudioSystem;
window.setEraMusic = createEraMusicOscillator;
window.playCoffeeMachineSFX = createCoffeeMachineSFX;
window.setAudioMute = (muted) => {
  isAudioMuted = muted;
  if (musicGain) musicGain.gain.value = muted ? 0 : 0.4;
  if (ambienceGain) ambienceGain.gain.value = muted ? 0 : 0.3;
  if (coffeeGain) coffeeGain.gain.value = muted ? 0 : 0.2;
  if (audioContext) muted ? audioContext.suspend() : audioContext.resume();
};

function fadeLayer(layer, visible) {
  const fades = [];
  layer.traverse(child => {
    if (child.isMesh && child.material) {
      fades.push(child.material);
    }
  });
  
  if (visible) {
    layer.visible = true;
    fades.forEach(m => {
      m.opacity = 0;
      m.transparent = true;
    });
    
    let opacity = 0;
    const fadeIn = () => {
      opacity += 0.02;
      fades.forEach(m => (m.opacity = Math.min(opacity, 1)));
      if (opacity < 1) requestAnimationFrame(fadeIn);
    };
    requestAnimationFrame(fadeIn);
  } else {
    fades.forEach(m => {
      m.opacity = 1;
      m.transparent = true;
    });
    
    let opacity = 1;
    const fadeOut = () => {
      opacity -= 0.02;
      fades.forEach(m => (m.opacity = Math.max(opacity, 0)));
      if (opacity > 0) requestAnimationFrame(fadeOut);
      else layer.visible = false;
    };
    requestAnimationFrame(fadeOut);
  }
}

function handleYearSelect(year) {
  currentYear = year;
  
  if (currentLayer) {
    fadeLayer(currentLayer, false);
  }
  
  currentLayer = yearLayers[year];
  currentLayer.visible = true;
  
  fadeLayer(currentLayer, true);
  
  const indicator = document.querySelector('.year-indicator');
  if (indicator) {
    indicator.textContent = `${year} - ${yearLabels[year] || ''}`;
  }
  
  document.querySelectorAll('.year-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.year, 10) === year));
    btn.classList.toggle('selected', parseInt(btn.dataset.year, 10) === year);
  });
  
  if (typeof window.setEraMusic === 'function') {
    window.setEraMusic(year);
  }
  
  if (typeof window.playCoffeeMachineSFX === 'function') {
    window.playCoffeeMachineSFX();
  }
}

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

function installYearButtonHandlers() {
  const yearButtons = document.querySelectorAll('.year-btn');
  
  yearButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      ensureAudioOnGesture();
      const year = parseInt(btn.dataset.year, 10);
      handleYearSelect(year);
    });
  });
  
  const muteBtn = document.querySelector('.mute-button');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      window.setAudioMute(!isAudioMuted);
      muteBtn.textContent = isAudioMuted ? 'Unmute' : 'Mute';
    });
  }
}

function boot() {
  Object.values(yearLayers).forEach(layer => {
    if (!scene.children.includes(layer)) {
      scene.add(layer);
    }
  });
  
  Object.values(yearLayers).forEach(layer => {
    layer.visible = false;
  });
  
  installYearButtonHandlers();
  armGestureOnce();
  
  try {
    initAudioSystem();
  } catch (_) { }
  
  handleYearSelect(currentYear);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();