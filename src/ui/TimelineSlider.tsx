/**
 * Timeline Slider component for the city timelapse application.
 *
 * Shows a range input slider with 5 year options (1945, 1965, 1985, 2005, 2025).
 * Styled as a top-bar control with active year display.
 * Emits 'period-selected' custom event with year string when user interacts.
 *
 * The slider is positioned at the top of the scene viewport and can be listened
 * to by the transformation system for period selection changes.
 */
export class TimelineSlider {
	private container: HTMLElement;
	private currentYear: number;
	private years: number[];

	/**
	 * Creates a new TimelineSlider instance.
	 * @param container - Optional container element. If not provided, appends to document.body.
	 * @param initialYear - The initially selected year (default: 2025).
	 */
	constructor(container?: HTMLElement, initialYear: number = 2025) {
		this.currentYear = initialYear;
		this.years = [1945, 1965, 1985, 2005, 2025];

		// Use provided container or create and append to body
		this.container = container || document.createElement('div');
		this.container.innerHTML = this.render();
		this.container.style.position = 'absolute';
		this.container.style.top = '20px';
		this.container.style.left = '50%';
		this.container.style.transform = 'translateX(-50%)';
		this.container.style.zIndex = '1000';
		this.container.style.background = 'rgba(0, 0, 0, 0.7)';
		this.container.style.padding = '8px 16px';
		this.container.style.borderRadius = '4px';
		this.container.style.color = 'white';
		this.container.style.fontFamily = 'sans-serif';
		this.container.style.display = 'flex';
		this.container.style.alignItems = 'center';
		this.container.style.gap = '10px';

		// If no container was provided, append to body
		if (!container) {
			document.body.appendChild(this.container);
		}

		this.setupEventListeners();
		this.updateYearDisplay();
	}

	/**
	 * Renders the slider HTML.
	 * @returns The HTML string for the timeline slider.
	 */
	private render(): string {
		const selectedIndex = this.years.indexOf(this.currentYear);

		return `
			<span style="min-width: 40px; font-weight: bold;">${this.currentYear}</span>
			<input
				type="range"
				min="1945"
				max="2025"
				step="20"
				value="${this.currentYear}"
			style="flex: 1; height: 20px; cursor: pointer;"
			/>
			<div style="display: flex; gap: 10px; font-size: 12px;">
				${this.years.map(y => String(y)).join(' ')}
			</div>
		`;
	}

	/**
	 * Sets up event listeners for the slider interaction.
	 */
	private setupEventListeners(): void {
		const slider = this.container.querySelector('input[type="range"]') as HTMLInputElement;

		slider.addEventListener('input', (e) => {
			const value = parseInt((e.target as HTMLInputElement).value, 10);

			// Map the range value to the nearest year option
			const year = this.years[Math.round((value - 1945) / 20)];

			if (year !== this.currentYear) {
				this.currentYear = year;
				this.updateYearDisplay();

				// Emit period-selected event that the transformation system can listen to
				const event = new CustomEvent('period-selected', {
					detail: { year: String(year) }
				});
				this.container.dispatchEvent(event);
			}
		});
	}

	/**
	 * Updates the year display element with the current year.
	 */
	private updateYearDisplay(): void {
		const yearDisplay = this.container.querySelector('span') as HTMLElement;
		if (yearDisplay) {
			yearDisplay.textContent = String(this.currentYear);
		}

		// Also update the range input value
		const slider = this.container.querySelector('input[type="range"]') as HTMLInputElement;
		if (slider) {
			slider.value = String(this.currentYear);
		}
	}

	/**
	 * Gets the currently selected year.
	 * @returns The selected year as a number.
	 */
	getSelectedYear(): number {
		return this.currentYear;
	}

	/**
	 * Gets the container element.
	 * @returns The container HTMLElement.
	 */
	getContainer(): HTMLElement {
		return this.container;
	}

	/**
	 * Switches to a different year.
	 * @param year - The year to switch to.
	 */
	switchYear(year: number): void {
		if (this.years.includes(year)) {
			this.currentYear = year;
			this.updateYearDisplay();

			const event = new CustomEvent('period-selected', {
				detail: { year: String(year) }
			});
			this.container.dispatchEvent(event);
		}
	}
}