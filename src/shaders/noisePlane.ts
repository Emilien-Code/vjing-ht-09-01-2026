export const noisePlaneVertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const noisePlaneFragmentShader = /* glsl */`
uniform float uTime;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform int uNoiseOctaves;
uniform float uNoisePersistence;
uniform vec3 uColor;

varying vec2 vUv;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i),               hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= uNoiseOctaves) break;
        value += amplitude * noise(p * frequency);
        amplitude *= uNoisePersistence;
        frequency *= 2.0;
    }
    return value;
}

void main() {
    vec2 uv = vUv * uNoiseScale;
    uv += vec2(uTime * uNoiseSpeed, uTime * uNoiseSpeed * 0.7);
    float n = fbm(uv);
    vec3 color = mix(vec3(0.0), uColor, n);
    gl_FragColor = vec4(color, 1.0);
}
`
