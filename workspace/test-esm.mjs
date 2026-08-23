import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Verify key Three.js types are available
const ok = typeof THREE.Scene === 'function' &&
         typeof THREE.Group === 'function' &&
         typeof THREE.PerspectiveCamera === 'function' &&
         typeof THREE.WebGLRenderer === 'function' &&
         typeof THREE.AmbientLight === 'function' &&
         typeof THREE.DirectionalLight === 'function' &&
         typeof THREE.BoxGeometry === 'function' &&
         typeof THREE.MeshStandardMaterial === 'function' &&
         typeof OrbitControls === 'function';

if (ok) {
  console.log('VERIFICATION PASSED: All Three.js ESM imports work correctly');
  console.log('THREE version:', THREE.REVISION);
  console.log('OrbitControls type:', typeof OrbitControls);
  process.exit(0);
} else {
  console.log('VERIFICATION FAILED: Some Three.js types missing');
  process.exit(1);
}