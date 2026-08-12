function getGameCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')
  if (!canvas) {
    throw new Error('Canvas element #game not found')
  }
  return canvas
}

function get2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D canvas context unavailable')
  }
  return ctx
}

const canvas = getGameCanvas()
const ctx = get2DContext(canvas)

/** Match the canvas backing store to the current viewport (device-pixel aware). */
function resize(): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr))
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/** Placeholder render: clears the canvas and draws a minimal city-block grid. */
function draw(): void {
  const w = window.innerWidth
  const h = window.innerHeight

  // Clear + base layer
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#0e1b2a'
  ctx.fillRect(0, 0, w, h)

  // Faint grid hinting at city blocks
  const cell = 64
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= w; x += cell) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let y = 0; y <= h; y += cell) {
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()

  // Landmark placeholder in the center
  ctx.fillStyle = '#f4a261'
  ctx.fillRect(w / 2 - 32, h / 2 - 32, 64, 64)
  ctx.fillStyle = '#ffffff'
  ctx.font = '14px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('City Sim scaffold', w / 2, h / 2 + 56)
}

resize()
draw()
window.addEventListener('resize', () => {
  resize()
  draw()
})