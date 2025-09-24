export function moveXYZA({ x, y, z, a, feed }) {
    const parts = [];
    if (x != null) parts.push(`X${x.toFixed(3)}`);
    if (y != null) parts.push(`Y${y.toFixed(3)}`);
    if (z != null) parts.push(`Z${z.toFixed(3)}`);
    if (a != null) parts.push(`A${a.toFixed(3)}`); // if firmware supports A axis
    if (feed != null) parts.push(`F${feed}`);
    return `G1 ${parts.join(' ')}`.trim();
}


export function header({ units = 'mm' } = {}) {
    return [units === 'mm' ? 'G21' : 'G20', 'G90', 'G92 X0 Y0 Z0']; // mm & absolute
}


export function footer() { return ['M400']; } // wait for moves complete


export function safeZ(config) { return config.offsets.paste.zSafe; }