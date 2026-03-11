import { lerpColor } from './colors.js';

export interface OceanFrame {
  charBuffer: string[];
  colorBuffer: ([number, number, number] | null)[];
}

const SKY_TOP: [number, number, number] = [6, 18, 34];
const SKY_BOTTOM: [number, number, number] = [18, 56, 86];
const WATER_TOP: [number, number, number] = [22, 92, 148];
const WATER_BOTTOM: [number, number, number] = [7, 39, 82];
const FOAM: [number, number, number] = [198, 233, 255];
const DOLPHIN_BLUE: [number, number, number] = [68, 145, 222];
const DOLPHIN_MID: [number, number, number] = [93, 168, 238];
const DOLPHIN_LIGHT: [number, number, number] = [145, 204, 255];

const DOLPHIN_ART = [
  '                   YAao,',
  '                    Y8888b,',
  '                  ,oA8888888b,',
  '            ,aaad8888888888888888bo,',
  '         ,d888888888888888888888888888b,',
  '       ,888888888888888888888888888888888b,',
  '      d8888888888888888888888888888888888888,',
  '     d888888888888888888888888888888888888888b',
  '    d888888P\'                    `Y888888888888,',
  '    88888P\'                    Ybaaaa8888888888l',
  '   a8888\'                      `Y8888P\' `V888888',
  ' d8888888a                                `Y8888',
  'AY/\'\' `\\Y8b                                 ``Y8b',
  'Y\'      `YP                                    ~~',
  '         `\'',
] as const;

interface PoseSpec {
  lineXOffsets: number[];
  lineYOffsets: number[];
  fin: { dx: number; dy: number; char: string; color: [number, number, number] } | null;
}

const ASCENT_POSE: PoseSpec = {
  lineXOffsets: [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4],
  lineYOffsets: new Array(DOLPHIN_ART.length).fill(0),
  fin: { dx: 27, dy: 6, char: '^', color: DOLPHIN_LIGHT },
};

const PEAK_POSE: PoseSpec = {
  lineXOffsets: new Array(DOLPHIN_ART.length).fill(0),
  lineYOffsets: new Array(DOLPHIN_ART.length).fill(0),
  fin: { dx: 31, dy: 6, char: '^', color: DOLPHIN_LIGHT },
};

