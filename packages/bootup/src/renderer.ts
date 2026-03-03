/**
 * Frame renderer — composites diamond + particles into a single
 * output string and writes it to stdout in one call.
 */

import { fgRgb } from './colors.js';
import { RESET_STYLE, CURSOR_HOME } from './constants.js';

/**
 * Compose char/color buffers into a single ANSI-colored string
 * and write to stdout in one call (prevents tearing).
 */
export function renderFrame(
  charBuffer: string[],
  colorBuffer: ([number, number, number] | null)[],
  width: number,
  height: number,
): void {
  const lines: string[] = [];

  for (let y = 0; y < height; y++) {
    let line = '';
    let lastColor: string | null = null;

    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const char = charBuffer[idx]!;
      const color = colorBuffer[idx];

      if (char === ' ' || !color) {
        if (lastColor !== null) {
          line += RESET_STYLE;
          lastColor = null;
        }
        line += ' ';
      } else {
        const colorCode = fgRgb(color[0], color[1], color[2]);
        if (colorCode !== lastColor) {
          line += colorCode;
          lastColor = colorCode;
        }
        line += char;
      }
    }

    if (lastColor !== null) {
      line += RESET_STYLE;
    }

    lines.push(line);
  }

  process.stdout.write(CURSOR_HOME + lines.join('\n'));
}

/**
 * Render a centered text block with optional ANSI coloring
 */
export function renderCenteredText(
  text: string,
  width: number,
  height: number,
  yOffset: number = 0,
): void {
  const textLines = text.split('\n');
  const startY = Math.floor(height / 2 - textLines.length / 2) + yOffset;

  const output: string[] = [];
  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i]!;
    // Strip ANSI for length calculation
    const visibleLength = line.replace(/\x1B\[[0-9;]*m/g, '').length;
    const padLeft = Math.max(0, Math.floor((width - visibleLength) / 2));
    output.push(`\x1B[${startY + i + 1};${padLeft + 1}H${line}`);
  }

  process.stdout.write(output.join(''));
}
