Build a standalone, browser-based 2D city simulation. The city runs in real time with citizens, vehicles, companies, and a live economy — viewable in any browser. The details of all entities should be in great detail.

Visuals day/night cycle visible; ≥20 buildings, ≥50 citizens, ≥10 vehicles active simultaneously.

Citizens follow daily schedules (home → work → entertainment → home); companies track revenue/employees; economy updates every sim-hour.

Top-overlay shows population, employment rate, city time, city budget.

Since the city is large and the window will only show a piece of the city, therefor a Minimap is needed to display what the browser window is looking at in the city.

Use any stack you prefer, but it must load directly and start the simulation upon loaded in a browser.

## Pelican riding

- Deliverable: open `index.html` in any browser — a pelican riding a bicycle along a scrolling country road. The file is fully self-contained (inline SVG artwork, styles, and script; zero external assets, works with networking disabled).
- Interaction: click or tap the scene — or press Enter/Space — to ring the bicycle bell (bell shakes with a "Ding!" spark and the pelican's beak briefly opens).
- Verify: `node scripts/verify.mjs` runs the headless-Chromium checks for self-containment, motion, zero script errors, and the bell interaction.
