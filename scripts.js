/* 
 * Timeline Slider Interactivity
 * Emits 'yearSelected' event when a year button is clicked
 * Integrates with Three.js overlay
 */

// Asset catalog integration for era-specific building materials
import { AssetCatalog, Era } from './src/asset-catalog.js';

// Store the currently selected year
let selectedYear = Era.Era2025;
let selectedEra = Era.Era2025;

// Initialize: set 2025 as the initially active year
function init() {
  setActiveYear(selectedYear);
  // Swap to initial era assets
  swapEraAssets(selectedYear);
}

// Set the active year state on the buttons
function setActiveYear(year) {
  yearButtons.forEach(btn => {
    const btnYear = parseInt(btn.dataset.year);
    if (btnYear === year) {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    } else {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    }
  });
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

// Swap era assets when year changes
async function swapEraAssets(year) {
  const eraMap = {
    1945: Era.Era1945,
    1965: Era.Era1965,
    1985: Era.Era1985,
    2005: Era.Era2005,
    2025: Era.Era2025,
  };
  const targetEra = eraMap[year] || Era.Era2025;
  const assets = await AssetCatalog.swapAssets(selectedEra, targetEra);
  selectedEra = targetEra;
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
  swapEraAssets(year);
  emitYearSelected(year);
}

// Add click listeners to all year buttons
const yearButtons = document.querySelectorAll('.year-btn');
yearButtons.forEach(btn => {
  btn.addEventListener('click', handleYearClick);
});

// Initialize the slider
init();

// Export for integration with Three.js overlay
window.timelineSlider = {
  getSelectedYear: () => selectedYear,
  setSelectedYear: (year) => {
    selectedYear = year;
    setActiveYear(year);
    swapEraAssets(year);
    emitYearSelected(year);
  }
};