// Pure colour helpers (WCAG contrast), imported by the interface code and testable in Node.

import { tokens } from './tokens.js';

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const HEX = /^#[0-9a-f]{6}$/i;

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Class for the text of a badge on `color`: 'on-light' when the usual white text falls
 * below 4.5:1 and the dark ink does better, '' otherwise.
 */
export function badgeInk(color) {
  if (!HEX.test(color ?? '')) return '';
  const { onColor, onLight } = tokens.ui.content;
  return contrast(color, onColor) < 4.5 && contrast(color, onLight) > contrast(color, onColor) ? 'on-light' : '';
}
