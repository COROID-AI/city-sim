/* ============================================================
   Our Solar System — script.js
   Renders the orbital diagram + fact cards from a single data
   source. Vanilla JS, no dependencies.
   ============================================================ */

"use strict";

/**
 * Planet data. Values verified against NASA Planetary Fact Sheets.
 * https://nssdc.gsfc.nasa.gov/planetary/planetfact.html
 *
 * Visual fields (size, orbitRadius, periodSec) are compressed for
 * display and are NOT to true scale.
 */
const PLANETS = [
  {
    id: "mercury",
    name: "Mercury",
    type: "Terrestrial",
    color: "#9c8a78",
    size: 8,
    orbitRadius: 70,
    periodSec: 4.8,
    periodDays: 88,
    diameter: "4,879 km",
    distance: "57.9 million km",
    facts: [
      "The smallest planet and closest to the Sun.",
      "Has almost no atmosphere, so temperatures swing from -173 °C to 427 °C.",
      "A single day on its surface lasts about 176 Earth days.",
    ],
  },
  {
    id: "venus",
    name: "Venus",
    type: "Terrestrial",
    color: "#e3b778",
    size: 12,
    orbitRadius: 100,
    periodSec: 7.4,
    periodDays: 225,
    diameter: "12,104 km",
    distance: "108.2 million km",
    facts: [
      "The hottest planet, with a surface temperature of about 465 °C.",
      "Spins backwards (retrograde) compared to most planets.",
      "A thick CO₂ atmosphere creates a runaway greenhouse effect.",
    ],
  },
  {
    id: "earth",
    name: "Earth",
    type: "Terrestrial",
    color: "#4f9bd9",
    size: 13,
    orbitRadius: 135,
    periodSec: 10,
    periodDays: 365.25,
    diameter: "12,742 km",
    distance: "149.6 million km",
    facts: [
      "The only known planet to support life.",
      "71% of its surface is covered by liquid water.",
      "Has one natural satellite — the Moon.",
    ],
  },
  {
    id: "mars",
    name: "Mars",
    type: "Terrestrial",
    color: "#d96b3c",
    size: 10,
    orbitRadius: 170,
    periodSec: 13.5,
    periodDays: 687,
    diameter: "6,779 km",
    distance: "227.9 million km",
    facts: [
      "Known as the Red Planet due to iron oxide (rust) on its surface.",
      "Home to Olympus Mons, the tallest volcano in the Solar System.",
      "Has two small moons: Phobos and Deimos.",
    ],
  },
  {
    id: "jupiter",
    name: "Jupiter",
    type: "Gas Giant",
    color: "#d8a878",
    size: 26,
    orbitRadius: 215,
    periodSec: 17,
    periodDays: 4333,
    diameter: "139,820 km",
    distance: "778.5 million km",
    facts: [
      "The largest planet — more than twice the mass of all others combined.",
      "The Great Red Spot is a storm that has raged for centuries.",
      "Has at least 95 known moons, including the giant Ganymede.",
    ],
  },
  {
    id: "saturn",
    name: "Saturn",
    type: "Gas Giant",
    color: "#e6d2a0",
    size: 22,
    orbitRadius: 255,
    periodSec: 21,
    periodDays: 10759,
    diameter: "116,460 km",
    distance: "1.43 billion km",
    hasRing: true,
    facts: [
      "Famous for its spectacular ring system of ice and rock.",
      "The least dense planet — it would float in water.",
      "Has 146 confirmed moons, the most of any planet.",
    ],
  },
  {
    id: "uranus",
    name: "Uranus",
    type: "Ice Giant",
    color: "#9fdde0",
    size: 17,
    orbitRadius: 290,
    periodSec: 25,
    periodDays: 30687,
    diameter: "50,724 km",
    distance: "2.87 billion km",
    facts: [
      "Rotates on its side — a 98° axial tilt.",
      "The coldest planetary atmosphere, reaching -224 °C.",
      "Has 13 faint rings and 28 known moons.",
    ],
  },
  {
    id: "neptune",
    name: "Neptune",
    type: "Ice Giant",
    color: "#4f70d9",
    size: 16,
    orbitRadius: 320,
    periodSec: 29,
    periodDays: 60190,
    diameter: "49,244 km",
    distance: "4.50 billion km",
    facts: [
      "The windiest planet, with storms reaching 2,100 km/h.",
      "Discovered through mathematical prediction in 1846.",
      "Has 16 known moons, including Triton which orbits backwards.",
    ],
  },
];

