/**
 * Two groups. That's the whole taxonomy the app needs.
 *
 * Sharks are the shark orders — not all of Elasmobranchii, which would mean
 * rays and skates too. Whales means the cetaceans: whales, dolphins, porpoises.
 * Seals and manatees are neither, and aren't here.
 */

export const GROUPS = {
  shark: { label: 'Sharks', color: '#e8a33d' },
  whale: { label: 'Whales', color: '#bcd2f0' },
};

export function groupOf(species) {
  return species.class === 'Mammalia' ? 'whale' : 'shark';
}

export function colorOf(species) {
  return GROUPS[groupOf(species)].color;
}
