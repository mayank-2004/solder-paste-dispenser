// 2D similarity: scale * R(theta) * [x;y] + t
export function applySimilarity({ rotationDeg, scale, tx, ty }, { x, y }) {
    const th = (rotationDeg * Math.PI) / 180;
    const c = Math.cos(th), s = Math.sin(th);
    return { x: scale * (c * x - s * y) + tx, y: scale * (s * x + c * y) + ty };
}


// Compute similarity from two corresponding points and an optional scale hint.
export function similarityFromFiducials(boardPts, machinePts) {
    if (boardPts.length < 2 || machinePts.length < 2) throw new Error('Need 2 points');
    const [b1, b2] = boardPts, [m1, m2] = machinePts;
    const dbx = b2.x - b1.x, dby = b2.y - b1.y;
    const dmx = m2.x - m1.x, dmy = m2.y - m1.y;
    const sb = Math.hypot(dbx, dby) || 1;
    const sm = Math.hypot(dmx, dmy) || 1;
    const scale = sm / sb;
    const angB = Math.atan2(dby, dbx);
    const angM = Math.atan2(dmy, dmx);
    const rotationDeg = (angM - angB) * 180 / Math.PI;
    // Solve for translation so that T(b1) = m1
    const th = (rotationDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    const Tx = m1.x - scale * (c * b1.x - s * b1.y);
    const Ty = m1.y - scale * (s * b1.x + c * b1.y);
    return { rotationDeg, scale, tx: Tx, ty: Ty };
}