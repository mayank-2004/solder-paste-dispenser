import React from 'react';
import { useStore } from '../state/useStore.js';
import { applySimilarity } from '../lib/transforms.js';


export default function PreviewCanvas() {
    const parts = useStore(s => s.parts);
    const pads = useStore(s => s.pads);
    const cfg = useStore(s => s.config);
    const transform = useStore(s => s.config.transform || s.transform);
    const ref = React.useRef();

    React.useEffect(() => {
        const canvas = ref.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width = canvas.clientWidth;
        const H = canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0e1217'; ctx.fillRect(0, 0, W, H);
        const s = 4; // px per mm
        const toScreen = (pt) => ({ x: 20 + s * pt.x, y: H - (20 + s * pt.y) });

        // draw parts
        ctx.fillStyle = '#5cc8ff';
        for (const p of parts) {
            const M = applySimilarity(transform, { x: p.x, y: p.y });
            const P = { x: M.x + cfg.offsets.boardOrigin.x, y: M.y + cfg.offsets.boardOrigin.y };
            const S = toScreen(P);
            ctx.beginPath(); ctx.arc(S.x, S.y, 2, 0, Math.PI * 2); ctx.fill();
        }

        // draw paste pads from Gerber (green)
    ctx.fillStyle = '#90ee90';
    for (const pad of pads) {
      const M = applySimilarity(transform, { x: pad.x, y: pad.y });
      const P = { x: M.x + cfg.offsets.boardOrigin.x, y: M.y + cfg.offsets.boardOrigin.y };
      const S = toScreen(P);
      ctx.beginPath(); ctx.arc(S.x, S.y, 2, 0, Math.PI*2); ctx.fill();
    }
    }, [parts, cfg]);


    return (
        <div className="panel" style={{ height: 360 }}>
            <h3 className="h">Preview</h3>
            <canvas ref={ref} style={{ width: '100%', height: 300, borderRadius: 12, border: '1px solid #1e2a38' }} />
        </div>
    );
}