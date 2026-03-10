/**
 * Reusable PDF presentation theme tokens.
 * This is the single source of truth for colors, typography, spacing, and page geometry.
 */

export const PDF_THEME = {
  colors: {
    accentInk: '#1F3347',
    accentSoft: '#EEF3F8',
    page: '#FFFFFF',
    panel: '#FCFDFE',
    panelAlt: '#F7F9FB',
    border: '#D6DDE5',
    borderStrong: '#B8C4D0',
    rule: '#E4EAF0',
    primaryText: '#14181D',
    secondaryText: '#4A5663',
    mutedText: '#6E7985',
    positive: '#2E5D50',
    caution: '#8B6438',
    negative: '#7C3840',
  },
  fonts: {
    title: "'Times New Roman', Times, serif",
    body: "'Times New Roman', Times, serif",
    numeric: "'Times New Roman', Times, serif",
  },
  page: {
    size: 'Letter',
    margin: {
      top: '0.7in',
      right: '0.7in',
      bottom: '0.65in',
      left: '0.7in',
    },
  },
  spacing: {
    xs: 8,
    sm: 16,
    md: 24,
    lg: 32,
    xl: 40,
    xxl: 48,
  },
} as const;

export type PdfTheme = typeof PDF_THEME;
