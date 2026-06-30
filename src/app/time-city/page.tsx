import TimeCitySceneClient from '@/components/TimeCitySceneClient';
import TimelineSlider from '@/components/TimelineSlider';

export default function TimeCityPage() {
  return (
    <main className="relative h-screen w-screen">
      <TimeCitySceneClient />
      <TimelineSlider />
    </main>
  );
}
