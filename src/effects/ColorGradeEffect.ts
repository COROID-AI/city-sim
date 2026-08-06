import { Effect, BlendFunction } from 'postprocessing';
import { Uniform } from 'three';

/**
 * Fragment shader implementing a compact color-grade: brightness, contrast,
 * saturation and white-balance temperature. Runs with a NORMAL blend so it
 * replaces the input color in-place.
 */
const FRAGMENT_SHADER = /* glsl */ `
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uTemperature;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 color = inputColor.rgb;

    // Brightness (multiplicative gain).
    color *= uBrightness;

    // Contrast around mid-gray.
    color = (color - 0.5) * uContrast + 0.5;

    // Saturation toward luminance.
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, uSaturation);

    // White-balance temperature: positive = warm (orange), negative = cool (blue).
    color.r += uTemperature * 0.12;
    color.b -= uTemperature * 0.12;

    outputColor = vec4(color, inputColor.a);
  }
`;

/** Constructor options for {@link ColorGradeEffect}. */
export interface ColorGradeEffectOptions {
  blendFunction?: BlendFunction;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
}

/**
 * Custom per-era color-grade effect.
 *
 * Exposes `brightness`, `contrast`, `saturation` and `temperature` as settable
 * properties so the React wrapper (and @react-three/fiber) can drive them
 * per-frame during era transitions.
 */
export class ColorGradeEffect extends Effect {
  constructor({
    blendFunction = BlendFunction.NORMAL,
    brightness = 1,
    contrast = 1,
    saturation = 1,
    temperature = 0,
  }: ColorGradeEffectOptions = {}) {
    super('ColorGradeEffect', FRAGMENT_SHADER, {
      blendFunction,
      uniforms: new Map([
        ['uBrightness', new Uniform(brightness)],
        ['uContrast', new Uniform(contrast)],
        ['uSaturation', new Uniform(saturation)],
        ['uTemperature', new Uniform(temperature)],
      ]),
    });
  }

  get brightness(): number {
    return this.uniforms.get('uBrightness')!.value as number;
  }

  set brightness(value: number) {
    this.uniforms.get('uBrightness')!.value = value;
  }

  get contrast(): number {
    return this.uniforms.get('uContrast')!.value as number;
  }

  set contrast(value: number) {
    this.uniforms.get('uContrast')!.value = value;
  }

  get saturation(): number {
    return this.uniforms.get('uSaturation')!.value as number;
  }

  set saturation(value: number) {
    this.uniforms.get('uSaturation')!.value = value;
  }

  get temperature(): number {
    return this.uniforms.get('uTemperature')!.value as number;
  }

  set temperature(value: number) {
    this.uniforms.get('uTemperature')!.value = value;
  }
}