const prefersReducedMotion =
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Build the orbital diagram inside #solarSystem.
 */
function renderSolarSystem() {
  const stage = document.getElementById("solarSystem");
  if (!stage) return;

  PLANETS.forEach((p, i) => {
    // Visual orbit ring
    const ring = document.createElement("div");
    ring.className = "orbit-ring";
    ring.style.width = p.orbitRadius * 2 + "px";
    ring.style.height = p.orbitRadius * 2 + "px";
    stage.appendChild(ring);

    // Rotating arm
    const arm = document.createElement("div");
    arm.className = "orbit-arm";
    arm.style.width = p.orbitRadius * 2 + "px";
    arm.style.height = p.orbitRadius * 2 + "px";
    arm.style.animationDuration = p.periodSec + "s";

    if (prefersReducedMotion) {
      // Spread planets evenly around the ring when motion is off.
      const angle = (360 / PLANETS.length) * i;
      arm.setAttribute("data-static-angle", String(angle));
      arm.style.setProperty("--static-angle", angle + "deg");
    }

    // Planet button (counter-rotates to stay upright)
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "planet-btn";
    btn.setAttribute("aria-label", `Show facts for ${p.name}`);
    btn.dataset.planetId = p.id;
    btn.style.animationDuration = p.periodSec + "s";

    const dot = document.createElement("span");
    dot.className = "planet-dot" + (p.hasRing ? " has-ring" : "");
    dot.style.width = p.size + "px";
    dot.style.height = p.size + "px";
    dot.style.background =
      "radial-gradient(circle at 32% 30%, #ffffff55, " + p.color + " 60%)";
    dot.style.position = "relative";

    btn.appendChild(dot);
    arm.appendChild(btn);
    stage.appendChild(arm);

    btn.addEventListener("click", () => focusPlanetCard(p.id));
  });

  if (prefersReducedMotion) {
    const note = document.getElementById("reducedMotionNote");
    if (note) note.hidden = false;
  }
}

/**
 * Build the fact cards inside #cardsGrid.
 */
function renderCards() {
  const grid = document.getElementById("cardsGrid");
  if (!grid) return;

  PLANETS.forEach((p) => {
    const card = document.createElement("article");
    card.className = "planet-card";
    card.id = "card-" + p.id;

    card.innerHTML = `
      <div class="card-head">
        <span class="card-swatch" style="background: radial-gradient(circle at 32% 30%, #ffffff55, ${p.color} 60%);"></span>
        <h3 class="card-name">${p.name}</h3>
        <span class="card-type">${p.type}</span>
      </div>
      <div class="card-stats">
        <div class="card-stat"><b>Diameter</b>${p.diameter}</div>
        <div class="card-stat"><b>Distance from Sun</b>${p.distance}</div>
        <div class="card-stat"><b>Orbital period</b>${p.periodDays.toLocaleString()} days</div>
        <div class="card-stat"><b>Order from Sun</b>${PLANETS.indexOf(p) + 1} of 8</div>
      </div>
      <ul class="card-facts">
        ${p.facts.map((f) => `<li>${f}</li>`).join("")}
      </ul>
    `;

    grid.appendChild(card);
  });
}

/**
 * Scroll a planet's card into view and briefly highlight it.
 */
let highlightTimer = null;
function focusPlanetCard(id) {
  const card = document.getElementById("card-" + id);
  if (!card) return;

  card.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });

  // Clear any previous highlight, then apply.
  document.querySelectorAll(".planet-card.highlight").forEach((el) => el.classList.remove("highlight"));
  if (highlightTimer) clearTimeout(highlightTimer);
  // Defer to ensure the class toggles even if scroll is instant.
  requestAnimationFrame(() => {
    card.classList.add("highlight");
    highlightTimer = setTimeout(() => card.classList.remove("highlight"), 2600);
  });
}

// Boot once DOM is ready (script is deferred, but guard anyway).
function init() {
  renderSolarSystem();
  renderCards();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
