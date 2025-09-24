export function moveXYZA({ x, y, z, a, feed, rapid = false }) {
    const parts = [];
    if (x != null) parts.push(`X${x.toFixed(3)}`);
    if (y != null) parts.push(`Y${y.toFixed(3)}`);
    if (z != null) parts.push(`Z${z.toFixed(3)}`);
    if (a != null) parts.push(`A${a.toFixed(3)}`); // if firmware supports A axis
    if (feed != null) parts.push(`F${Math.round(feed)}`);
    const verb = rapid ? 'G0' : 'G1';
    return `${verb} ${parts.join(' ')}`.trim();
}

export function header({ units = 'mm', defaultFeed = 1500 } = {}) {
  return [
    '%',                // optional program start marker (some senders use it)
    units === 'mm' ? 'G21' : 'G20',
    'G90',              // absolute coords
    'G17',              // XY plane
    `G94`,              // feed per minute (optional; helps some controllers)
    `F${defaultFeed}`,  // set default feed
  ].filter(Boolean);
}

export function footer({ homeAtEnd = false } = {}) {
  const out = ['M400']; // wait for motions to finish
  if (homeAtEnd) out.push('G28 X Y'); // optional: home XY at end
  out.push('M30'); // program end
  return out;
}


export function safeZ(config) {
  return config.offsets.paste.zSafe;
}