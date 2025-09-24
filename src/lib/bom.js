export const bomRows = (parts) => {
    const map = new Map();
    for (const p of parts) {
        const k = `${p.footprint}@${p.val}`;
        map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map, ([k, count]) => ({ k, count }));
};