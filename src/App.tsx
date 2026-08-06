import { TimelineSlider } from './components/TimelineSlider';
import { Scene } from './components/Scene';
import { AudioControls } from './components/AudioControls';
import { AudioBridge } from './components/AudioBridge';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <TimelineSlider />
        <AudioControls />
      </header>
      <main className="app-stage">
        <Scene />
      </main>
      <AudioBridge />
    </div>
  );
}
