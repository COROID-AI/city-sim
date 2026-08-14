import * as THREE from 'three'

// Create scene
const scene = new THREE.Scene()

// Create camera
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
camera.position.z = 5

// Create renderer
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(window.devicePixelRatio)

// Add renderer to document body
document.body.appendChild(renderer.domElement)

// Create a simple cube
const geometry = new THREE.BoxGeometry()
const material = new THREE.MeshStandardMaterial({
  color: 0x00ff00
})
const cube = new THREE.Mesh(geometry, material)
scene.add(cube)

// Add lights
const light = new THREE.DirectionalLight(0xffffff, 1)
light.position.set(5, 10, 7.5)
scene.add(light)

const ambientLight = new THREE.AmbientLight(0x404040)
scene.add(ambientLight)

// Basic render loop
const animate = () => {
  requestAnimationFrame(animate)
  cube.rotation.x += 0.01
  cube.rotation.y += 0.01
  renderer.render(scene, camera)
}
animate()