/**
 * Color Name Detection & Harmonization Utility (Backend)
 * Automatically resolves hex colors to natural human-readable color names.
 */

const COLOR_PALETTE = [
  // Grayscale & Monochromes
  { name: 'Black', hex: '#000000' },
  { name: 'Charcoal', hex: '#262626' },
  { name: 'Dark Gray', hex: '#404040' },
  { name: 'Gray', hex: '#737373' },
  { name: 'Slate Gray', hex: '#64748B' },
  { name: 'Silver', hex: '#A3A3A3' },
  { name: 'Light Gray', hex: '#D4D4D4' },
  { name: 'Off-White', hex: '#F5F5F5' },
  { name: 'White', hex: '#FFFFFF' },

  // Reds & Maroons
  { name: 'Red', hex: '#FF0000' },
  { name: 'Red', hex: '#EF4444' },
  { name: 'Crimson', hex: '#DC2626' },
  { name: 'Dark Red', hex: '#B91C1C' },
  { name: 'Maroon', hex: '#800000' },
  { name: 'Maroon', hex: '#991B1B' },
  { name: 'Deep Maroon', hex: '#7F1D1D' },
  { name: 'Firebrick', hex: '#B22222' },

  // Pinks & Roses
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Pink', hex: '#FFC0CB' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Hot Pink', hex: '#FF69B4' },
  { name: 'Hot Pink', hex: '#DB2777' },
  { name: 'Deep Pink', hex: '#FF1493' },
  { name: 'Pastel Pink', hex: '#FDA4AF' },
  { name: 'Coral', hex: '#F87171' },
  { name: 'Salmon', hex: '#FA8072' },
  { name: 'Magenta', hex: '#FF00FF' },
  { name: 'Magenta', hex: '#D946EF' },

  // Oranges & Ambers
  { name: 'Orange', hex: '#FFA500' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Dark Orange', hex: '#EA580C' },
  { name: 'Burnt Orange', hex: '#C2410C' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Peach', hex: '#FDBA74' },

  // Yellows & Golds
  { name: 'Yellow', hex: '#FFFF00' },
  { name: 'Yellow', hex: '#EAB308' },
  { name: 'Lemon Yellow', hex: '#FACC15' },
  { name: 'Gold', hex: '#FFD700' },
  { name: 'Gold', hex: '#D97706' },
  { name: 'Dark Gold', hex: '#CA8A04' },
  { name: 'Cream', hex: '#FFFDD0' },
  { name: 'Beige', hex: '#F5F5DC' },

  // Greens
  { name: 'Lime', hex: '#00FF00' },
  { name: 'Lime Green', hex: '#84CC16' },
  { name: 'Green', hex: '#22C55E' },
  { name: 'Green', hex: '#16A34A' },
  { name: 'Forest Green', hex: '#15803D' },
  { name: 'Dark Green', hex: '#14532D' },
  { name: 'Emerald Green', hex: '#10B981' },
  { name: 'Mint Green', hex: '#6EE7B7' },
  { name: 'Olive', hex: '#808000' },
  { name: 'Olive Green', hex: '#65A30D' },

  // Cyans & Teals
  { name: 'Cyan', hex: '#00FFFF' },
  { name: 'Cyan', hex: '#06B6D4' },
  { name: 'Teal', hex: '#008080' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Dark Teal', hex: '#0F766E' },
  { name: 'Turquoise', hex: '#40E0D0' },

  // Blues
  { name: 'Blue', hex: '#0000FF' },
  { name: 'Blue', hex: '#3B82F6' },
  { name: 'Royal Blue', hex: '#2563EB' },
  { name: 'Dark Blue', hex: '#1D4ED8' },
  { name: 'Navy Blue', hex: '#000080' },
  { name: 'Navy Blue', hex: '#1E3A8A' },
  { name: 'Midnight Navy', hex: '#172554' },
  { name: 'Sky Blue', hex: '#0EA5E9' },
  { name: 'Light Blue', hex: '#38BDF8' },
  { name: 'Baby Blue', hex: '#7DD3FC' },

  // Purples & Violets
  { name: 'Indigo', hex: '#4B0082' },
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Purple', hex: '#800080' },
  { name: 'Purple', hex: '#8B5CF6' },
  { name: 'Violet', hex: '#7C3AED' },
  { name: 'Violet', hex: '#EE82EE' },
  { name: 'Deep Purple', hex: '#6D28D9' },
  { name: 'Lavender', hex: '#C084FC' },
  { name: 'Plum', hex: '#A21CAF' },

  // Browns
  { name: 'Brown', hex: '#A52A2A' },
  { name: 'Brown', hex: '#78350F' },
  { name: 'Chocolate', hex: '#D2691E' },
  { name: 'Tan', hex: '#D2B48C' }
];

function hexToRgb(hex) {
  let c = String(hex || '').replace(/^#/, '').trim();
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  if (c.length !== 6) return [0, 0, 0];
  const num = parseInt(c, 16);
  if (Number.isNaN(num)) return [0, 0, 0];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function getColorName(hex) {
  if (!hex || typeof hex !== 'string') return 'Standard';
  let cleanHex = hex.trim();
  if (!cleanHex.startsWith('#')) cleanHex = '#' + cleanHex;
  cleanHex = cleanHex.toUpperCase();

  const exact = COLOR_PALETTE.find((c) => c.hex.toUpperCase() === cleanHex);
  if (exact) return exact.name;

  const [r, g, b] = hexToRgb(cleanHex);
  let bestName = 'Standard';
  let minDiff = Infinity;

  for (const item of COLOR_PALETTE) {
    const [ir, ig, ib] = hexToRgb(item.hex);
    const rmean = (r + ir) / 2;
    const dr = r - ir;
    const dg = g - ig;
    const db = b - ib;
    const diff = Math.sqrt((((512 + rmean) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rmean) * db * db) >> 8));
    if (diff < minDiff) {
      minDiff = diff;
      bestName = item.name;
    }
  }

  return bestName;
}

module.exports = {
  COLOR_PALETTE,
  getColorName,
};

