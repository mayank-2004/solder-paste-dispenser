// src/components/BoardOriginTools.jsx
import React from 'react';
import { useStore } from '../state/useStore.js';

export default function BoardOriginTools() {
    const cfg = useStore(s => s.config);
    const setConfig = useStore(s => s.setConfig);
    const bbox = cfg?.board?.bbox;

    const setBL = () => {
        if (!bbox) { alert('No board bounds available. Import Gerbers first.'); return; }
        // Bottom-left in board coords = (minX, minY).
        // We want this to be our (0,0) origin in machine space → set offsets.boardOrigin = (-minX, -minY)
        const ox = -(bbox.minX || 0);
        const oy = -(bbox.minY || 0);
        setConfig({
            ...cfg,
            offsets: {
                ...cfg.offsets,
                boardOrigin: { x: ox, y: oy, z: (cfg.offsets?.boardOrigin?.z || 0) }
            }
        });
    };

    return (
        <div className="panel">
            <h3 className="h">Board Origin</h3>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={setBL}>Set origin = bottom-left (from Gerbers)</button>
                {bbox
                    ? <span className="badge">
                        Size {(bbox.maxX - bbox.minX).toFixed(2)} × {(bbox.maxY - bbox.minY).toFixed(2)} mm
                    </span>
                    : <span className="badge">No bounds (import Gerber ZIP)</span>}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#8aa0b2' }}>
                This sets <code>offsets.boardOrigin</code> so board (minX,minY) maps to machine (0,0).
                Use the Fiducials tab to compute rotation/scale/translation to your machine.
            </div>
        </div>
    );
}
