import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { EraSceneBuilder, EraKey, eraConfigs, getEraConfig } from './eraSceneBuilder'
import { VehicleSystem } from './vehicles/VehicleSystem'
import { TimelineSlider } from './ui/TimelineSlider'

// Initialize the era-based scene builder
const sceneBuilder = new EraSceneBuilder()

// Initialize VehicleSystem with current era
const vehicleSystem = new VehicleSystem(2025, sceneBuilder.scene)

// Start the animation loop
sceneBuilder.start()

// Era switching controls
const ERA_YEARS = [1945, 1965, 1985, 2005, 2025] as EraKey[]
let currentEraIndex = 4 // Start with 2025

// UI elements
const eraDisplay = document.createElement('div')
eraDisplay.style.position = 'absolute'
eraDisplay.style.top = '20px'
eraDisplay.style.right = '20px'
eraDisplay.style.background = 'rgba(0,0,0,0.7)'
eraDisplay.style.padding = '10px'
eraDisplay.style.borderRadius = '5px'
eraDisplay.style.color = 'white'
eraDisplay.style.fontFamily = 'sans-serif'
eraDisplay.style.zIndex = '100'
eraDisplay.innerHTML = `Era: ${ERA_YEARS[currentEraIndex]}`
document.body.appendChild(eraDisplay)

// Control buttons
const prevBtn = document.createElement('button')
prevBtn.textContent = '← Previous'
prevBtn.style.position = 'absolute'
prevBtn.style.bottom = '20px'
prevBtn.style.left = '20px'
prevBtn.style.padding = '8px 16px'
prevBtn.style.background = 'rgba(0,0,0,0.7)'
prevBtn.style.color = 'white'
prevBtn.style.border = 'none'
prevBtn.style.borderRadius = '4px'
prevBtn.style.zIndex = '100'

const nextBtn = document.createElement('button')
nextBtn.textContent = 'Next →'
nextBtn.style.position = 'absolute'
nextBtn.style.bottom = '20px'
nextBtn.style.right = '20px'
nextBtn.style.padding = '8px 16px'
nextBtn.style.background = 'rgba(0,0,0,0.7)'
nextBtn.style.color = 'white'
nextBtn.style.border = 'none'
nextBtn.style.borderRadius = '4px'
nextBtn.style.zIndex = '100'

document.body.appendChild(prevBtn)
document.body.appendChild(nextBtn)

// Era change functions
function switchToEra(index: number): void {
  const year = ERA_YEARS[index]
  sceneBuilder.switchEra(year)
  vehicleSystem.switchEra(year)
  eraDisplay.innerHTML = `Era: ${year}`
  currentEraIndex = index
}

prevBtn.addEventListener('click', () => {
  currentEraIndex = (currentEraIndex - 1 + ERA_YEARS.length) % ERA_YEARS.length
  switchToEra(currentEraIndex)
})

nextBtn.addEventListener('click', () => {
  currentEraIndex = (currentEraIndex + 1) % ERA_YEARS.length
  switchToEra(currentEraIndex)
})

// Keyboard shortcuts for era switching
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') {
    currentEraIndex = (currentEraIndex - 1 + ERA_YEARS.length) % ERA_YEARS.length
    switchToEra(currentEraIndex)
  } else if (e.key === 'ArrowRight') {
    currentEraIndex = (currentEraIndex + 1 + ERA_YEARS.length) % ERA_YEARS.length
    switchToEra(currentEraIndex)
  } else if (e.key === '1') {
    switchToEra(0) // 1945
  } else if (e.key === '2') {
    switchToEra(1) // 1965
  } else if (e.key === '3') {
    switchToEra(2) // 1985
  } else if (e.key === '4') {
    switchToEra(3) // 2005
  } else if (e.key === '5') {
    switchToEra(4) // 2025
  }
})

// Initialize TimelineSlider with accessible attributes for browser probe
const timelineSlider = new TimelineSlider(undefined, 2025)
document.body.appendChild(timelineSlider.getContainer())

// Listen for period-selected events from the slider
timelineSlider.getContainer().addEventListener('period-selected', (e) => {
  const year = parseInt(e.detail.year, 10)
  if (!isNaN(year)) {
    switchToEra(ERA_YEARS.indexOf(year) + 1)
  }
})

// Initialize with 2025 era
switchToEra(4)