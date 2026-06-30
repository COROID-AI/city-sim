import TimeCitySceneClient from '@/components/TimeCitySceneClient';
import TimelineSlider from '@/components/TimelineSlider';
import AudioControls from '@/components/AudioControls';
import AudioManager from '@/components/AudioManager';
import EffectsControls from '@/components/EffectsControls';
import HelpOverlay from '@/components/ui/HelpOverlay';
import YearInfoPanel from '@/components/ui/YearInfoPanel';
import TooltipOverlay from '@/components/ui/TooltipOverlay';

export default function TimeCityPage() {
  return (
    <main className="relative h-screen w-screen">
      {/* 3D scene + loading screen */}
      <TimeCitySceneClient />

      {/* Top-centred timeline (highest priority — never overlapped) */}
      <TimelineSlider />

      {/* Left-side historical blurb panel */}
      <YearInfoPanel />

      {/* Right-side help overlay (rotate / pan / zoom) */}
      <HelpOverlay />

      {/* Bottom-left effects toggles */}
      <EffectsControls />

      {/* Bottom-right audio controls */}
      <AudioControls />

      {/* Floating hover tooltip — follows cursor over buildings/props */}
      <TooltipOverlay />

      {/* Headless controller: unlocks audio on first gesture, plays SFX, runs ambient layer */}
      <AudioManager />
    </main>
  );
}
