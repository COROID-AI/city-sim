// Audio Manager for era-specific ambient sounds
// Uses Web Audio API to load and play short loops with cross-fading

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private nextSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;
  private nextGain: GainNode | null = null;
  private readonly sounds: string[] = [
    'public/sounds/1940s.wav', // Post-war era (1945)
    'public/sounds/1960s.wav', // Space Age era (1965)
    'public/sounds/1980s.wav', // Digital Dawn era (1985)
    'public/sounds/2000s.wav', // Information Age era (2005)
    'public/sounds/2020s.wav', // Future era (2025)
  ];
  private audioBuffers: AudioBuffer[] = [];
  private readonly transitionTime = 0.5; // seconds, matches overlay transition
  public isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Load all audio buffers
      for (const soundUrl of this.sounds) {
        try {
          const response = await fetch(soundUrl);
          if (!response.ok) {
            console.warn(`Failed to load audio file: ${soundUrl}, status: ${response.status}`);
            // Create a silent buffer as fallback
            this.audioBuffers.push(this.createSilentBuffer());
            continue;
          }
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
          this.audioBuffers.push(audioBuffer);
        } catch (error) {
          console.error(`Error loading audio file ${soundUrl}:`, error);
          // Create a silent buffer as fallback
          this.audioBuffers.push(this.createSilentBuffer());
        }
      }

      this.isInitialized = true;
      console.log('AudioManager initialized');
    } catch (error) {
      console.error('Failed to initialize AudioManager:', error);
      throw error;
    }
  }

  private createSilentBuffer(): AudioBuffer {
    if (!this.audioContext) throw new Error('AudioContext not initialized');
    const sampleRate = this.audioContext.sampleRate;
    const duration = 0.1; // 0.1 seconds of silence
    const length = sampleRate * duration;
    const buffer = this.audioContext.createBuffer(1, length, sampleRate);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      channelData[i] = 0.0; // Silence
    }
    return buffer;
  }

  /**
   * Play ambient sound for the given era index
   * @param eraIndex Index of the era (0-4)
   */
  async playEraSound(eraIndex: number): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.audioContext) {
      console.error('AudioContext not available');
      return;
    }

    if (eraIndex < 0 || eraIndex >= this.audioBuffers.length) {
      console.error(`Invalid era index: ${eraIndex}`);
      return;
    }

    const buffer = this.audioBuffers[eraIndex];

    // Stop any currently playing sounds
    this.stopCurrentSound();
    this.stopNextSound();

    // Create source and gain node for the new sound
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0; // Start silent for fade-in

    // Connect source -> gain -> destination
    source.connect(gainNode).connect(this.audioContext.destination);

    // Store as next sound (will be faded in)
    this.nextSource = source;
    this.nextGain = gainNode;

    // Start the source immediately (but gain is 0)
    source.start(0);

    // Fade out current sound (if any) and fade in next sound
    this.crossfade(this.transitionTime);
  }

  private crossfade(duration: number): void {
    const now = this.audioContext!.currentTime;

    // Fade out current sound
    if (this.currentGain) {
      this.currentGain.gain.cancelScheduledValues(now);
      this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, now);
      this.currentGain.gain.exponentialRampToValueAtTime(0.001, now + duration); // fade to near silence
    }

    // Fade in next sound
    if (this.nextGain) {
      this.nextGain.gain.cancelScheduledValues(now);
      this.nextGain.gain.setValueAtTime(0.001, now); // start from near silence
      this.nextGain.gain.exponentialRampToValueAtTime(1.0, now + duration); // fade to full volume
    }

    // After crossfade, swap: next becomes current, clear next
    setTimeout(() => {
      this.currentSource = this.nextSource;
      this.currentGain = this.nextGain;
      this.nextSource = null;
      this.nextGain = null;
    }, duration * 1000);
  }

  private stopCurrentSound(): void {
    if (this.currentSource) {
      this.currentSource.stop();
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    if (this.currentGain) {
      this.currentGain.disconnect();
      this.currentGain = null;
    }
  }

  private stopNextSound(): void {
    if (this.nextSource) {
      this.nextSource.stop();
      this.nextSource.disconnect();
      this.nextSource = null;
    }
    if (this.nextGain) {
      this.nextGain.disconnect();
      this.nextGain = null;
    }
  }

  /**
   * Stop all sounds and release resources
   */
  async dispose(): Promise<void> {
    this.stopCurrentSound();
    this.stopNextSound();
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    this.isInitialized = false;
    this.audioBuffers = [];
  }
}

// Global audio manager instance
export const audioManager = new AudioManager();