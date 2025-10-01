import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyTransform } from "../lib/utils/transform2d";
import "./CameraPanel.css";

export default function CameraPanel({
  fiducials = [],
  xf,
  applyXf,
  selectedDesign,
  toolOffset,
  setToolOffset,
  nozzleDia,
  setNozzleDia,
  visionEnabled = false,
  qualityEnabled = false,
  padDetector,
  qualityController
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const [streamOn, setStreamOn] = useState(false);

  const [pairs, setPairs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("camPairs") || "[]"); } catch { return []; }
  });
  const [H, setH] = useState(() => {
    try { return JSON.parse(localStorage.getItem("camH") || "null"); } catch { return null; }
  });
  const [pendingPick, setPendingPick] = useState(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [lastClickPx, setLastClickPx] = useState(null);
  const [visionResult, setVisionResult] = useState(null);
  const [qualityResult, setQualityResult] = useState(null);
  const [autoDetecting, setAutoDetecting] = useState(false);

  // helpers for safe formatting
  const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "—");
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");

  useEffect(() => { localStorage.setItem("camPairs", JSON.stringify(pairs)); }, [pairs]);
  useEffect(() => { if (H) localStorage.setItem("camH", JSON.stringify(H)); }, [H]);

  const fidRows = useMemo(() => {
    return (fiducials || []).map(f => {
      // try design→machine via xf; if no design, use f.machine if present
      let world = null;
      if (f.machine && Number.isFinite(f.machine.x) && Number.isFinite(f.machine.y)) {
        world = { x: f.machine.x, y: f.machine.y };
      } else if (f.design && Number.isFinite(f.design.x) && Number.isFinite(f.design.y)) {
        world = (applyXf && xf) ? applyTransform(xf, f.design) : { ...f.design };
      }
      return { id: f.id, world, color: f.color || "#ff5555" };
    });
  }, [fiducials, xf, applyXf]);

  const solveHomography = useCallback((wp, pp) => {
    const n = wp.length;
    if (n < 4) return null;
    const A = new Array(2 * n).fill(0).map(() => new Array(8).fill(0));
    const b = new Array(2 * n).fill(0);
    for (let i = 0; i < n; i++) {
      const { x, y } = wp[i]; const { u, v } = pp[i];
      const r = 2 * i;
      A[r][0]=x; A[r][1]=y; A[r][2]=1; A[r][3]=0; A[r][4]=0; A[r][5]=0; A[r][6]=-u*x; A[r][7]=-u*y; b[r]=u;
      A[r+1][0]=0; A[r+1][1]=0; A[r+1][2]=0; A[r+1][3]=x; A[r+1][4]=y; A[r+1][5]=1; A[r+1][6]=-v*x; A[r+1][7]=-v*y; b[r+1]=v;
    }
    const AT = transpose(A);
    const ATA = matMul(AT, A);
    const ATb = vecMul(AT, b);
    const h = solveSymmetric(ATA, ATb);
    if (!h) return null;
    return [
      [h[0], h[1], h[2]],
      [h[3], h[4], h[5]],
      [h[6], h[7], 1   ],
    ];
  }, []);

  function transpose(M){const r=M.length,c=M[0].length,T=Array.from({length:c},()=>new Array(r));for(let i=0;i<r;i++)for(let j=0;j<c;j++)T[j][i]=M[i][j];return T;}
  function matMul(A,B){const r=A.length,k=A[0].length,c=B[0].length,M=Array.from({length:r},()=>new Array(c).fill(0));for(let i=0;i<r;i++){for(let j=0;j<c;j++){let s=0;for(let t=0;t<k;t++)s+=A[i][t]*B[t][j];M[i][j]=s;}}return M;}
  function vecMul(A,v){const r=A.length,c=A[0].length,out=new Array(r).fill(0);for(let i=0;i<r;i++){let s=0;for(let j=0;j<c;j++)s+=A[i][j]*v[j];out[i]=s;}return out;}
  function solveSymmetric(M,b){const n=M.length;const A=Array.from({length:n},(_,i)=>[...M[i],b[i]]);for(let i=0;i<n;i++){let piv=A[i][i];if(Math.abs(piv)<1e-12)return null;const inv=1/piv;for(let j=i;j<=n;j++)A[i][j]*=inv;for(let r=0;r<n;r++){if(r===i)continue;const f=A[r][i];for(let j=i;j<=n;j++)A[r][j]-=f*A[i][j];}}return A.map(row=>row[n]);}

  const projectPx = useCallback((pt) => {
    if (!H || !pt) return null;
    const { x, y } = pt;
    const u = H[0][0]*x + H[0][1]*y + H[0][2];
    const v = H[1][0]*x + H[1][1]*y + H[1][2];
    const w = H[2][0]*x + H[2][1]*y + H[2][2];
    if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null;
    return { u: u/w, v: v/w };
  }, [H]);

  const pxPerMmAt = useCallback((pt) => {
    if (!H || !pt) return null;
    const p0 = projectPx(pt), p1 = projectPx({ x: pt.x + 1, y: pt.y });
    if (!p0 || !p1) return null;
    return Math.hypot(p1.u - p0.u, p1.v - p0.v);
  }, [H, projectPx]);

  const predictedPx = useMemo(() => {
    if (!selectedDesign) return null;
    const m = (applyXf && xf) ? applyTransform(xf, selectedDesign) : { ...selectedDesign };
    const withTool = { x: m.x + (toolOffset?.dx || 0), y: m.y + (toolOffset?.dy || 0) };
    return projectPx(withTool);
  }, [selectedDesign, xf, applyXf, toolOffset, projectPx]);

  const rms = useMemo(() => {
    if (!H || !pairs.length) return null;
    let s2 = 0, n = 0;
    for (const p of pairs) {
      if (!p.pixel || !p.world) continue;
      const q = projectPx(p.world);
      if (!q) continue;
      const dx = q.u - p.pixel.u, dy = q.v - p.pixel.v;
      s2 += dx*dx + dy*dy; n++;
    }
    if (!n) return null;
    return Math.sqrt(s2 / n);
  }, [H, pairs, projectPx]);

  async function startCam() {
    if (streamOn) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      videoRef.current.srcObject = s;
      await videoRef.current.play();
      setStreamOn(true);
      tick();
    } catch (e) {
      console.error(e);
      alert("Could not start camera. Check permissions or device.");
    }
  }
  function stopCam() {
    const v = videoRef.current;
    if (v?.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
    setStreamOn(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  function tick(){ drawOverlay(); rafRef.current = requestAnimationFrame(tick); }

  function drawOverlay() {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    const W = v.clientWidth || v.videoWidth || 640;
    const Hh = v.clientHeight || v.videoHeight || 360;
    c.width = W; c.height = Hh;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, Hh);

    if (!showOverlay) return;

    // Draw vision detection result
    if (visionEnabled && visionResult && visionResult.detected) {
      const detectedPx = projectPx(visionResult.position);
      if (detectedPx) {
        ctx.beginPath();
        ctx.arc(detectedPx.u, detectedPx.v, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#00ff00';
        ctx.font = '12px Arial';
        ctx.fillText(`Detected (${visionResult.confidence.toFixed(2)})`, detectedPx.u + 10, detectedPx.v - 10);
      }
    }

    // Draw quality analysis result
    if (qualityEnabled && qualityResult) {
      const color = qualityResult.passed ? '#00ff00' : '#ff0000';
      ctx.fillStyle = color;
      ctx.font = '14px Arial';
      ctx.fillText(`Quality: ${(qualityResult.qualityScore * 100).toFixed(0)}%`, 10, 30);
      ctx.fillText(`Coverage: ${(qualityResult.coverage * 100).toFixed(0)}%`, 10, 50);
    }

    if (predictedPx) {
      const baseWorld = (applyXf && xf && selectedDesign) ? applyTransform(xf, selectedDesign) : (selectedDesign || { x:0, y:0 });
      const pxmm = pxPerMmAt(baseWorld) || 10;
      const r = Math.max(2, (nozzleDia || 0.6) * 0.5 * pxmm);

      ctx.beginPath();
      ctx.arc(predictedPx.u, predictedPx.v, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 215, 0, 0.18)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffd400";
      ctx.stroke();

      ctx.strokeStyle = "#00e0ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(predictedPx.u - r * 1.6, predictedPx.v);
      ctx.lineTo(predictedPx.u + r * 1.6, predictedPx.v);
      ctx.moveTo(predictedPx.u, predictedPx.v - r * 1.6);
      ctx.lineTo(predictedPx.u, predictedPx.v + r * 1.6);
      ctx.stroke();
    }

    if (measureMode && predictedPx && lastClickPx) {
      const dx = lastClickPx.u - predictedPx.u;
      const dy = lastClickPx.v - predictedPx.v;
      ctx.strokeStyle = "#ff4d4f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(predictedPx.u, predictedPx.v);
      ctx.lineTo(lastClickPx.u, lastClickPx.v);
      ctx.stroke();
      ctx.fillStyle = "#ff4d4f";
      ctx.font = "12px ui-monospace, monospace";
      const baseWorld = (applyXf && xf && selectedDesign) ? applyTransform(xf, selectedDesign) : (selectedDesign || { x:0, y:0 });
      const pxmm = pxPerMmAt(baseWorld) || 10;
      const mm = Math.hypot(dx, dy) / pxmm;
      ctx.fillText(`${mm.toFixed(3)} mm (${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`,
        predictedPx.u + 8, predictedPx.v - 8);
    }
  }

  function onCanvasClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const u = e.clientX - rect.left;
    const v = e.clientY - rect.top;

    if (pendingPick) {
      const fr = fidRows.find(f => f.id === pendingPick);
      // guard: don't store if no world coords
      if (!fr || !fr.world || !Number.isFinite(fr.world.x) || !Number.isFinite(fr.world.y)) {
        setPendingPick(null);
        alert("This fiducial has no world coordinates yet. Set fiducials first.");
        return;
      }
      const next = [...pairs.filter(p => p.id !== pendingPick), { id: fr.id, world: fr.world, pixel: { u, v } }];
      setPairs(next);
      setPendingPick(null);
      return;
    }

    if (measureMode) {
      setLastClickPx({ u, v });
    }
  }

  function addOrPick(fidId) {
    const fr = fidRows.find(f => f.id === fidId);
    if (!fr || !fr.world || !Number.isFinite(fr.world.x) || !Number.isFinite(fr.world.y)) {
      alert("This fiducial has no world coordinates yet. Set fiducials first.");
      return;
    }
    setPendingPick(fidId);
  }
  function clearPairs() {
    setPairs([]); setPendingPick(null); setH(null); setLastClickPx(null);
    localStorage.removeItem("camPairs"); localStorage.removeItem("camH");
  }

  // Vision-guided pad detection
  const detectPadAtPosition = async () => {
    if (!padDetector || !selectedDesign || !H) return;
    
    setAutoDetecting(true);
    try {
      padDetector.updateHomography(H);
      const result = await padDetector.detectPad(selectedDesign, { width: 1, height: 1 });
      setVisionResult(result);
      
      if (result && result.detected) {
        console.log('Pad detected at:', result.position, 'Offset:', result.offset);
      }
    } catch (error) {
      console.error('Pad detection failed:', error);
    } finally {
      setAutoDetecting(false);
    }
  };

  const analyzeQuality = async () => {
    if (!qualityController || !selectedDesign || !H) return;
    
    try {
      const canvas = canvasRef.current;
      const padInfo = {
        id: 'current',
        position: selectedDesign,
        size: { width: 1, height: 1 }
      };
      
      const result = await qualityController.analyzePasteQuality(canvas, padInfo, H);
      setQualityResult(result);
      
      if (result) {
        console.log('Quality analysis:', result);
      }
    } catch (error) {
      console.error('Quality analysis failed:', error);
    }
  };
  function solveNow() {
    const wp = [], pp = [];
    pairs.forEach(p => { if (p.world && p.pixel) { wp.push(p.world); pp.push(p.pixel); } });
    const Hm = solveHomography(wp, pp);
    if (!Hm) return alert("Need at least 4 valid pairs to solve.");
    setH(Hm);
  }

  return (
    <div className="panel camera-panel">
      <h3>Camera / Overlay Verification</h3>

      <div className="row wrap" style={{ gap: 12 }}>
        <div className="box" style={{ flex: 1, minWidth: 300 }}>
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#111", borderRadius: 8, overflow: "hidden" }}>
            <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
            <canvas ref={canvasRef}
              onClick={onCanvasClick}
              style={{ position: "absolute", inset: 0, pointerEvents: "auto" }} />
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            {!streamOn ? (
              <button className="btn" onClick={startCam}>Start Camera</button>
            ) : (
              <button className="btn secondary" onClick={stopCam}>Stop Camera</button>
            )}
            <label className="row" style={{ gap: 8, marginLeft: 8 }}>
              <input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} />
              Show overlay
            </label>
            <label className="row" style={{ gap: 8, marginLeft: 8 }}>
              <input type="checkbox" checked={measureMode} onChange={e => setMeasureMode(e.target.checked)} />
              Measure error
            </label>
            {visionEnabled && (
              <button className="btn sm" onClick={detectPadAtPosition} disabled={!selectedDesign || autoDetecting}>
                {autoDetecting ? 'Detecting...' : 'Detect Pad'}
              </button>
            )}
            {qualityEnabled && (
              <button className="btn sm" onClick={analyzeQuality} disabled={!selectedDesign}>
                Analyze Quality
              </button>
            )}
          </div>

          <div className="row wrap" style={{ gap: 12, marginTop: 8 }}>
            <div className="box">
              <legend>Nozzle</legend>
              <label className="row" style={{ gap: 8 }}>
                Diameter (mm)
                <input
                  type="number" step="0.05" value={nozzleDia ?? 0.6}
                  onChange={e => setNozzleDia(Math.max(0.05, +e.target.value || 0.6))}
                  style={{ width: 100 }}
                />
              </label>
            </div>
            <div className="box" style={{ minWidth: 150, marginLeft: -330, marginTop: 430 }}>
              <legend style={{fontWeight: 600, fontFamily: 'Arial, sans-serif'}}>Tool Offset</legend>
              <div className="row" style={{ gap: 8 }}>
                <div>
                  <span>ΔX (mm)</span>
                  <input type="number" step="0.01" value={toolOffset?.dx ?? 0}
                    onChange={e => setToolOffset({ dx: +e.target.value || 0, dy: toolOffset?.dy || 0 })} style={{ width: 100 }} />
                </div>
                <div>
                  <span>ΔY (mm)</span>
                  <input type="number" step="0.01" value={toolOffset?.dy ?? 0}
                    onChange={e => setToolOffset({ dx: toolOffset?.dx || 0, dy: +e.target.value || 0 })} style={{ width: 100 }} />
                </div>
              </div>
              <small>Offsets are added to machine XY before projecting to camera. Saved in your browser.</small>
            </div>
          </div>
        </div>

        <div className="box" style={{ minWidth: 400, marginLeft: -330, marginTop: 90 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Calibration (mm → pixels)</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
            Pick ≥4 fiducials: for each, click <em>Pick Pixel</em>, then click that same point on the video.
          </div>
          <div style={{ maxHeight: 260, overflow: "auto" }}>
            {fidRows.map(f => {
              const p = pairs.find(pp => pp.id === f.id);
              const u = p?.pixel?.u, v = p?.pixel?.v;
              const wx = f.world?.x, wy = f.world?.y;
              const hasWorld = Number.isFinite(wx) && Number.isFinite(wy);
              return (
                <div key={f.id} className="row" style={{ justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px dashed #e5e7eb" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: f.color }}>{f.id}</div>
                    <div style={{ fontSize: 12 }}>W: {f3(wx)}, {f3(wy)} mm</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12 }}>Px: {f1(u)}, {f1(v)}</div>
                    <button
                      className="btn sm"
                      onClick={() => addOrPick(f.id)}
                      disabled={!hasWorld}
                      title={!hasWorld ? "No world coordinates yet for this fiducial." : ""}
                    >
                      {pendingPick === f.id ? "Click video…" : "Pick Pixel"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn" disabled={(pairs.filter(p => p.pixel && p.world).length < 4)} onClick={solveNow}>Solve</button>
            <button className="btn secondary" onClick={clearPairs}>Clear</button>
          </div>

          <div style={{ marginTop: 10 }}>
            <div>Pairs: <b>{pairs.filter(p => p.pixel && p.world).length}</b> {H ? " | Solved ✓" : ""}</div>
            {H && <div>RMS error: <b>{f1(rms)} px</b></div>}
            
            {visionEnabled && visionResult && (
              <div style={{ marginTop: 8, padding: 8, background: '#f0f8ff', borderRadius: 4 }}>
                <div><strong>Vision Result:</strong></div>
                <div>Detected: {visionResult.detected ? '✓' : '✗'}</div>
                {visionResult.detected && (
                  <>
                    <div>Confidence: {(visionResult.confidence * 100).toFixed(0)}%</div>
                    <div>Offset: X{visionResult.offset.x.toFixed(3)}, Y{visionResult.offset.y.toFixed(3)}</div>
                  </>
                )}
              </div>
            )}
            
            {qualityEnabled && qualityResult && (
              <div style={{ marginTop: 8, padding: 8, background: qualityResult.passed ? '#f0fff0' : '#fff0f0', borderRadius: 4 }}>
                <div><strong>Quality Result:</strong></div>
                <div>Score: {(qualityResult.qualityScore * 100).toFixed(0)}% {qualityResult.passed ? '✓' : '✗'}</div>
                <div>Coverage: {(qualityResult.coverage * 100).toFixed(0)}%</div>
                <div>Volume: {(qualityResult.volume * 100).toFixed(0)}%</div>
                <div>Uniformity: {(qualityResult.uniformity * 100).toFixed(0)}%</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
