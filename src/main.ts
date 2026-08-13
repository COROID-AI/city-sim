import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Scene setup
const scene = new THREE.Scene()

// Camera setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.z = 5

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

// Orbit controls
const controls = new OrbitControls(camera, renderer.domElement)

// Ground
const groundGeometry = new THREE.PlaneGeometry(10, 10)
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 })
const ground = new THREE.Mesh(groundGeometry, groundMaterial)
ground.rotation.x = -Math.PI / 2
scene.add(ground)

// Roads
const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 })
const roadWidth = 1

// Horizontal road
const roadH = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, roadWidth), roadMaterial)
roadH.position.y = -0.1
scene.add(roadH)

// Vertical road
const roadV = new THREE.Mesh(new THREE.BoxGeometry(roadWidth, 0.5, 10), roadMaterial)
roadV.position.x = -0.1
scene.add(roadV)

// Sidewalks
const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc })
const sidewalkWidth = 1

// Sidewalk segments
const sidewalkTop = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, sidewalkWidth), sidewalkMaterial)
scene.add(sidewalkTop)

const sidewalkBottom = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, sidewalkWidth), sidewalkMaterial)
sidewalkBottom.position.y = -2.9
scene.add(sidewalkBottom)

const sidewalkLeft = new THREE.Mesh(new THREE.BoxGeometry(sidewalkWidth, 0.2, 10), sidewalkMaterial)
scene.add(sidewalkLeft)

const sidewalkRight = new THREE.Mesh(new THREE.BoxGeometry(sidewalkWidth, 0.2, 10), sidewalkMaterial)
sidewalkRight.position.x = -2.9
scene.add(sidewalkRight)

// Simple building
const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 })
const building = new THREE.Mesh(
  new THREE.BoxGeometry(2, 3, 2),
  buildingMaterial
)
building.position.set(1, 1.5, 1)
scene.add(building)

// Animation loop
function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

animate()

// Handle resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})