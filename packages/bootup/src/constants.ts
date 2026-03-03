// Character sets for diamond luminance shading (dark → bright)
export const SHADE_CHARS = ' .·:-=+*#%@';

// Particle characters
export const PARTICLE_CHARS = ['.', '*', '✦', '✧', '·', '⋆', '+', '∗', '°'];

// Color palette for particles (RGB tuples)
export const PARTICLE_COLORS: [number, number, number][] = [
  [0, 255, 255],     // cyan
  [255, 0, 255],     // magenta
  [255, 215, 0],     // gold
  [200, 200, 255],   // lavender
  [255, 255, 255],   // white
  [0, 200, 255],     // light blue
  [255, 100, 200],   // pink
];

// Diamond gradient base hues (degrees)
export const DIAMOND_HUE_START = 180;   // cyan
export const DIAMOND_HUE_END = 320;     // magenta/pink

// Timing
export const FPS = 30;
export const FRAME_MS = Math.round(1000 / FPS);
export const ANIMATION_DURATION_MS = 4000;
export const FADE_DURATION_MS = 600;
export const TITLE_REVEAL_MS = 1500;
export const TOTAL_DURATION_MS = ANIMATION_DURATION_MS + FADE_DURATION_MS + TITLE_REVEAL_MS;

// Diamond geometry
export const DIAMOND_RADIUS = 1.5;
export const DIAMOND_STEP = 0.07;         // surface sampling density
export const ROTATION_SPEED_A = 0.04;     // x-axis rotation per frame
export const ROTATION_SPEED_B = 0.02;     // z-axis rotation per frame

// Projection
export const K2 = 5;                      // camera distance

// Particles
export const MAX_PARTICLES = 50;
export const PARTICLE_SPAWN_RATE = 3;     // new particles per frame
export const PARTICLE_MIN_LIFE = 20;
export const PARTICLE_MAX_LIFE = 60;
export const PARTICLE_ORBIT_RADIUS_MIN = 6;
export const PARTICLE_ORBIT_RADIUS_MAX = 16;

// ANSI escape codes
export const ESC = '\x1B';
export const HIDE_CURSOR = `${ESC}[?25l`;
export const SHOW_CURSOR = `${ESC}[?25h`;
export const CURSOR_HOME = `${ESC}[H`;
export const CLEAR_SCREEN = `${ESC}[2J`;
export const RESET_STYLE = `${ESC}[0m`;