const DESCENT_POSE: PoseSpec = {
  lineXOffsets: [5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9],
  lineYOffsets: new Array(DOLPHIN_ART.length).fill(0),
  fin: { dx: 34, dy: 6, char: '^', color: DOLPHIN_LIGHT },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function writeChar(
  charBuffer: string[],
  colorBuffer: ([number, number, number] | null)[],
  width: number,
  height: number,
  x: number,
  y: number,
  char: string,
  color: [number, number, number],
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const idx = y * width + x;
  charBuffer[idx] = char;
  colorBuffer[idx] = color;
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolatePose(from: PoseSpec, to: PoseSpec, t: number): PoseSpec {
  const eased = clamp(t, 0, 1);
  return {
    lineXOffsets: from.lineXOffsets.map((value, idx) =>
      Math.round(lerpNumber(value, to.lineXOffsets[idx] ?? 0, eased))),
    lineYOffsets: from.lineYOffsets.map((value, idx) =>
      Math.round(lerpNumber(value, to.lineYOffsets[idx] ?? 0, eased))),
    fin: from.fin && to.fin
      ? {
          dx: Math.round(lerpNumber(from.fin.dx, to.fin.dx, eased)),
          dy: Math.round(lerpNumber(from.fin.dy, to.fin.dy, eased)),
          char: eased < 0.5 ? from.fin.char : to.fin.char,
          color: eased < 0.5 ? from.fin.color : to.fin.color,
        }
      : to.fin ?? from.fin,
  };
}

export function renderOceanScene(
  width: number,
  height: number,
  frameIndex: number,
  brightness: number,
): OceanFrame {
  const size = width * height;
  const charBuffer = new Array<string>(size).fill(' ');
  const colorBuffer = new Array<[number, number, number] | null>(size).fill(null);

  const horizon = Math.max(4, Math.floor(height * 0.56));
  const waveBase = horizon + 1;
  const waterline = new Int16Array(width);

  for (let y = 0; y < height; y++) {
    const isWater = y >= horizon;
    const t = isWater
      ? clamp((y - horizon) / Math.max(1, height - horizon - 1), 0, 1)
      : clamp(y / Math.max(1, horizon - 1), 0, 1);
    const baseColor = isWater
      ? lerpColor(WATER_TOP, WATER_BOTTOM, t)
      : lerpColor(SKY_TOP, SKY_BOTTOM, t);
    const shadedColor = [
      Math.round(baseColor[0] * brightness),
      Math.round(baseColor[1] * brightness),
      Math.round(baseColor[2] * brightness),
    ] as [number, number, number];

    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      charBuffer[idx] = ' ';
      colorBuffer[idx] = shadedColor;
    }
  }

  for (let x = 0; x < width; x++) {
    const waveHeight = Math.sin((x + frameIndex * 1.8) * 0.18) * 1.1
      + Math.sin((x + frameIndex * 0.9) * 0.09) * 0.8;
    const crestY = clamp(Math.round(waveBase + waveHeight), horizon, height - 2);
    waterline[x] = crestY;
    writeChar(charBuffer, colorBuffer, width, height, x, crestY, '≈', FOAM);
    if ((x + frameIndex) % 7 === 0) {
      writeChar(charBuffer, colorBuffer, width, height, x, clamp(crestY + 1, horizon, height - 1), '∿', FOAM);
    }
  }

  const cycle = 96;
  const progress = (frameIndex % cycle) / cycle;
  const phase = selectPhase(progress);
  const pose = phase.pose;
  const dolphinWidth = Math.max(...DOLPHIN_ART.map(line => line.length));
  const dolphinHeight = DOLPHIN_ART.length;
  const travelWidth = Math.max(1, width - dolphinWidth - 8);
  const dolphinX = 4 + Math.round(progress * travelWidth);
  if (phase.mode === 'submerged') {
    const finX = clamp(dolphinX + Math.floor(dolphinWidth * phase.finBias), 1, width - 2);
    const finY = clamp((waterline[finX] ?? waveBase) - 1, horizon - 1, height - 3);
    writeChar(charBuffer, colorBuffer, width, height, finX, finY, '^', DOLPHIN_LIGHT);
    writeChar(charBuffer, colorBuffer, width, height, finX + 1, finY + 1, '\\', DOLPHIN_MID);
    if (phase.splash) {
      drawSplash(
        charBuffer,
        colorBuffer,
        width,
        height,
        finX,
        clamp((waterline[finX] ?? waveBase), horizon, height - 2),
        phase.splash,
      );
    }
    return { charBuffer, colorBuffer };
  }

  const dolphinBaseY = clamp(
    Math.round(phase.baseY(waveBase, dolphinHeight)),
    1,
    Math.max(1, height - dolphinHeight - 1),
  );

  DOLPHIN_ART.forEach((line, rowOffset) => {
    if (rowOffset >= phase.visibleRows) return;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === ' ') continue;
      const drawX = dolphinX + i + (pose.lineXOffsets[rowOffset] ?? 0);
      const drawY = dolphinBaseY + rowOffset + (pose.lineYOffsets[rowOffset] ?? 0);
      if (drawX < 0 || drawX >= width || drawY < 0 || drawY >= height) continue;
      const clipY = waterline[drawX] ?? waveBase;
      if (drawY >= clipY) continue;
      const color = rowOffset <= 4
        ? DOLPHIN_LIGHT
        : rowOffset <= 9
          ? DOLPHIN_MID
          : DOLPHIN_BLUE;
      writeChar(charBuffer, colorBuffer, width, height, drawX, drawY, ch, color);
    }
  });

  if (pose.fin) {
    const drawX = dolphinX + pose.fin.dx;
    const drawY = dolphinBaseY + pose.fin.dy;
    if (drawX >= 0 && drawX < width && drawY >= 0 && drawY < height) {
      const clipY = waterline[drawX] ?? waveBase;
      if (drawY < clipY) {
        writeChar(charBuffer, colorBuffer, width, height, drawX, drawY, pose.fin.char, pose.fin.color);
      }
    }
  }

  if (phase.splash) {
    const splashX = clamp(dolphinX + Math.floor(dolphinWidth * phase.splashBias), 2, width - 3);
    const splashY = clamp((waterline[splashX] ?? waveBase), horizon, height - 2);
    drawSplash(charBuffer, colorBuffer, width, height, splashX, splashY, phase.splash);
  }

  return { charBuffer, colorBuffer };
}

