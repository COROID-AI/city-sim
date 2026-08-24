/**
 * src/ui/metadata.js
 *
 * Small data-driven accessor for the declared era metadata that every era
 * module exposes. Keeping the reads here means the interaction layer stays
 * fully data-driven: it never hard-codes a year, object, or camera preset —
 * it just asks the active era what it exposes.
 *
 * Era metadata shape (declared on each era module under `metadata`):
 *   {
 *     tint: string,                        // hex accent colour for the selected decade
 *     caption: { name, vibe },             // compact era caption under the slider
 *     inspectables: [{
 *       id, name,                          // stable id + human title for the info card
 *       object,                            // token(s) matched against hit mesh names
 *       story,                             // period-specific one-line description
 *     }],
 *     presets: [{
 *       id, name,
 *       position: [x,y,z],                 // camera position for the bookmark
 *       target:   [x,y,z],                 // orbit target for the bookmark
 *     }],
 *     overview: { position, target },       // "Return to overview" camera
 *   }
 */
const FALLBACK_TINT = '#e8b55c';

function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return norm(value)
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

/** Raw metadata object for an era module (or null when undeclared). */
export function getEraMetadata(era) {
  return era && typeof era.metadata === 'object' && era.metadata ? era.metadata : null;
}

/** Accent tint hex for the era's selected decade. */
export function getEraTint(era) {
  return getEraMetadata(era)?.tint || FALLBACK_TINT;
}

/** Compact caption { name, vibe } for the era. */
export function getEraCaption(era) {
  const meta = getEraMetadata(era);
  if (meta?.caption) return meta.caption;
  return { name: era?.label || String(era?.year || ''), vibe: '' };
}

/** Declared inspectable objects for the era. */
export function getInspectables(era) {
  const meta = getEraMetadata(era);
  return Array.isArray(meta?.inspectables) ? meta.inspectables : [];
}

/** Declared camera presets (Explore bookmarks) for the era. */
export function getPresets(era) {
  const meta = getEraMetadata(era);
  return Array.isArray(meta?.presets) ? meta.presets : [];
}

/** Declared "Return to overview" camera (may be null). */
export function getOverview(era) {
  const meta = getEraMetadata(era);
  return meta?.overview || null;
}

/**
 * Match a raycast-hit object's name against the era's declared inspectables.
 * Matching is deliberately tolerant because era content is low-poly and often
 * has long composite names (e.g. "white click-wheel iPod in speaker dock…")
 * while the hit mesh may be a child ("white iPod speaker dock"). We score by
 * shared significant tokens and pick the closest declared entry.
 */
export function findInspectable(era, hitObjectName) {
  const target = norm(hitObjectName);
  if (!target) return null;
  const targetTokens = tokens(target);
  let best = null;
  let bestScore = 0;

  for (const item of getInspectables(era)) {
    const candidate = norm(item.object);
    if (!candidate) continue;
    let score = 0;
    if (candidate === target) score = 100;
    else if (target.includes(candidate) || candidate.includes(target)) score = 60;
    else {
      const candidateTokens = tokens(candidate);
      for (const tok of candidateTokens) {
        if (targetTokens.includes(tok)) score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Match a raycast hit or one of its named ancestors to an era entry. */
export function findInspectableForHit(era, object) {
  let node = object;
  while (node) {
    const match = findInspectable(era, node.name || '');
    if (match) return match;
    node = node.parent;
  }
  return null;
}