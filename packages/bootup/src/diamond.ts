/**
 * 3D spinning diamond (octahedron) renderer
 *
 * Uses the donut.c approach:
 * 1. Parametric surface → sample points on octahedron faces
 * 2. Rotation matrices → spin on two axes
 * 3. Perspective projection → 3D to 2D
 * 4. Z-buffer → depth ordering
 * 5. Luminance-based character shading with HSL color cycling
 */

import { hslToRgb } from './colors.js';
import {
  SHADE_CHARS,
  DIAMOND_RADIUS,
  DIAMOND_STEP,
  K2,
  DIAMOND_HUE_START,
  DIAMOND_HUE_END,
} from './constants.js';

// Pre-computed sin/cos tables (360 entries)
const SIN_TABLE = new Float64Array(3600);
const COS_TABLE = new Float64Array(3600);
for (let i = 0; i < 3600; i++) {
  const rad = (i / 10) * (Math.PI / 180);
  SIN_TABLE[i] = Math.sin(rad);
  COS_TABLE[i] = Math.cos(rad);
}

function fastSin(angleDeg: number): number {
  const idx = Math.round(((angleDeg % 360 + 360) % 360) * 10) % 3600;
  return SIN_TABLE[idx]!;
}

function fastCos(angleDeg: number): number {
  const idx = Math.round(((angleDeg % 360 + 360) % 360) * 10) % 3600;
  return COS_TABLE[idx]!;
}

// Light direction (normalized) — top-right-front
const LIGHT_X = 0;
const LIGHT_Y = -0.7071;
const LIGHT_Z = 0.7071;

export interface DiamondFrame {
  charBuffer: string[];
  colorBuffer: ([number, number, number] | null)[];
}

/**
 * Render a single frame of the spinning diamond.
 *
 * @param width - terminal columns
 * @param height - terminal rows
 * @param angleA - x-axis rotation angle (degrees)
 * @param angleB - z-axis rotation angle (degrees)
 * @param frameIndex - for color cycling
 * @param brightness - 0..1 for fade effects
 */
export function renderDiamond(
  width: number,
  height: number,
  angleA: number,
  angleB: number,
  frameIndex: number,
  brightness: number = 1.0,
): DiamondFrame {
  const size = width * height;
  const charBuffer = new Array<string>(size).fill(' ');
  const colorBuffer = new Array<[number, number, number] | null>(size).fill(null);
  const zBuffer = new Float64Array(size); // initialized to 0

  const sinA = fastSin(angleA);
  const cosA = fastCos(angleA);
  const sinB = fastSin(angleB);
  const cosB = fastCos(angleB);

  // K1 scales the projection to fit the terminal
  const K1 = Math.min(width, height * 2) * 0.35;

  const R = DIAMOND_RADIUS;
  const step = DIAMOND_STEP;

  // Sample points on octahedron: |x| + |y| + |z| = R
  // Parametrize each octant using two free parameters
  for (let u = 0; u < 1; u += step) {
    for (let v = 0; v < 1 - u; v += step) {
      const w = 1 - u - v;

      // Generate all 8 octants by sign combinations
      for (let sx = -1; sx <= 1; sx += 2) {
        for (let sy = -1; sy <= 1; sy += 2) {
          for (let sz = -1; sz <= 1; sz += 2) {
            const x = sx * u * R;
            const y = sy * v * R;
            const z = sz * w * R;

            // Surface normal for this face of the octahedron
            const nx = sx;
            const ny = sy;
            const nz = sz;
            const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);

            // Apply rotation: first around z-axis (B), then x-axis (A)
            const x1 = x * cosB - y * sinB;
            const y1 = x * sinB * cosA + y * cosB * cosA - z * sinA;
            const z1 = x * sinB * sinA + y * cosB * sinA + z * cosA;

            // Rotate normal too
            const nx1 = nx / nLen * cosB - ny / nLen * sinB;
            const ny1 = nx / nLen * sinB * cosA + ny / nLen * cosB * cosA - nz / nLen * sinA;
            const nz1 = nx / nLen * sinB * sinA + ny / nLen * cosB * sinA + nz / nLen * cosA;

            // Perspective projection
            const ooz = 1 / (K2 + z1); // one over z
            const xp = Math.round(width / 2 + K1 * x1 * ooz);
            // Terminal chars are ~2x taller than wide, so scale y by 0.5
            const yp = Math.round(height / 2 + K1 * y1 * ooz * 0.5);

            if (xp < 0 || xp >= width || yp < 0 || yp >= height) continue;

            const idx = yp * width + xp;

            // Z-buffer check
            if (ooz > zBuffer[idx]!) {
              zBuffer[idx] = ooz;

              // Compute luminance from surface normal dot light direction
              const luminance = nx1 * LIGHT_X + ny1 * LIGHT_Y + nz1 * LIGHT_Z;
              const lumIdx = Math.max(0, Math.min(
                SHADE_CHARS.length - 1,
                Math.round((luminance + 1) / 2 * (SHADE_CHARS.length - 1)),
              ));

              // Only draw if luminance produces a visible character
              if (lumIdx > 0) {
                charBuffer[idx] = SHADE_CHARS[lumIdx]!;

                // Color: cycle hue based on frame + surface position
                const surfaceAngle = Math.atan2(y1, x1) * (180 / Math.PI);
                const hue = DIAMOND_HUE_START +
                  (DIAMOND_HUE_END - DIAMOND_HUE_START) *
                    ((surfaceAngle + 180 + frameIndex * 3) % 360) / 360;

                const saturation = 0.85;
                const lightness = 0.35 + luminance * 0.25;

                const rgb = hslToRgb(hue, saturation, lightness * brightness);
                colorBuffer[idx] = rgb;
              }
            }
          }
        }
      }
    }
  }

  return { charBuffer, colorBuffer };
}
