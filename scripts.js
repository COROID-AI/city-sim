/*
 * Timeline Slider Interactivity
 * Emits 'yearSelected' event when a year button is clicked
 * Integrates with Three.js overlay
 */

const yearButtons = document.querySelectorAll('.year-btn');

// Store the currently selected year
let selectedYear = 2025;

// Initialize: set 2025 as the initially active year
function init() {
  setActiveYear(selectedYear);
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
  emitYearSelected(year);
}

// Add click listeners to all year buttons
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
    emitYearSelected(year);
  }
};