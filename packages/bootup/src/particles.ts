/**
 * Floating star particle system
 *
 * Particles spawn in a ring around the diamond, orbit with slight drift,
 * and fade out over their lifetime.
 */

import {
  PARTICLE_CHARS,
  PARTICLE_COLORS,
  MAX_PARTICLES,
  PARTICLE_SPAWN_RATE,
  PARTICLE_MIN_LIFE,
  PARTICLE_MAX_LIFE,
  PARTICLE_ORBIT_RADIUS_MIN,
  PARTICLE_ORBIT_RADIUS_MAX,
} from './constants.js';
import { dimColor } from './colors.js';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  char: string;
  life: number;
  maxLife: number;
  color: [number, number, number];
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Create a new particle at a random angle around center
 */
function spawnParticle(cx: number, cy: number): Particle {
  const angle = Math.random() * Math.PI * 2;
  const radius = randomRange(PARTICLE_ORBIT_RADIUS_MIN, PARTICLE_ORBIT_RADIUS_MAX);

  const x = cx + Math.cos(angle) * radius;
  const y = cy + Math.sin(angle) * radius * 0.5; // terminal aspect ratio

  // Orbital velocity (tangent to spawn angle) + drift
  const speed = randomRange(0.08, 0.25);
  const drift = randomRange(-0.03, 0.03);
  const vx = -Math.sin(angle) * speed + drift;
  const vy = Math.cos(angle) * speed * 0.5 + drift;

  return {
    x,
    y,
    vx,
    vy,
    char: randomChoice(PARTICLE_CHARS),
    life: Math.round(randomRange(PARTICLE_MIN_LIFE, PARTICLE_MAX_LIFE)),
    maxLife: 0, // set below
    color: randomChoice(PARTICLE_COLORS),
  };
}

export class ParticleSystem {
  particles: Particle[] = [];

  /**
   * Update all particles and spawn new ones
   */
  update(cx: number, cy: number, spawnRate: number = PARTICLE_SPAWN_RATE): void {
    // Update existing particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Spawn new particles
    const toSpawn = Math.min(spawnRate, MAX_PARTICLES - this.particles.length);
    for (let i = 0; i < toSpawn; i++) {
      const p = spawnParticle(cx, cy);
      p.maxLife = p.life;
      this.particles.push(p);
    }
  }

  /**
   * Write particles into char/color buffers
   */
  render(
    charBuffer: string[],
    colorBuffer: ([number, number, number] | null)[],
    width: number,
    height: number,
    globalBrightness: number = 1.0,
  ): void {
    for (const p of this.particles) {
      const xi = Math.round(p.x);
      const yi = Math.round(p.y);

      if (xi < 0 || xi >= width || yi < 0 || yi >= height) continue;

      const idx = yi * width + xi;

      // Don't overwrite diamond characters
      if (charBuffer[idx] !== ' ') continue;

      // Fade based on remaining life
      const lifeFraction = p.life / p.maxLife;
      const fadeFactor = lifeFraction * globalBrightness;

      // Twinkle effect: randomly skip some particles for sparkle
      if (Math.random() > 0.85 && lifeFraction < 0.5) continue;

      charBuffer[idx] = p.char;
      colorBuffer[idx] = dimColor(p.color, fadeFactor);
    }
  }
}
