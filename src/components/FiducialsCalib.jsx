import React from 'react';
import { useStore } from '../state/useStore.js';
import { similarityFromFiducials } from '../lib/transforms.js';

export default function FiducialCalib() {
    const cfg = useStore(s => s.config);
    // const transform = useStore(s => s.transform);
    const setCfg = useStore(s => s.setConfig);

    const [bPts, setBPts] = React.useState([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const [mPts, setMPts] = React.useState([{ x: 0, y: 0 }, { x: 10, y: 0 }]);

    const addBoard = () => setBPts(p => [...p, { x: 0, y: 0 }]);
    const addMachine = () => setMPts(p => [...p, { x: 0, y: 0 }]);

    const canCompute = bPts.length >= 2 && mPts.length >= 2;
    const compute = () => {
        if (!canCompute) return;
        const t = similarityFromFiducials(bPts.slice(0, 2), mPts.slice(0, 2));
        setCfg({ ...cfg, transform: t });
    };

    const ed = (arr, setArr, i, k, v) => {
        const a = [...arr];
        a[i] = { ...a[i], [k]: +v };
        setArr(a);
    };

    const t = cfg.transform || { rotationDeg: 0, scale: 1, tx: 0, ty: 0 };

    return (
        <div className="panel">
            <h3 className="h">Fiducial Calibration (2-point)</h3>

            <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <div className="col">
                    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                        <strong>Board pts</strong> <button onClick={addBoard}>+ add</button>
                    </div>
                    {bPts.map((p, i) => (
                        <div className="row" key={`b${i}`} style={{ gap: 8 }}>
                            <label>X <input type="number" step="0.01" value={p.x}
                                onChange={e => ed(bPts, setBPts, i, 'x', e.target.value)} /></label>
                            <label>Y <input type="number" step="0.01" value={p.y}
                                onChange={e => ed(bPts, setBPts, i, 'y', e.target.value)} /></label>
                        </div>
                    ))}
                </div>

                <div className="col">
                    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                        <strong>Machine pts</strong> <button onClick={addMachine}>+ add</button>
                    </div>
                    {mPts.map((p, i) => (
                        <div className="row" key={`m${i}`} style={{ gap: 8 }}>
                            <label>X <input type="number" step="0.01" value={p.x}
                                onChange={e => ed(mPts, setMPts, i, 'x', e.target.value)} /></label>
                            <label>Y <input type="number" step="0.01" value={p.y}
                                onChange={e => ed(mPts, setMPts, i, 'y', e.target.value)} /></label>
                        </div>
                    ))}
                </div>
            </div>

            <div className="row" style={{ marginTop: 12, alignItems: 'center', gap: 12 }}>
                <button onClick={compute} disabled={!canCompute}>Compute Transform</button>
                {!canCompute && <span className="badge">Add at least 2 points on each side</span>}
            </div>

            <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <span className="badge">rotation {Number(t.rotationDeg).toFixed(2)}°</span>
                <span className="badge">scale {t.scale}</span>
                <span className="badge">tx {t.tx}</span>
                <span className="badge">ty {t.ty}</span>
            </div>
        </div>
    );
}