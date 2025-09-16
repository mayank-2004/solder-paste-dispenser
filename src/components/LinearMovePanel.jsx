import { useMemo, useState } from "react";

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function length2D(dx, dy) { return Math.hypot(dx, dy); }

function axisLimitedLineSpeed({ dx, dy, Vx, Vy }) {
  // unit direction
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  // Per-axis limit ⇒ Vline * |u_axis| ≤ V_axis  ⇒ Vline ≤ V_axis / |u_axis|
  const limitX = ux !== 0 ? Vx / Math.abs(ux) : Infinity;
  const limitY = uy !== 0 ? Vy / Math.abs(uy) : Infinity;
  return Math.min(limitX, limitY); // mm/s
}

function axisLimitedLineAccel({ dx, dy, Ax, Ay }) {
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const limitX = ux !== 0 ? Ax / Math.abs(ux) : Infinity;
  const limitY = uy !== 0 ? Ay / Math.abs(uy) : Infinity;
  return Math.min(limitX, limitY); // mm/s^2
}

/** Trapezoidal (with smooth per-segment ramp for jerk friendliness) */
function makeTrapezoidSegments({ A, B, vmax, amax, segments = 60 }) {
  const dx = B.x - A.x, dy = B.y - A.y;
  const L = Math.hypot(dx, dy) || 0.0001;
  const ux = dx / L, uy = dy / L;

  // distance to accelerate to vmax: da = V^2/(2a)
  const d_accel = (vmax * vmax) / (2 * amax);
  const d_total_accel = 2 * d_accel;

  let vPeak = vmax;
  let d_acc = d_accel, d_cruise = L - d_total_accel, d_dec = d_accel;

  if (d_cruise < 0) {
    // triangular profile: cannot reach vmax
    vPeak = Math.sqrt(amax * L);
    d_acc = d_dec = L / 2;
    d_cruise = 0;
  }

  // Build segments along 0..L; velocity ramp in/out
  const pts = [];
  const gc = [];

  // Helper to get point at distance s along the line
  const atS = (s) => ({ x: A.x + ux * s, y: A.y + uy * s });

  let last = A;
  for (let i = 1; i <= segments; i++) {
    const s = (i / segments) * L;

    // velocity envelope (scalar) across distance s
    let v; // mm/s
    if (s <= d_acc) {
      // accelerate: v^2 = 2 * a * s  ⇒ v = sqrt(2as)
      v = Math.sqrt(2 * amax * s);
    } else if (s >= (L - d_dec)) {
      const sDec = L - s;
      v = Math.sqrt(2 * amax * sDec);
    } else {
      v = vPeak;
    }

    // Small smoothing of v for jerk-friendliness (optional micro ramp)
    const smooth = 0.08; // 0..~0.15
    const si = i / segments;
    const sRampIn = clamp(si / smooth, 0, 1);
    const sRampOut = clamp((1 - si) / smooth, 0, 1);
    const ramp = Math.min(1, Math.min(sRampIn, sRampOut) + (1 - smooth));
    const vSmooth = v * ramp;

    const p = atS(s);
    pts.push(p);

    const dSeg = Math.hypot(p.x - last.x, p.y - last.y) || 0.0001;
    const dt = dSeg / (vSmooth || 0.0001);
    const F = vSmooth * 60; // mm/s → mm/min (G-code feed)
    gc.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} F${Math.max(1, F).toFixed(0)}`);
    last = p;
  }

  const T = pts.length
    ? pts.reduce((acc, p, i) => {
        const q = i ? pts[i - 1] : A;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        const vline = Math.max(0.001, axisLimitedLineSpeed({ dx: p.x - q.x, dy: p.y - q.y, Vx: vmax, Vy: vmax }));
        return acc + d / vline;
      }, 0)
    : 0;

  return { pts, gc, stats: { Lxy: L, Vline: vPeak, Aline: amax, T } };
}

/** DDA-like “staircase” stepping along the line with a small grid size */
function makeDDAPath({ A, B, step = 0.5, Vline }) {
  const pts = [];
  const gc = [];
  const dx = B.x - A.x, dy = B.y - A.y;
  const L = Math.hypot(dx, dy) || 0.0001;
  const ux = dx / L, uy = dy / L;

  const steps = Math.max(1, Math.ceil(L / step));
  let last = A;
  for (let i = 1; i <= steps; i++) {
    const s = (i / steps) * L;
    const x = A.x + ux * s;
    const y = A.y + uy * s;
    const px = Math.round(x / step) * step;
    const py = Math.round(y / step) * step;
    const p = { x: px, y: py };
    pts.push(p);
    const F = Math.max(60, (Vline * 60) | 0);
    gc.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} F${F}`);
    last = p;
  }
  const T = L / Math.max(0.001, Vline);
  return { pts, gc, stats: { Lxy: L, Vline, Aline: 0, T } };
}

