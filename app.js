/**
 * Timeline Slider for Café Timelapse
 * 
 * Provides a top-placed accessible slider with 5 year options (1945, 1965, 1985, 2005, 2025).
 * When a year is selected, it updates application state and triggers scene transformation.
 */

// Application state
const appState = {
  currentYear: 1945,
  years: [1945, 1965, 1985, 2005, 2025],
  sceneElement: null,
  buttons: null,
  init() {
    this.cacheElements();
    this.attachEvents();
    this.updateButtonStates();
    this.applyYearToScene();
  },
  cacheElements() {
    this.sceneElement = document.querySelector('.scene');
    this.buttons = document.querySelectorAll('.year-btn');
  },
  attachEvents() {
    this.buttons.forEach(button => {
      button.addEventListener('click', () => this.handleYearSelect(button));
    });
  },
  handleYearSelect(selectedButton) {
    // Remove selected class from all buttons
    this.buttons.forEach(btn => btn.classList.remove('selected'));
    
    // Add selected class to clicked button
    selectedButton.classList.add('selected');
    
    // Update application state
    const year = parseInt(selectedButton.dataset.year, 10);
    this.currentYear = year;
    this.updateButtonStates();
    
    // Apply the year to the scene (trigger transformation)
    this.applyYearToScene();
  },
  updateButtonStates() {
    this.buttons.forEach(button => {
      const year = parseInt(button.dataset.year, 10);
      if (year === this.currentYear) {
        button.classList.add('selected');
        button.setAttribute('aria-pressed', 'true');
      } else {
        button.classList.remove('selected');
        button.setAttribute('aria-pressed', 'false');
      }
    });
  },
  applyYearToScene() {
    if (this.sceneElement) {
      this.sceneElement.classList.add('transformed');
      
      // Set scene content based on the selected year
      const yearLabels = {
        1945: 'Post-War Era',
        1965: 'Swinging Sixties',
        1985: 'Retro Eighties',
        2005: 'Digital Age',
        2025: 'Modern Times'
      };
      
      this.sceneElement.querySelector('h2').textContent = `Café ${yearLabels[this.currentYear]}`;
      this.sceneElement.querySelector('p').textContent = `Year: ${this.currentYear} - Café timelapse transformation active`;
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => appState.init());
} else {
  appState.init();
}