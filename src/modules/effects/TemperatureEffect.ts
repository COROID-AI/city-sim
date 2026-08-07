import { Effect, BlendFunction } from 'postprocessing';
import { Uniform } from 'three';
import { wrapEffect } from '@react-three/postprocessing';

/**
 * Custom color-temperature grading pass.
 *
 * `temperature` is centered on 1 (neutral). Values below 1 cool the frame
 * (boost blue, dip red) and values above 1 warm it (boost red, dip blue)
 * to produce the sepia-ish cast used for the 1945 era.
 */
const fragmentShader = /* glsl */ `
  uniform float temperature;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 color = inputColor.rgb;
    float t = clamp(temperature, 0.0, 2.0);

    vec3 warm = vec3(1.06, 1.02, 0.90);
    vec3 cool = vec3(0.92, 0.98, 1.06);

    float f = clamp(abs(t - 1.0), 0.0, 1.0);
    vec3 target = t >= 1.0 ? warm : cool;
    vec3 tint = mix(vec3(1.0), target, f);

    outputColor = vec4(color * tint, inputColor.a);
  }
`;

export interface TemperatureOptions {
  /** Color temperature centered on 1 (neutral). */
  temperature?: number;
}

/** The postprocessing effect that performs the temperature grade. */
export class TemperatureEffect extends Effect {
  constructor({ temperature = 1 }: TemperatureOptions = {}) {
    super('TemperatureEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['temperature', new Uniform(temperature)]]),
    });
  }

  set temperature(value: number) {
    this.uniforms.get('temperature')!.value = value;
  }
}

/** React component wrapper for {@link TemperatureEffect}. */
export const Temperature = wrapEffect(TemperatureEffect);
