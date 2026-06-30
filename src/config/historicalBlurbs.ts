/**
 * Historical blurbs for the year info panel.
 *
 * Each era has a concise, evocative description of the city's character during
 * that time period. Displayed by the `YearInfoPanel` component so users get
 * historical context as they scrub the timeline.
 */
import type { EraId } from '@/config/years';

/** A historical blurb entry for a single era. */
export interface HistoricalBlurb {
  readonly era: EraId;
  /** Short headline / era name. */
 readonly title: string;
  /** Concise descriptive paragraph. */
 readonly body: string;
  /** A notable detail or fun fact. */
 readonly highlight: string;
}

/**
 * Ordered blurbs keyed by era id. Content is historically inspired but kept
 * brief for HUD readability.
 */
export const HISTORICAL_BLURBS: Record<EraId, HistoricalBlurb> = {
  postwar: {
    era: 'postwar',
    title: 'Post-War Rebuilding',
    body: 'The city awakens after the war. Low brick buildings line quiet streets as communities rebuild and trams rumble past modest storefronts.',
    highlight: 'Rationing ends; the first television sets flicker in shop windows.',
  },
  sixties: {
    era: 'sixties',
    title: 'The Swinging Sixties',
    body: 'Optimism rises with taller concrete blocks and neon signs. Sidewalks bustle as cars replace trams and pop culture fills the airwaves.',
    highlight: 'Color television arrives; the first shopping center opens downtown.',
  },
  eighties: {
    era: 'eighties',
    title: 'The Neon Eighties',
    body: 'Glass-and-steel towers pierce the skyline. Glowing billboards and arcade lights define a decade of bold colors and rapid growth.',
    highlight: 'Personal computers enter homes; the city gets its first mobile phone network.',
  },
  twothousands: {
    era: 'twothousands',
    title: 'The Digital Boom',
    body: 'Sleek SUVs glide past internet cafes and glass facades. The city goes online as broadband reaches every block and the web reshapes daily life.',
    highlight: 'Smartphones debut; digital billboards begin replacing printed ads.',
  },
  present: {
    era: 'present',
    title: 'The Connected Present',
    body: 'Holographic signage and electric pods define a sustainable skyline. Smart sensors manage traffic while green rooftops cool the dense urban core.',
    highlight: 'Autonomous vehicles share the road; the city runs on renewable energy.',
  },
};

/**
 * Look up the blurb for an era. Falls back to the `present` entry for unknown
 * ids so the UI never crashes.
 */
export function getHistoricalBlurb(era: EraId): HistoricalBlurb {
  return HISTORICAL_BLURBS[era] ?? HISTORICAL_BLURBS.present;
}
