// Very simple parser that accepts a CSV with header like:
// Ref,Val,Package,PosX,PosY,Rot,Side
// Units are assumed millimeters. Rot in degrees.
// Returns [{ ref, val, footprint, x, y, rot, side }]


export function parseRPTorPOS(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const header = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase());
    const idx = (name) => header.findIndex(h => h === name);
    const col = {
        ref: idx('ref'), val: idx('val'), footprint: idx('package'),
        x: idx('posx'), y: idx('posy'), rot: idx('rot'), side: idx('side')
    };
    const out = [];
    for (let i = 1; i < lines.length; ++i) {
        const parts = lines[i].split(/[,;\t]/).map(s => s.trim());
        if (parts.length < header.length) continue;
        out.push({
            ref: parts[col.ref],
            val: parts[col.val],
            footprint: parts[col.footprint],
            x: parseFloat(parts[col.x]),
            y: parseFloat(parts[col.y]),
            rot: parseFloat(parts[col.rot] || '0'),
            side: parts[col.side] || 'F'
        });
    }
    return out;
}


// Simple BOM aggregation like `-l` in rpt2pnp
export function aggregateBOM(rows) {
    const map = new Map();
    for (const r of rows) {
        const key = `${r.footprint}@${r.val}`;
        map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map, ([key, count]) => ({ key, count }));
}