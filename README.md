# Our Solar System — Interactive Guide

A modern, responsive one-page website that describes the Sun and the eight
planets of our Solar System, with an animated orbital diagram and detailed
fact cards.

Built with **vanilla HTML, CSS, and JavaScript** — no frameworks, no build
step, no external network requests.

## Features

- **Animated solar system** — the Sun sits at the center with a glow effect,
  and all eight planets orbit it continuously via pure CSS keyframe animation.
- **Interactive planets** — click any planet in the diagram to scroll to and
  highlight its fact card.
- **Fact cards** — each planet shows its type (terrestrial / gas giant / ice
  giant), diameter, distance from the Sun, orbital period, and 2–3 key facts.
- **Fully responsive** — works on mobile (≥360px), tablet, and desktop with no
  horizontal scrolling.
- **Accessible** — semantic HTML, ARIA labels on interactive planets, visible
  keyboard focus, and full `prefers-reduced-motion` support (orbit animation
  pauses and planets are shown statically).
- **Fast** — loads and is interactive in well under a second. No external
  dependencies beyond optional system fonts.

## Files

| File          | Purpose                                            |
---------------|---------------------------------------------------|
| `index.html`  | Page structure and content                         |
| `styles.css`  | All styling, layout, and orbit animations          |
| `script.js`   | Renders planets/cards from a single data source    |
| `README.md`   | This file                                          |

## Running

Just open `index.html` in any modern browser. No server or install required.

For a quick local server (optional):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Data Sources

All planet facts are verified against the
[NASA Planetary Fact Sheets](https://nssdc.gsfc.nasa.gov/planetary/planetfact.html)
(public domain).

Orbit speeds and planet sizes in the diagram are **compressed for visual
interest** and are not to true scale.

## Browser Support

Any evergreen browser (Chrome, Firefox, Safari, Edge). Uses only standard,
widely-supported features: CSS Grid, custom properties, `aspect-ratio`, and
`prefers-reduced-motion`.