function selectPhase(progress: number): {
  mode: 'submerged' | 'visible';
  pose: PoseSpec;
  baseY: (waveBase: number, dolphinHeight: number) => number;
  splash: 0 | 1 | 2;
  splashBias: number;
  finBias: number;
  visibleRows: number;
} {
  if (progress < 0.12) {
    return {
      mode: 'submerged',
      pose: ASCENT_POSE,
      baseY: () => 0,
      splash: 0,
      splashBias: 0.18,
      finBias: 0.18,
      visibleRows: 0,
    };
  }
  if (progress < 0.3) {
    const t = (progress - 0.12) / 0.18;
    return {
      mode: 'visible',
      pose: interpolatePose(ASCENT_POSE, ASCENT_POSE, t),
      baseY: (waveBase) => waveBase - 1 - t * 5,
      splash: 1,
      splashBias: 0.16,
      finBias: 0.16,
      visibleRows: Math.min(DOLPHIN_ART.length, 3 + Math.floor(t * 7)),
    };
  }
  if (progress < 0.5) {
    const t = (progress - 0.3) / 0.2;
    return {
      mode: 'visible',
      pose: interpolatePose(ASCENT_POSE, PEAK_POSE, t),
      baseY: (waveBase, dolphinHeight) => waveBase - 6 - t * (dolphinHeight * 0.4),
      splash: 0,
      splashBias: 0.16,
      finBias: 0.24,
      visibleRows: Math.min(DOLPHIN_ART.length, 10 + Math.floor(t * 5)),
    };
  }
  if (progress < 0.62) {
    return {
      mode: 'visible',
      pose: PEAK_POSE,
      baseY: (waveBase, dolphinHeight) => waveBase - dolphinHeight + 2,
      splash: 0,
      splashBias: 0.5,
      finBias: 0.5,
      visibleRows: DOLPHIN_ART.length,
    };
  }
  if (progress < 0.82) {
    const t = (progress - 0.62) / 0.2;
    return {
      mode: 'visible',
      pose: interpolatePose(PEAK_POSE, DESCENT_POSE, t),
      baseY: (waveBase, dolphinHeight) => waveBase - dolphinHeight + 2 + t * (dolphinHeight * 0.3),
      splash: 0,
      splashBias: 0.74,
      finBias: 0.72,
      visibleRows: DOLPHIN_ART.length,
    };
  }
  if (progress < 0.9) {
    const t = (progress - 0.82) / 0.08;
    return {
      mode: 'visible',
      pose: DESCENT_POSE,
      baseY: (waveBase, dolphinHeight) => waveBase - dolphinHeight * 0.72 + t * (dolphinHeight * 0.72),
      splash: 2,
      splashBias: 0.76,
      finBias: 0.78,
      visibleRows: DOLPHIN_ART.length,
    };
  }
  return {
    mode: 'submerged',
    pose: DESCENT_POSE,
    baseY: () => 0,
    splash: 1,
    splashBias: 0.78,
    finBias: 0.74,
    visibleRows: 0,
  };
}

function drawSplash(
  charBuffer: string[],
  colorBuffer: ([number, number, number] | null)[],
  width: number,
  height: number,
  centerX: number,
  baseY: number,
  intensity: number,
): void {
  const points: Array<[number, number, string]> = intensity === 2
    ? [
        [-3, 0, '~'], [-2, -1, '✦'], [-1, -2, '·'], [0, -3, '*'], [1, -2, '·'], [2, -1, '✦'], [3, 0, '~'],
        [-2, 1, '∿'], [2, 1, '∿'],
      ]
    : [
        [-2, 0, '~'], [-1, -1, '·'], [0, -2, '*'], [1, -1, '·'], [2, 0, '~'],
      ];
  for (const [dx, dy, ch] of points) {
    writeChar(charBuffer, colorBuffer, width, height, centerX + dx, baseY + dy, ch, FOAM);
  }
}
