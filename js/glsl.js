/* Shared GLSL chunks used by planet / cloud / atmosphere shaders. */

export const NOISE_GLSL = /* glsl */`
float ssHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float ssNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = ssHash(i);
  float n100 = ssHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = ssHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = ssHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = ssHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = ssHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = ssHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = ssHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}
float ssFbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    s += a * ssNoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return s;
}
float ssRidge(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  float w = 1.0;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(2.0 * ssNoise(p) - 1.0);
    n *= n * w;
    w = clamp(n * 2.0, 0.0, 1.0);
    s += n * a;
    p *= 2.13;
    a *= 0.5;
  }
  return s;
}
`;

/* Fullscreen-triangle vertex shader for post-processing passes. */
export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
