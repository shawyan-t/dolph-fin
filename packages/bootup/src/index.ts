#!/usr/bin/env node

/**
 * FilingLens Terminal Bootup Animation
 *
 * A ~5 second splash screen featuring:
 * 1. 3D spinning diamond (octahedron) with gradient colors
 * 2. Orbiting star particles with twinkle effects
 * 3. Fade transition
 * 4. Figlet title reveal with typewriter effect
 */

import { renderDiamond } from './diamond.js';
import { ParticleSystem } from './particles.js';
import { renderFrame } from './renderer.js';
import { renderTitleReveal } from './title.js';
import {
  HIDE_CURSOR,
  SHOW_CURSOR,
  CLEAR_SCREEN,
  CURSOR_HOME,
  RESET_STYLE,
  FRAME_MS,
  ROTATION_SPEED_A,
  ROTATION_SPEED_B,
  ANIMATION_DURATION_MS,
  FADE_DURATION_MS,
} from './constants.js';

function cleanup(): void {
  process.stdout.write(SHOW_CURSOR + RESET_STYLE);
}

export async function runBootup(): Promise<void> {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;

  // Setup
  process.stdout.write(HIDE_CURSOR + CLEAR_SCREEN);

  // Handle cleanup on exit
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  const particles = new ParticleSystem();
  let angleA = 0;
  let angleB = 0;
  let frameIndex = 0;
  const startTime = Date.now();

  // Phase 1: Spinning diamond + particles
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      // Calculate fade for transition phase
      let brightness = 1.0;
      let spawnRate = 3;

      if (elapsed > ANIMATION_DURATION_MS) {
        // Fade-out phase
        const fadeProgress = (elapsed - ANIMATION_DURATION_MS) / FADE_DURATION_MS;
        brightness = Math.max(0, 1 - fadeProgress);
        spawnRate = 0;

        if (fadeProgress >= 1) {
          clearInterval(interval);
          resolve();
          return;
        }
      }

      // Render diamond
      const { charBuffer, colorBuffer } = renderDiamond(
        width,
        height,
        angleA,
        angleB,
        frameIndex,
        brightness,
      );

      // Update and render particles
      particles.update(Math.floor(width / 2), Math.floor(height / 2), spawnRate);
      particles.render(charBuffer, colorBuffer, width, height, brightness);

      // Output frame
      renderFrame(charBuffer, colorBuffer, width, height);

      // Advance animation state
      angleA += ROTATION_SPEED_A * (180 / Math.PI);
      angleB += ROTATION_SPEED_B * (180 / Math.PI);
      frameIndex++;
    }, FRAME_MS);
  });

  // Phase 2: Title reveal
  await renderTitleReveal(width, height);

  // Final pause then cleanup
  await new Promise(resolve => setTimeout(resolve, 300));
  process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);
  cleanup();
}

// Run if executed directly
runBootup().catch((err) => {
  cleanup();
  console.error('Bootup animation failed:', err);
  process.exit(1);
});