/** Straight linear interpolation (single G1) */
function makeLinearMove({ A, B, Vline }) {
  const dx = B.x - A.x, dy = B.y - A.y;
  const L = Math.hypot(dx, dy);
  const F = Math.max(60, (Vline * 60) | 0);
  const gc = [`G1 X${B.x.toFixed(3)} Y${B.y.toFixed(3)} F${F}`];
  const pts = [A, B];
  const T = L / Math.max(0.001, Vline);
  return { pts, gc, stats: { Lxy: L, Vline, Aline: 0, T } };
}

/** Build complete pick→move→place sequence (no axis-sequential anywhere) */
function buildPlacementSequence({ A, B, Zsafe, Zwork, axis, algo = "linear", ddaStep = 0.5 }) {
  // Compute line-constrained limits
  const dx = B.x - A.x, dy = B.y - A.y;
  const VlineMax = axisLimitedLineSpeed({ dx, dy, Vx: axis.Vx, Vy: axis.Vy });
  const AlineMax = axisLimitedLineAccel({ dx, dy, Ax: axis.Ax, Ay: axis.Ay });

  // Z limits are independent
  const Fz = Math.max(60, (axis.Vz * 60) | 0);

  // Header / positioning
  const g = [
    "G21 ; mm",
    "G90 ; absolute",
    `G0 Z${Zsafe.toFixed(3)}`,
    `G0 X${A.x.toFixed(3)} Y${A.y.toFixed(3)}`,
    `G1 Z${Zwork.toFixed(3)} F${Fz} ; pick`,
    `G1 Z${Zsafe.toFixed(3)} F${Fz}`
  ];

  // XY travel from A→B (choose algorithm)
  let core;
  if (algo === "linear") {
    core = makeLinearMove({ A, B, Vline: VlineMax });
  } else if (algo === "s-curve") {
    core = makeTrapezoidSegments({ A, B, vmax: VlineMax, amax: Math.max(10, AlineMax) });
  } else if (algo === "dda") {
    const step = Math.max(0.05, ddaStep || 0.5);
    core = makeDDAPath({ A, B, step, Vline: Math.min(VlineMax, 150) });
  } else {
    throw new Error("Unknown algo: " + algo);
  }
  g.push(...core.gc);

  // Place at B
  g.push(`G1 Z${Zwork.toFixed(3)} F${Fz} ; place`);
  g.push(`G1 Z${Zsafe.toFixed(3)} F${Fz}`);

  return { gcode: g, preview: core.pts, stats: core.stats };
}

/** -------- Small UI controls -------- **/
function Num({ label, value, onChange, step = 0.1 }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <span>{label}</span>
      <input type="number" value={value} step={step} onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}

