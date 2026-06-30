import TimeCitySceneClient from '@/components/TimeCitySceneClient';
import TimelineSlider from '@/components/TimelineSlider';
import AudioControls from '@/components/AudioControls';
import AudioManager from '@/components/AudioManager';
import EffectsControls from '@/components/EffectsControls';

export default function TimeCityPage() {
  return (
    <main className="relative h-screen w-screen">
      <TimeCitySceneClient />
      <TimelineSlider />
      <AudioControls />
      <EffectsControls />
      {/* Headless controller: unlocks audio on first gesture, plays SFX, runs ambient layer */}
      <AudioManager />
    </main>
  );
}
