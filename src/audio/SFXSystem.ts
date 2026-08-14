import { Howl, Howler } from 'howler';

// Period-specific audio configurations
// URLs would point to actual audio assets in a production deployment
const periodAudioConfigs: Record<string, { music: string; ambient: string }> = {
  '1945': {
    music: '/audio/1945-jazz-bigband.mp3',
    ambient: '/audio/1945-ambient-jazz.mp3',
  },
  '1965': {
    music: '/audio/1965-rock-roll.mp3',
    ambient: '/audio/1965-ambient-rock.mp3',
  },
  '1985': {
    music: '/audio/1985-synthpop.mp3',
    ambient: '/audio/1985-ambient-synth.mp3',
  },
  '2005': {
    music: '/audio/2005-ambient-electronic.mp3',
    ambient: '/audio/2005-ambient-electronic.mp3',
  },
  '2025': {
    music: '/audio/2025-ambient-tech.mp3',
    ambient: '/audio/2025-ambient-tech.mp3',
  },
}

// Howler sound instances
let musicInstance: Howl | null = null;
let ambientInstance: Howl | null = null;
let currentPeriod: string = '2025';
let volumeLevel: number = 0.7; // Default volume (70%)

// Initialize Howler global settings
Howler.volume(volumeLevel);

/**
 * SFXSystem manages period-appropriate sound effects and music.
 * Swaps soundtrack and ambient sounds when period changes, with fade transitions.
 * Integrates with TransformationEngine for sync with visual changes.
 */
export class SFXSystem {
  /** Current active period */
  public getCurrentPeriod(): string {
    return currentPeriod;
  }

  /** Current volume level (0.0 to 1.0) */
  public getVolume(): number {
    return volumeLevel;
  }

  /** Set volume level (0.0 to 1.0), respects user settings */
  public setVolume(volume: number): void {
    volumeLevel = Math.max(0, Math.min(1, volume));
    Howler.volume(volumeLevel);

    // Apply to existing instances
    if (musicInstance) {
      musicInstance.volume(volumeLevel);
    }
    if (ambientInstance) {
      ambientInstance.volume(volumeLevel);
    }
  }

  /** Switch to a specific period with fade transition */
  public switchPeriod(period: string): void {
    // Validate period
    if (!periodAudioConfigs[period]) {
      console.warn(`No audio configuration for period: ${period}`);
      return;
    }

    // Don't switch if already on the same period
    if (currentPeriod === period) {
      return;
    }

    currentPeriod = period;

    const config = periodAudioConfigs[period];

    // Fade out current music if playing
    if (musicInstance) {
      musicInstance.fade(volumeLevel, 0, 500, () => {
        // Stop and unload previous music
        musicInstance.stop();

        // Load and fade in new music
        musicInstance = new Howl({
          src: [config.music],
          loop: true,
          volume: 0,
        });

        musicInstance.fade(0, volumeLevel, 500);
        musicInstance.play();
      });
    } else {
      // First time - load and play music
      musicInstance = new Howl({
        src: [config.music],
        loop: true,
        volume: volumeLevel,
      });
      musicInstance.play();
    }

    // Fade out current ambient if playing
    if (ambientInstance) {
      ambientInstance.fade(volumeLevel, 0, 500, () => {
        ambientInstance.stop();

        // Load and fade in new ambient
        ambientInstance = new Howl({
          src: [config.ambient],
          loop: true,
          volume: 0,
        });

        ambientInstance.fade(0, volumeLevel, 500);
        ambientInstance.play();
      });
    } else {
      // First time - load and play ambient
      ambientInstance = new Howl({
        src: [config.ambient],
        loop: true,
        volume: volumeLevel,
      });
      ambientInstance.play();
    }
  }

  /** Get the current period's ambient sound instance */
  public getAmbientInstance(): Howl | null {
    return ambientInstance;
  }

  /** Get the current period's music instance */
  public getMusicInstance(): Howl | null {
    return musicInstance;
  }

  /** Stop all audio and reset */
  public stopAll(): void {
    if (musicInstance) {
      musicInstance.stop();
      musicInstance.unload();
      musicInstance = null;
    }
    if (ambientInstance) {
      ambientInstance.stop();
      ambientInstance.unload();
      ambientInstance = null;
    }
    currentPeriod = '2025';
    volumeLevel = 0.7;
    Howler.volume(volumeLevel);
  }

  /** Integrate with TransformationEngine - call when visual era changes */
  public syncWithTransformationEngine(period: string, eraConfig: any): void {
    // Switch to the period-appropriate audio when transformation engine changes visual era
    this.switchPeriod(period);

    // Notify of audio sync for potential visual/audio effects coordination
    // This allows the TransformationEngine to coordinate building/vehicle updates
    // with the audio theme change
    const event = new CustomEvent('sfxPeriodChange', {
      detail: {
        period,
        eraConfig,
        music: this.getMusicInstance()?._sounds?.[0]?._src,
        ambient: this.getAmbientInstance()?._sounds?.[0]?._src,
      },
    });
    window.dispatchEvent(event);
  }
}