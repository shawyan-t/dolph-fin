/**
 * Reusable PDF presentation theme tokens.
 * This is the single source of truth for colors, typography, spacing, and page geometry.
 */

export const PDF_THEME = {
  colors: {
    inkWalnut: '#1E1A17',
    smokedOak: '#2A241F',
    burntUmber: '#4B3A2E',
    parchment: '#F4EFE7',
    warmIvory: '#EDE4D8',
    stoneBeige: '#D8CCBD',
    primaryText: '#1B1815',
    secondaryText: '#5E544A',
    mutedText: '#8A7E71',
    brass: '#B08D57',
    mutedCopper: '#A06A4B',
    forestOlive: '#5B6448',
    burgundy: '#6A3B32',
  },
  fonts: {
    title: "'EB Garamond', 'Libre Baskerville', 'Source Serif 4', Georgia, serif",
    body: "'Source Sans 3', 'Inter', 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
    numeric: "'Source Sans 3', 'Inter', 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
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
