import { Effect } from '@react-three/postprocessing';
import { Uniform } from 'three';

/**
 * Color-temperature grade.
 *
 * Shifts the image toward warm (positive) or cool (negative) tones so each era
 * can carry a temporally plausible temperature without anachronistic hues.
 * The constructor accepts an options object so it can be driven through the
 * @react-three/postprocessing `wrapEffect` helper.
 */
const fragmentShader = /* glsl */ `
  uniform float temperature;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 color = inputColor.rgb;
    color.r += temperature * 0.18;
    color.g += temperature * 0.06;
    color.b -= temperature * 0.18;
    outputColor = vec4(color, inputColor.a);
  }
`;

export interface TemperatureEffectOptions {
  /** Normalized temperature offset: -1 cool .. +1 warm. */
  temperature?: number;
}

export class TemperatureEffect extends Effect {
  private readonly temperatureUniform: Uniform;

  constructor({ temperature = 0 }: TemperatureEffectOptions = {}) {
    super('TemperatureEffect', fragmentShader, {
      uniforms: new Map([['temperature', new Uniform(temperature)]]),
    });
    this.temperatureUniform = this.uniforms.get('temperature') as Uniform;
  }

  get temperature(): number {
    return this.temperatureUniform.value as number;
  }

  set temperature(value: number) {
    this.temperatureUniform.value = value;
  }
}
