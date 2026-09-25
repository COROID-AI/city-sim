/** Procedural, period-specific ad artwork; no external images or trademarks. */
import { CanvasTexture, SRGBColorSpace } from "three";

import type { EraConfig, EraId } from "../era/eraTypes";
import type { AdFormat } from "./advertising";

const BRAND_NAMES: Readonly<Record<EraId, readonly string[]>> = {
  "1945": ["HARBOR SOAP", "NORTHSTAR TEA", "CROWN RADIO", "CIVIC SAVINGS"],
  "1965": ["SUNLINE MOTORS", "ORBIT TELEVISION", "SKYWAY AIR", "GOLDEN HOUR"],
  "1985": ["NOVA VIDEO", "VOLT TRAINERS", "CALLWAVE", "NEON CITY FM"],
  "2005": ["PIXEL PLAYER", "WEEKEND WORLD", "ZIP MOBILE", "BRIGHT PLAN"],
  "2025": ["MOSS & MOTION", "LOOP ENERGY", "COMMON GROUND", "OPEN SKY"],
};

const SLOGANS: Readonly<Record<EraId, readonly string[]>> = {
  "1945": ["GOOD THINGS, MADE TO LAST", "A BRIGHTER DAY STARTS HERE", "MADE FOR EVERY HOME"],
  "1965": ["MAKE EVERY DAY A LITTLE BRIGHTER", "THE ROAD IS YOURS", "A NEW VIEW OF TOMORROW"],
  "1985": ["TURN UP YOUR CITY", "LIVE LOUDER TONIGHT", "YOUR NEXT BIG THING"],
  "2005": ["TAKE MORE WITH YOU", "MAKE TIME FOR PLAY", "EVERYTHING IN ONE PLACE"],
  "2025": ["BETTER BY DESIGN, TOGETHER", "POWER A LIGHTER TOMORROW", "GOOD IDEAS MOVE US"],
};

const INKS: Readonly<Record<EraId, readonly [string, string, string]>> = {
  "1945": ["#eee3c5", "#9d3428", "#243a32"],
  "1965": ["#fff2cb", "#e75337", "#176d85"],
  "1985": ["#f6e8ff", "#ff4ca1", "#24d8dd"],
  "2005": ["#f4f5e9", "#e2a52e", "#286e86"],
  "2025": ["#e8f7ec", "#78d59c", "#6bd5d6"],
};

/** Build one immutable GPU texture for an era/placement creative. */
export function createAdTexture(era: EraConfig, format: AdFormat, seed: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required to generate procedural advertising artwork.");

  const [paper, primary, accent] = INKS[era.id];
  const brandIndex = seed % BRAND_NAMES[era.id].length;
  const brand = BRAND_NAMES[era.id][brandIndex]!;
  const slogan = SLOGANS[era.id][seed % SLOGANS[era.id].length]!;
  const digital = era.id === "2005" || era.id === "2025";
  const illuminated = era.id !== "1945";

  context.fillStyle = era.id === "1985" ? "#18182b" : era.id === "2025" ? "#102b2b" : paper;
  context.fillRect(0, 0, 512, 512);

  if (era.id === "1945") {
    // A deliberately imperfect, ink-on-paper inset suggests a hand-painted wall.
    context.fillStyle = primary;
    context.fillRect(18, 18, 476, 476);
    context.fillStyle = paper;
    context.fillRect(29, 29, 454, 454);
    context.strokeStyle = accent;
    context.lineWidth = 5;
    context.strokeRect(43, 43, 426, 426);
  } else if (era.id === "1965") {
    context.fillStyle = primary;
    context.fillRect(0, 0, 512, 34);
    context.fillRect(0, 478, 512, 34);
  } else if (era.id === "1985") {
    context.strokeStyle = primary;
    context.lineWidth = 12;
    context.strokeRect(18, 18, 476, 476);
    context.strokeStyle = accent;
    context.lineWidth = 4;
    context.strokeRect(34, 34, 444, 444);
  } else {
    context.fillStyle = era.id === "2025" ? "#153a35" : "#142630";
    context.fillRect(0, 0, 512, 512);
    context.fillStyle = primary;
    context.fillRect(0, 0, 512, 20);
    context.fillRect(0, 492, 512, 20);
    if (era.id === "2005") {
      context.fillStyle = accent;
      context.fillRect(0, 392, 512, 120);
    }
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = illuminated ? "#fffaf0" : "#28271f";
  context.font = `700 ${format === "pole-banner" ? 50 : 43}px ${digital ? "Arial, sans-serif" : "Georgia, serif"}`;
  context.fillText(brand, 256, 112, 430);

  context.fillStyle = era.id === "1985" || era.id === "2025" ? accent : primary;
  context.fillRect(105, 154, 302, 8);
  context.fillStyle = illuminated ? "#f8f6ed" : "#35342d";
  context.font = `${format === "window-poster" ? 29 : 34}px ${digital ? "Arial, sans-serif" : "Georgia, serif"}`;
  const words = slogan.split(" ");
  let line = "";
  let lineIndex = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > 400 && line) {
      context.fillText(line, 256, 210 + lineIndex * 48, 420);
      lineIndex += 1;
      line = word;
    } else line = candidate;
  }
  if (line) context.fillText(line, 256, 210 + lineIndex * 48, 420);

  context.fillStyle = accent;
  if (format === "billboard") {
    context.beginPath();
    context.arc(256, 388, 65, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = paper;
    context.font = "700 24px Arial, sans-serif";
    context.fillText(era.id === "1945" ? "TRUSTED" : era.advertising.typography.toUpperCase().slice(0, 12), 256, 388, 118);
  } else {
    context.fillRect(80, 363, 352, 5);
    context.font = "600 21px Arial, sans-serif";
    context.fillStyle = illuminated ? "#e4e8dc" : "#46443b";
    context.fillText(format === "pole-banner" ? "LOOK UP • LOOK AHEAD" : "A NEIGHBORHOOD FAVORITE", 256, 412, 420);
  }

  if (format === "led-ticker" || era.id === "2025") {
    context.fillStyle = era.id === "2025" ? "#78d59c" : "#ffc944";
    for (let index = 0; index < 12; index += 1) context.fillRect(38 + index * 39, 460, 19, 8);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
