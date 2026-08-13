// Timeline Slider UI Component
// Creates a horizontal slider with buttons for specific years
// and highlights the selected button.

export interface TimelineSliderOptions {
  /** Callback function when a button is clicked */
  onYearSelect: (year: number) => void;
  /** Initial selected year (default: 1945) */
  initialYear?: number;
}

export class TimelineSlider {
  private container!: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private selectedYear: number;
  private onYearSelect: (year: number) => void;

  constructor(options: TimelineSliderOptions) {
    this.onYearSelect = options.onYearSelect;
    this.selectedYear = options.initialYear ?? 1945;
    this.createUI();
    this.updateHighlight();
  }

  private createUI(): void {
    // Create container div
    this.container = document.createElement('div');
    this.container.style.position = 'fixed';
    this.container.style.top = '10px';
    this.container.style.left = '50%';
    this.container.style.transform = 'translateX(-50%)';
    this.container.style.display = 'flex';
    this.container.style.gap = '10px';
    this.container.style.zIndex = '1000';
    this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    this.container.style.padding = '10px';
    this.container.style.borderRadius = '5px';

    // Years for the buttons
    const years = [1945, 1965, 1985, 2005, 2025];

    years.forEach(year => {
      const button = document.createElement('button');
      button.textContent = year.toString();
      button.style.padding = '8px 16px';
      button.style.fontSize = '16px';
      button.style.cursor = 'pointer';
      button.style.border = 'none';
      button.style.borderRadius = '3px';
      button.style.backgroundColor = '#4CAF50';
      button.style.color = 'white';
      button.style.transition = 'background-color 0.2s';

      button.addEventListener('mouseover', () => {
        if (!button.classList.contains('selected')) {
          button.style.backgroundColor = '#45a049';
        }
      });

      button.addEventListener('mouseout', () => {
        if (!button.classList.contains('selected')) {
          button.style.backgroundColor = '#4CAF50';
        }
      });

      button.addEventListener('click', () => {
        this.selectYear(year);
        this.onYearSelect(year);
      });

      this.buttons.push(button);
      this.container.appendChild(button);
    });

    // Add container to body
    document.body.appendChild(this.container);
  }

  private updateHighlight(): void {
    this.buttons.forEach(button => {
      const year = parseInt(button.textContent || '', 10);
      if (year === this.selectedYear) {
        button.classList.add('selected');
        button.style.backgroundColor = '#2E7D32'; // Darker green for selected
      } else {
        button.classList.remove('selected');
        button.style.backgroundColor = '#4CAF50'; // Reset to default
      }
    });
  }

  /** Select a year and update UI */
  public selectYear(year: number): void {
    this.selectedYear = year;
    this.updateHighlight();
  }

  /** Get the currently selected year */
  public getSelectedYear(): number {
    return this.selectedYear;
  }

  /** Destroy the slider and remove from DOM */
  public destroy(): void {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}