/** -------- Panel -------- **/
export default function LinearMovePanel() {
  const [A, setA] = useState({ x: 10, y: 20, z: 5 });
  const [B, setB] = useState({ x: 85, y: 40, z: 5 });
  const [axis, setAxis] = useState({ Vx: 200, Vy: 150, Ax: 1500, Ay: 1200, Vz: 50, Az: 500 });
  const [Zsafe, setZsafe] = useState(6);
  const [Zwork, setZwork] = useState(0.4);
  const [algo, setAlgo] = useState("linear"); // "linear" | "s-curve" | "dda"
  const [ddaStep, setDdaStep] = useState(0.5);
  const [seq, setSeq] = useState({ gcode: [], preview: [], stats: null });

  const plan = () => setSeq(buildPlacementSequence({ A, B, Zsafe, Zwork, axis, algo, ddaStep }));

  const send = async () => {
    const out = seq.gcode?.length ? seq : buildPlacementSequence({ A, B, Zsafe, Zwork, axis, algo, ddaStep });
    await window.serial.sendGcode(out.gcode.join('\n'));
    setSeq(out);
  };

  const poly = useMemo(() => {
    if (!seq.preview?.length) return '';
    const pts = seq.preview.map(p => `${p.x},${p.y}`).join(' ');
    return pts;
  }, [seq.preview]);

  return (
    <div className="panel" style={{ background: '#0b0b0b', color: '#eee', border: '1px solid #222', width:'1000px', borderRadius: 8, padding: 10 }}>
      <h4 style={{ margin: '0 0 8px' }}>Pick → Place Planner (XY only, no axis-sequential)</h4>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <fieldset>
          <legend>A (mm)</legend>
          <Num label="Ax" value={A.x} onChange={v => setA({ ...A, x: v })} />
          <Num label="Ay" value={A.y} onChange={v => setA({ ...A, y: v })} />
          <Num label="Az" value={A.z} onChange={v => setA({ ...A, z: v })} />
        </fieldset>
        <fieldset>
          <legend>B (mm)</legend>
          <Num label="Bx" value={B.x} onChange={v => setB({ ...B, x: v })} />
          <Num label="By" value={B.y} onChange={v => setB({ ...B, y: v })} />
          <Num label="Bz" value={B.z} onChange={v => setB({ ...B, z: v })} />
        </fieldset>
        <fieldset>
          <legend>Limits</legend>
          <Num label="Vx (mm/s)" value={axis.Vx} onChange={v => setAxis({ ...axis, Vx: v })} />
          <Num label="Vy (mm/s)" value={axis.Vy} onChange={v => setAxis({ ...axis, Vy: v })} />
          <Num label="Ax (mm/s²)" value={axis.Ax} onChange={v => setAxis({ ...axis, Ax: v })} />
          <Num label="Ay (mm/s²)" value={axis.Ay} onChange={v => setAxis({ ...axis, Ay: v })} />
          <Num label="Vz (mm/s)" value={axis.Vz} onChange={v => setAxis({ ...axis, Vz: v })} />
          <Num label="Az (mm/s²)" value={axis.Az} onChange={v => setAxis({ ...axis, Az: v })} />
        </fieldset>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        <Num label="Zsafe" value={Zsafe} onChange={setZsafe} />
        <Num label="Zwork" value={Zwork} onChange={setZwork} />
        <div>
          <div style={{ fontSize: 12, marginBottom: 4 }}>Algorithm</div>
          <label style={{ marginRight: 12 }}>
            <input type="radio" checked={algo === "linear"} onChange={() => setAlgo("linear")} /> Linear (diagonal)
          </label>
          <label style={{ marginRight: 12 }}>
            <input type="radio" checked={algo === "s-curve"} onChange={() => setAlgo("s-curve")} /> Blended (S-curve)
          </label>
          <label>
            <input type="radio" checked={algo === "dda"} onChange={() => setAlgo("dda")} /> DDA staircase
          </label>
        </div>
        {algo === "dda" && <Num label="DDA step (mm)" value={ddaStep} step={0.05} onChange={setDdaStep} />}
        <button onClick={plan}>Plan</button>
        <button onClick={send}>Send</button>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 8 }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>Preview (XY)</div>
          <svg viewBox="0 0 120 80" style={{ width: '100%', height: 260, background: '#0b0b0b', borderRadius: 6 }}>
            <line x1="0" y1="79" x2="120" y2="79" stroke="#333" />
            <line x1="1" y1="0" x2="1" y2="80" stroke="#333" />
            {poly && <polyline points={poly} fill="none" stroke="#4cc9f0" strokeWidth="0.6" />}
            <circle cx={A.x} cy={A.y} r="1.2" fill="#90ee90" />
            <circle cx={B.x} cy={B.y} r="1.2" fill="#ff6b6b" />
          </svg>
        </div>

        <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 8, fontSize: 14 }}>
          <div><b>Stats</b></div>
          {seq.stats ? (
            <ul style={{ lineHeight: 1.6 }}>
              <li>Lxy: {seq.stats.Lxy.toFixed(3)} mm</li>
              <li>Projected Vline: {seq.stats.Vline.toFixed(2)} mm/s</li>
              <li>Projected Aline: {seq.stats.Aline.toFixed(2)} mm/s²</li>
              <li>Estimated T: {seq.stats.T.toFixed(3)} s</li>
            </ul>
          ) : <div>Plan to see stats…</div>}
          <div style={{ marginTop: 8 }}>
            <b>G-code</b>
            <pre style={{ background: '#0b0b0b', padding: 8, borderRadius: 6, maxHeight: 220, overflow: 'auto' }}>
              {(seq.gcode || []).join('\n')}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
