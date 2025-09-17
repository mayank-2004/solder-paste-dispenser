import { useEffect, useRef, useMemo, useState, use } from "react";
import { applyTransform } from "../lib/utils/transform2d";
import "./LinearMovePanel.css";

export default function LinearMovePanel({
  homeDesign,
  focusDesign,
  xf,
  applyXf,
  components = [],
  axisLetter = "A"
}) {
  const toMachine = (pt) => {
    if (!pt) return null;
    return applyXf && xf ? applyTransform(xf, pt) : { ...pt };
  };
  const fmt = (n, d = 3) => (isFinite(n) ? n.toFixed(d) : "");

  const [A, setA] = useState({ x: 10, y: 20, z: 5 });
  const [B, setB] = useState({ x: 85, y: 40, z: 5 });
  const [zsafe, setZsafe] = useState(6);
  const [zwork, setZwork] = useState(0.4);

  const [Vx, setVx] = useState(200);
  const [Vy, setVy] = useState(150);
  const [Ax, setAx] = useState(1500);
  const [Ay, setAy] = useState(1200);
  const [Vz, setVz] = useState(50);
  const [Az, setAz] = useState(500);

  const [algo, setAlgo] = useState("linear");
  const [ddaStep, setDdaStep] = useState(0.5);
  const [rotDeg, setRotDeg] = useState(0);

  const [previewPts, setPreviewPts] = useState([])
  const [gcode, setGcode] = useState("");
  const svgRef = useRef(null);

  const useHomeForA = () => homeDesign && setA((s) => ({ ...s, ...toMachine(homeDesign) }))
  const useFocusForB = () => focusDesign && setB((s) => ({ ...s, ...toMachine(focusDesign) }))
  const useHomeForB = () => homeDesign && setB((s) => ({ ...s, ...toMachine(homeDesign) }))
  const useFocusForA = () => focusDesign && setA((s) => ({ ...s, ...toMachine(focusDesign) }))
  const swapAb = () => {
    setA(B);
    setB(A);
  }
  useEffect(() => {
    if (homeDesign) setA((s) => ({ ...s, ...toMachine(homeDesign) }));
    if (focusDesign) setB((s) => ({ ...s, ...toMachine(focusDesign) }));
  }, [homeDesign, focusDesign, applyXf, xf]);

  function capLineSpeed(dirx, diry) {
    const ux = Math.abs(dirx) < 1e-9 ? 1e-9 : Math.abs(dirx);
    const uy = Math.abs(diry) < 1e-9 ? 1e-9 : Math.abs(diry);
    const vmax = Math.min(Vx / ux, Vy / uy);
    const amax = Math.min(Ax / ux, Ay / uy);
    return { vmax, amax };
  }

  function planSegments(a, b) {
    const pts = [];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) {
      return [{ x: b.x, y: b.y }];
    }
    const ux = dx / L, uy = dy / L;
    const { vmax } = capLineSpeed(ux, uy);

    if (algo === "linear") {
      pts.push({ x: b.x, y: b.y, feed: vmax * 60 });
    } else if (algo === "axis") {
      const xm = { x: b.x, y: a.y };
      const dx1 = xm.x - a.x, dy1 = xm.y - a.y;
      const L1 = Math.hypot(dx1, dy1) || 1;
      const ux1 = dx1 / L1, uy1 = dy1 / L1;
      const { vmax: v1 } = capLineSpeed(ux1, uy1);

      const dx2 = b.x - xm.x, dy2 = b.y - xm.y;
      const L2 = Math.hypot(dx2, dy2) || 1;
      const ux2 = dx2 / L2, uy2 = dy2 / L2;
      const { vmax: v2 } = capLineSpeed(ux2, uy2);

      pts.push({ x: xm.x, y: xm.y, feed: v1 * 60 });
      pts.push({ x: b.x, y: b.y, feed: v2 * 60 });
    } else if (algo === "dda") {
      const step = Math.max(0.05, ddaStep);
      const n = Math.ceil(L / step);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        pts.push({ x: a.x + dx * t, y: a.y + dy * t, feed: (vmax * 60) });
      }
    } else {
      pts.push({ x: b.x, y: b.y, feed: Math.min(Vx, Vy) * 60 });
    }
    return pts;
  }

  function buildGcode(a, b, segs) {
    const g = [];
    g.push("; --- linearMovePanel (machine mm) ---");
    g.push("G21");
    g.push("G90");
    g.push(`G0 Z${fmt(Math.max(zsafe, a.z ?? zsafe))}`);
    g.push(`G0 X${fmt(a.x)} Y${fmt(a.y)}`);
    g.push(`G1 Z${fmt(zwork)} F${fmt(Vz * 60, 0)}`);
    g.push("; pick");
    g.push(`G1 Z${fmt(zsafe)} F${fmt(Vz * 60, 0)}`);

    for (const p of segs) g.push(`G1 X${fmt(p.x)} Y${fmt(p.y)} F${fmt(p.feed, 0)}`);
    if (isFinite(rotDeg) && rotDeg !== 0) g.push(`G0 ${axisLetter}${fmt(rotDeg, 2)}`);

    g.push(`G1 Z${fmt(zwork)} F${fmt(Vz * 60, 0)}`);
    g.push("; place");
    g.push(`G1 Z${fmt(zsafe)} F${fmt(Vz * 60, 0)}`);

    return g.join("\n");
  }

  function plan() {
    const a = { ...A }, b = { ...B };
    const segs = planSegments(a, b);
    setPreviewPts([{ x: a.x, y: a.y }, ...segs.map(s => ({ x: s.x, y: s.y }))]);
    setGcode(buildGcode(a, b, segs));
  }

  async function send() {
    if (!gcode) plan();
    const lines = (gcode || "").split("\n").filter(Boolean);

    const sendLine = async (ln) => {
      if (window?.electronSerial?.writeLine) return window.electronSerial.writeLine(ln + "\n");
      if (window?.serial?.writeLine) return window.serial.writeLine(ln + "\n");
      console.log(ln);
    };
    for (const ln of lines) await sendLine(ln);
    if (!window?.electronSerial?.writeLine && !window?.serial?.writeLine) {
      alert("No serail connection detected. G-code printed to console.");
    }
  }

  function flattenPads() {
    const out = [];
    components.forEach((c) => (c.pads || []).forEach((p) => out.push({ x: p.x, y: p.y })));
    return out;
  }

  function exportJob() {
    const pads = flattenPads();
    if (!pads.length) return alert("No pads found in the top paste layer.");

    const ptA = toMachine(homeDesign) || toMachine(pads[0]);
    if (!ptA) return alert("No HOME and no pads to start from.");

    const feedXY = Math.min(Vx, Vy) * 60;
    const g = [];
    g.push("; --- Pad dispensing job (machine mm) ---");
    g.push("G21");
    g.push("G90");
    g.push(`G0 Z${fmt(zsafe)}`);
    g.push(`G0 X${fmt(ptA.x)} Y${fmt(ptA.y)}`);

    for (const dPad of pads) {
      const mPad = toMachine(dPad);
      if (!mPad) continue;
      g.push(`G1 X${fmt(mPad.x)} Y${fmt(mPad.y)} F${fmt(feedXY, 0)}`);
      if (isFinite(rotDeg) && rotDeg !== 0) g.push(`G0 ${axisLetter}${fmt(rotDeg, 2)}`);
      g.push(`G1 Z${fmt(zwork)} F${fmt(Vz * 60, 0)}`);
      g.push("; dispense");
      g.push(`G1 Z${fmt(zsafe)} F${fmt(Vz * 60, 0)}`);
    }

    const blob = new Blob([g.join("\n") + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dispense_job.gcode";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const bbox = useMemo(() => {
    const pts = previewPts.length ? previewPts : [A, B];
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));
    return { minX, minY, maxY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }, [previewPts, A, B]);

  function project(p) {
    const pad = 10;
    const W = 220, H = 180;
    const sx = (W - pad * 2) / bbox.w;
    const sy = (H - pad * 2) / bbox.h;
    const s = Math.min(sx, sy);
    const x = pad + (p.x - bbox.minX) * s;
    const y = pad + (bbox.maxY - p.y) * s;
    return { x, y };
  }

  return (
    <div className="panel linear-panel">
      <h3>Pick → Place Planner (XY + Zsafe/Zwork)</h3>

      <div className="row wrap" style={{ gap: 12 }}>
        <fieldset className="box">
          <legend>A (mm)</legend>
          <div className="grid2">
            <label>Ax <input type="number" value={A.x} onChange={e => setA({ ...A, x: +e.target.value })} /></label>
            <label>Ay <input type="number" value={A.y} onChange={e => setA({ ...A, y: +e.target.value })} /></label>
          </div>
          <label>Az <input type="number" value={A.z} onChange={e => setA({ ...A, z: +e.target.value })} /></label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={useHomeForA}>Use HOME</button>
            <button className="btn sm" onClick={useFocusForA}>Use Focus</button>
          </div>
        </fieldset>

        <fieldset className="box">
          <legend>B (mm)</legend>
          <div className="grid2">
            <label>Bx <input type="number" value={B.x} onChange={e => setB({ ...B, x: +e.target.value })} /></label>
            <label>By <input type="number" value={B.y} onChange={e => setB({ ...B, y: +e.target.value })} /></label>
          </div>
          <label>Bz <input type="number" value={B.z} onChange={e => setB({ ...B, z: +e.target.value })} /></label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={useFocusForB}>Use Focus</button>
            <button className="btn sm" onClick={useHomeForB}>Use HOME</button>
          </div>
        </fieldset>

        <fieldset className="box faint">
          <legend>Limits</legend>
          <div className="grid2">
            <label>Vx (mm/s) <input type="number" value={Vx} onChange={e => setVx(+e.target.value)} /></label>
            <label>Vy (mm/s) <input type="number" value={Vy} onChange={e => setVy(+e.target.value)} /></label>
            <label>Ax (mm/s²) <input type="number" value={Ax} onChange={e => setAx(+e.target.value)} /></label>
            <label>Ay (mm/s²) <input type="number" value={Ay} onChange={e => setAy(+e.target.value)} /></label>
            <label>Vz (mm/s) <input type="number" value={Vz} onChange={e => setVz(+e.target.value)} /></label>
            <label>Az (mm/s²) <input type="number" value={Az} onChange={e => setAz(+e.target.value)} /></label>
          </div>
        </fieldset>
      </div>

      <div className="row wrap" style={{ gap: 12 }}>
        <fieldset className="box">
          <legend>Heights</legend>
          <div className="grid2">
            <label>Zsafe <input type="number" step="0.1" value={zsafe} onChange={e => setZsafe(+e.target.value)} /></label>
            <label>Zwork <input type="number" step="0.05" value={zwork} onChange={e => setZwork(+e.target.value)} /></label>
          </div>
        </fieldset>

        <fieldset className="box">
          <legend>Algorithm</legend>
          <select value={algo} onChange={e => setAlgo(e.target.value)}>
            <option value="linear">Linear (diagonal)</option>
            <option value="axis">Axis-sequential (X → Y)</option>
            <option value="blended">Blended (S-curve approx)</option>
            <option value="dda">DDA staircase</option>
          </select>
        </fieldset>

        <fieldset className="box">
          <legend>Rotation</legend>
          <label>{axisLetter} (deg) <input type="number" step="0.1" value={rotDeg} onChange={e => setRotDeg(+e.target.value)} /></label>
        </fieldset>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={plan}>Plan</button>
        <button className="btn" onClick={send}>Send</button>
        <button className="btn secondary" onClick={exportJob} disabled={!components?.length}>Export Job (all pads)</button>
      </div>

      <div className="row wrap" style={{ gap: 16, marginTop: 12 }}>
        <div className="box" style={{ width: 240 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Preview (XY)</div>
          <svg ref={svgRef} width="220" height="180">
            <rect x="0" y="0" width="220" height="180" rx="8" ry="8" fill="#0b0b0b" />
            {/* axes */}
            <line x1="10" y1="170" x2="210" y2="170" stroke="#333" />
            <line x1="10" y1="10" x2="10" y2="170" stroke="#333" />
            {/* A */}
            <circle cx={project(A).x} cy={project(A).y} r="3.5" fill="#4ade80" />
            {/* path */}
            {previewPts.length > 1 && (
              <polyline
                fill="none"
                stroke="#ffd400"
                strokeWidth="2"
                points={previewPts.map(p => {
                  const q = project(p); return `${q.x},${q.y}`;
                }).join(" ")} />
            )}
            {/* B */}
            <circle cx={project(B).x} cy={project(B).y} r="3.5" fill="#ef4444" />
          </svg>
        </div>

        <div className="box" style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>G-code</div>
          <pre style={{ maxHeight: 220, overflow: "auto", margin: 0 }}>{gcode}</pre>
        </div>
      </div>
    </div>
  )
}
