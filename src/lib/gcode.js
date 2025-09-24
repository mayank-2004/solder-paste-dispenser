import { moveXYZA, header, footer, safeZ } from './kinematics.js';
import { applySimilarity } from './transforms.js';

export function buildPasteJob({ parts, pads = [], cfg, transform }) {
    if (pads.length) return buildPasteFromPads({ pads, cfg, transform });

    const g = [];
    g.push(...header(cfg.machine));
    g.push(moveXYZA({ z: safeZ(cfg) }));
    for (const p of parts) {
        const P = applySimilarity(transform, { x: p.x, y: p.y });
        g.push(moveXYZA({ x: P.x + cfg.offsets.boardOrigin.x, y: P.y + cfg.offsets.boardOrigin.y }));
        g.push(moveXYZA({ z: cfg.offsets.paste.zPaste }));
        const area = 1; 
        const ms = cfg.offsets.paste.initMs + area * cfg.offsets.paste.msPerMm2;
        g.push('M106 S255');
        g.push(`G4 P${Math.round(ms)}`);
        g.push('M107');
        g.push(moveXYZA({ z: safeZ(cfg) }));
    }
    g.push(...footer());
    return g;
}

export function buildPasteFromPads({ pads, cfg, transform }) {
  const g = [];
  g.push(...header(cfg.machine));
  g.push(moveXYZA({ z: safeZ(cfg) }));
  for (const pad of pads) {
    const P = applySimilarity(transform, { x: pad.x, y: pad.y });
    const XY = { x: P.x + cfg.offsets.boardOrigin.x, y: P.y + cfg.offsets.boardOrigin.y };
    g.push(moveXYZA(XY));
    g.push(moveXYZA({ z: cfg.offsets.paste.zPaste }));
    const area = pad.area || 1;
    const ms = cfg.offsets.paste.initMs + area * cfg.offsets.paste.msPerMm2;
    g.push('M106 S255');              // actuator ON
    g.push(`G4 P${Math.round(ms)}`);  // dwell proportional to pad area
    g.push('M107');                   // actuator OFF
    g.push(moveXYZA({ z: safeZ(cfg) }));
  }
  g.push(...footer());
  return g;
}

export function buildPickPlaceJob({ parts, cfg, transform }) {
    const g = [];
    g.push(...header(cfg.machine));
    g.push(moveXYZA({ z: safeZ(cfg) }));
    for (const p of parts) {
        const key = `${p.footprint}@${p.val}`;
        const tape = cfg.componentSources[key];
        if (!tape) continue;
        // where in tape? Simplest: use and increment count
        const idx = (tape._used = (tape._used || 0) + 1) - 1;
        const pickX = tape.origin.x + tape.spacing.dx * idx;
        const pickY = tape.origin.y + tape.spacing.dy * idx;


        // pick
        g.push(moveXYZA({ x: pickX, y: pickY }));
        g.push(moveXYZA({ z: tape.origin.z }));
        g.push(cfg.offsets.pick.vacuumOn);
        g.push('G4 P150');
        g.push(moveXYZA({ z: safeZ(cfg) }));


        // place
        const M = applySimilarity(transform, { x: p.x, y: p.y });
        const placeA = (p.rot || 0); // optional A‑axis rotation
        g.push(moveXYZA({ x: M.x + cfg.offsets.boardOrigin.x, y: M.y + cfg.offsets.boardOrigin.y, a: placeA }));
        g.push(moveXYZA({ z: cfg.offsets.pick.zPlace }));
        g.push(cfg.offsets.pick.vacuumOff);
        g.push('G4 P100');
        g.push(moveXYZA({ z: safeZ(cfg) }));
    }
    g.push(...footer());
    return g;
}