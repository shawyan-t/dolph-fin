/**
 * Title reveal — figlet banner with gradient + typewriter effect
 */

import figlet from 'figlet';
import gradient from 'gradient-string';
import { CLEAR_SCREEN, CURSOR_HOME, RESET_STYLE } from './constants.js';
import { renderCenteredText } from './renderer.js';
import { hslToRgb, fgRgb } from './colors.js';

const TITLE_GRADIENT = gradient(['#00ffff', '#ff00ff', '#ffd700']);
const SUBTITLE_TEXT = 'AI-powered SEC filing analysis';
const VERSION_TEXT = 'v0.1.0';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Render the title reveal sequence
 */
export async function renderTitleReveal(
  width: number,
  height: number,
): Promise<void> {
  // Clear screen
  process.stdout.write(CLEAR_SCREEN + CURSOR_HOME);

  // Generate figlet banner
  const bannerText = figlet.textSync('Dolph', {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
  });

  // Apply gradient to the banner
  const gradientBanner = TITLE_GRADIENT.multiline(bannerText);
  const bannerLines = gradientBanner.split('\n');

  // Typewriter reveal: line by line with a delay
  const startY = Math.floor(height / 2 - bannerLines.length / 2) - 2;

  for (let i = 0; i < bannerLines.length; i++) {
    const line = bannerLines[i]!;
    const visibleLength = line.replace(/\x1B\[[0-9;]*m/g, '').length;
    const padLeft = Math.max(0, Math.floor((width - visibleLength) / 2));
    process.stdout.write(`\x1B[${startY + i + 1};${padLeft + 1}H${line}`);
    await sleep(40);
  }

  await sleep(200);

  // Subtitle fade-in (dim → bright over several steps)
  const subtitleY = startY + bannerLines.length + 2;
  const padSub = Math.max(0, Math.floor((width - SUBTITLE_TEXT.length) / 2));

  for (let step = 0; step < 8; step++) {
    const brightness = (step + 1) / 8;
    const rgb = hslToRgb(200, 0.5, brightness * 0.5);
    const colored = `${fgRgb(rgb[0], rgb[1], rgb[2])}${SUBTITLE_TEXT}${RESET_STYLE}`;
    process.stdout.write(`\x1B[${subtitleY};${padSub + 1}H${colored}`);
    await sleep(50);
  }

  // Version text
  await sleep(150);
  const versionY = subtitleY + 2;
  const padVersion = Math.max(0, Math.floor((width - VERSION_TEXT.length) / 2));
  const dimRgb = hslToRgb(200, 0.3, 0.3);
  process.stdout.write(
    `\x1B[${versionY};${padVersion + 1}H${fgRgb(dimRgb[0], dimRgb[1], dimRgb[2])}${VERSION_TEXT}${RESET_STYLE}`,
  );

  // Decorative line
  await sleep(100);
  const lineY = subtitleY + 4;
  const lineWidth = Math.min(60, width - 10);
  const padLine = Math.max(0, Math.floor((width - lineWidth) / 2));

  let decorLine = '';
  for (let i = 0; i < lineWidth; i++) {
    const t = i / lineWidth;
    const hue = 180 + t * 140; // cyan → gold
    const rgb = hslToRgb(hue, 0.7, 0.4);
    decorLine += `${fgRgb(rgb[0], rgb[1], rgb[2])}─`;
  }
  decorLine += RESET_STYLE;
  process.stdout.write(`\x1B[${lineY};${padLine + 1}H${decorLine}`);

  await sleep(500);
}
