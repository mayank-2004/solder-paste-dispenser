import { useEffect, useState, useCallback, useMemo } from "react";
import JSZip from "jszip";

import LayerList from "./components/LayerList.jsx";
import Viewer from "./components/Viewer.jsx";
import CameraPanel from "./components/CameraPanel.jsx";
import SerialPanel from "./components/SerialPanel.jsx";
import ComponentList from "./components/ComponentList.jsx";
import LinearMovePanel from "./components/LinearMovePanel.jsx";
import FiducialPanel from "./components/FiducialPanel.jsx";

import { identifyLayers } from "./lib/gerber/identifyLayers.js";
import { stackupToSvg } from "./lib/gerber/stackupToSvg.js";
import { extractPadsMm } from "./lib/gerber/extractPads.js";
import { convertGerberToGcode } from "./lib/gerber/gerberToGcode.js";
import { zipTextFiles, downloadBlob } from "./lib/zip/zipUtils.js";

import { fitSimilarity, fitAffine, applyTransform, rmsError } from "./lib/utils/transform2d.js";

function padCenter(p) {
  if (typeof p.cx === "number" && typeof p.cy === "number") return { x: p.cx, y: p.cy };
  if (typeof p.x === "number" && typeof p.y === "number") {
    const isTopLeft = p.origin === "topleft" || p.topLeft === true || p.anchor === "tl";
    if (isTopLeft && (typeof p.width === "number" && typeof p.height === "number")) {
      return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
    }
    if (isTopLeft && (typeof p.w === "number" && typeof p.h === "number")) {
      return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    }
    return { x: p.x, y: p.y };
  }
  return { x: 0, y: 0 };
}

function clusterByRadius(points, radiusMm = 1.2) {
  const used = new Array(points.length).fill(false);
  const groups = [];
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const g = [points[i]]; used[i] = true;
    for (let j = i + 1; j < points.length; j++) {
      if (used[j]) continue;
      const d = Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
      if (d <= radiusMm) { g.push(points[j]); used[j] = true; }
    }
    groups.push(g);
  }
  return groups.map((g, idx) => {
    const cx = g.reduce((s, p) => s + p.x, 0) / g.length;
    const cy = g.reduce((s, p) => s + p.y, 0) / g.length;
    return { x: cx, y: cy, count: g.length, pads: g, id: `C${idx + 1}` };
  });
}

function parseLengthToMm(lenStr = "") {
  const m = String(lenStr).match(/^([\d.]+)\s*(mm|in)?$/i);
  if (!m) return null;
  const v = parseFloat(m[1]); const unit = (m[2] || "mm").toLowerCase();
  return unit === "in" ? v * 25.4 : v;
}

export default function App() {
  const [layers, setLayers] = useState([]);
  const [side, setSide] = useState("top");
  const [mirrorBottom, setMirrorBottom] = useState(true);
  const [svg, setSvg] = useState("");

  const [components, setComponents] = useState([]);
  const [pasteIdx, setPasteIdx] = useState(null);

  const [selectedMm, setSelectedMm] = useState(null);
  const [homeIdx, setHomeIdx] = useState(null);
  const [homeMm, setHomeMm] = useState(null);
  const [pairStats, setPairStats] = useState(null);

  const [zoomState, setZoomState] = useState({ enabled: false, isZoomed: false, baseViewBox: null, zoomFactor: 4, zoomPadding: 2 });

  const [fidPickMode, setFidPickMode] = useState(false);
  const [fidActiveId, setFidActiveId] = useState(null);
  const [fiducials, setFiducials] = useState([
    { id: "F1", design: null, machine: null, color: "#2ea8ff" },
    { id: "F2", design: null, machine: null, color: "#8e2bff" },
    { id: "F3", design: null, machine: null, color: "#00c49a" },
  ]);
  const [xf, setXf] = useState(null);
  const [applyXf, setApplyXf] = useState(false);

  const transformSummary = useMemo(() => {
    if (!xf) return null;
    const out = { type: xf.type, tx: xf.tx, ty: xf.ty };
    if (xf.type === "similarity") {
      out.thetaDeg = xf.theta * 180 / Math.PI;
      out.scale = xf.scale;
    }
    const pairs = fiducials.filter(f => f.design && f.machine);
    if (pairs.length >= 2) {
      out.rms = rmsError(xf, pairs.map(f => f.design), pairs.map(f => f.machine));
    }
    return out;
  }, [xf, fiducials]);

  const pickFiles = async (e) => handleFiles(e.target.files);
  const onDrop = async (e) => { e.preventDefault(); await handleFiles(e.dataTransfer.files); };

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    const zips = files.filter(f => /\.zip$/i.test(f.name));
    let expanded = files.filter(f => !/\.zip$/i.test(f.name));

    for (const zipFile of zips) {
      const zip = await JSZip.loadAsync(zipFile);
      const entries = Object.values(zip.files).filter(f => !f.dir);
      for (const ent of entries) {
        const text = await ent.async("text");
        expanded.push(new File([text], ent.name, { type: "text/plain" }));
      }
    }

    const read = await Promise.all(expanded.map(async f => ({ name: f.name, text: await f.text() })));
    const ls = identifyLayers(read);
    setLayers(ls);

    const pi = ls.findIndex(x => x.type === "solderpaste");
    setPasteIdx(pi >= 0 ? pi : null);
    if (pi >= 0) {
      const pads = extractPadsMm(ls[pi].text).map(padCenter);
      setComponents(clusterByRadius(pads, 1.2));
    } else setComponents([]);

    await rebuild(ls, side);

    setSelectedMm(null); setHomeIdx(null); setHomeMm(null); setPairStats(null);
    setZoomState(z => ({ ...z, isZoomed: false, baseViewBox: null }));
    setFiducials([
      { id: "F1", design: null, machine: null, color: "#2ea8ff" },
      { id: "F2", design: null, machine: null, color: "#8e2bff" },
      { id: "F3", design: null, machine: null, color: "#00c49a" },
    ]);
    setXf(null); setApplyXf(false);
    setFidPickMode(false); setFidActiveId(null);

    queueMicrotask(() => { updateOverlay(); });
  }

  async function rebuild(nextLayers = layers, s = side) {
    const ssvg = await stackupToSvg(nextLayers, s);
    setSvg(ssvg);
  }

  const toggleLayer = async (idx) => {
    const next = layers.map((l, i) => (i === idx ? { ...l, enabled: !l.enabled } : l));
    setLayers(next); await rebuild(next, side);
  };
  const changeSide = async (s) => { setSide(s); await rebuild(layers, s); setZoomState(z => ({ ...z, isZoomed: false })); };

  async function exportAllSvgsZip() {
    const outputs = [];
    for (const l of layers) {
      const only = [{ filename: l.filename, text: l.text, enabled: true }];
      const ssvg = await stackupToSvg(only, l.side || "top");
      const base = l.filename.replace(/\.[^.]+$/, "");
      outputs.push({ name: `${base}.svg`, text: ssvg });
    }
    const blob = await zipTextFiles(outputs);
    downloadBlob("layers_svg.zip", blob);
  }
  async function exportAllGcodeZip(flavor = "marlin") {
    const outputs = layers.map(l => {
      const gc = convertGerberToGcode(l.text, { flavor });
      const base = l.filename.replace(/\.[^.]+$/, "");
      return { name: `${base}.gcode`, text: gc };
    });
    const blob = await zipTextFiles(outputs);
    downloadBlob("layers_gcode.zip", blob);
  }

  const NS = "http://www.w3.org/2000/svg";
  const getSvgEl = useCallback(() => document.querySelector(".viewer .canvas svg"), []);
  const getCanvas = useCallback(() => document.querySelector(".viewer .canvas"), []);

  const getSvgGeom = useCallback(() => {
    const svgEl = getSvgEl(); if (!svgEl) return null;

    const vb = svgEl.getAttribute('viewBox'); if (!vb) return null;
    const [minX, minY, vbW, vbH] = vb.split(/\s+/).map(Number);

    const toMm = (val) => {
      if (!val) return null;
      const m = String(val).match(/^([\d.]+)\s*(mm|in|px)?$/i);
      if (!m) return null;
      const v = parseFloat(m[1]); const u = (m[2] || 'px').toLowerCase();
      if (u === 'mm') return v;
      if (u === 'in') return v * 25.4;
      if (u === 'px') return (v / 96) * 25.4;
      return null;
    };

    let mmPerUnit = 1;
    const wMm = toMm(svgEl.getAttribute('width'));
    if (wMm && vbW) mmPerUnit = wMm / vbW;
    else {
      const hMm = toMm(svgEl.getAttribute('height'));
      if (hMm && vbH) mmPerUnit = hMm / vbH;
      else mmPerUnit = 1; // fallback: treat 1 SVG unit as 1 mm
    }

    return { svgEl, minX, minY, vbW, vbH, mmPerUnit };
  }, [getSvgEl]);

  const mmToUnits = useCallback((ptMm) => {
    const svgEl = getSvgEl(); if (!svgEl) return null;

    const vb = svgEl.getAttribute('viewBox'); if (!vb) return null;
    const [currentMinX, currentMinY, currentW, currentH] = vb.split(/\s+/).map(Number);

    const geom = getSvgGeom(); if (!geom) return null;
    const originalX = ptMm.x / geom.mmPerUnit + geom.minX;
    const originalY = ptMm.y / geom.mmPerUnit + geom.minY;
    const currentScale = geom.vbW / currentW;
    const r = (1 / geom.mmPerUnit) * currentScale;

    return { x: originalX, y: originalY, r };
  }, [getSvgEl, getSvgGeom]);

  function ensureGroup(id) {
    const svgEl = getSvgEl(); if (!svgEl) return null;
    let g = svgEl.querySelector('#' + id);
    if (!g) {
      g = document.createElementNS(NS, "g");
      g.setAttribute("id", id);
      g.setAttribute("pointer-events", "none");
      svgEl.appendChild(g);
    }
    while (g.firstChild) g.removeChild(g.firstChild);
    return g;
  }

  const drawCircle = (g, x, y, r, fill, stroke) => {
    const c1 = document.createElementNS(NS, "circle");
    c1.setAttribute("cx", x); c1.setAttribute("cy", y); c1.setAttribute("r", r * 1.2);
    c1.setAttribute("fill", fill); g.appendChild(c1);
    const c2 = document.createElementNS(NS, "circle");
    c2.setAttribute("cx", x); c2.setAttribute("cy", y); c2.setAttribute("r", r);
    c2.setAttribute("fill", "none"); c2.setAttribute("stroke", stroke); c2.setAttribute("stroke-width", r * 0.25);
    g.appendChild(c2);
  };
  
  const drawText = (g, x, y, text, size, fill = "#000", stroke = "#fff") => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", x); t.setAttribute("y", y);
    t.setAttribute("fill", fill); t.setAttribute("font-size", String(size));
    t.setAttribute("paint-order", "stroke"); t.setAttribute("stroke", stroke);
    t.setAttribute("stroke-width", String(size * 0.2)); t.textContent = text;
    g.appendChild(t);
  };

  const updateOverlay = useCallback(() => {
    const gm = ensureGroup("overlay-markers"); if (!gm) return;

    if (homeMm) {
      const uh = mmToUnits(homeMm);
      if (uh) {
        drawCircle(gm, uh.x, uh.y, uh.r, "rgba(0,180,0,0.25)", "#0a0");
        drawText(gm, uh.x + uh.r * 1.6, uh.y - uh.r * 0.8, "HOME", uh.r * 1.3, "#0a0");
      }
    }
    if (selectedMm) {
      const uf = mmToUnits(selectedMm);
      if (uf) drawCircle(gm, uf.x, uf.y, uf.r, "rgba(255,0,0,0.25)", "#d00");
    }
    if (homeMm && selectedMm) {
      const uh = mmToUnits(homeMm), uf = mmToUnits(selectedMm);
      if (uh && uf) {
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", uh.x); line.setAttribute("y1", uh.y);
        line.setAttribute("x2", uf.x); line.setAttribute("y2", uf.y);
        line.setAttribute("stroke", "#ff0"); line.setAttribute("stroke-width", uh.r * 0.25);
        line.setAttribute("stroke-dasharray", `${uh.r * 0.8},${uh.r * 0.6}`);
        gm.appendChild(line);
        const midX = (uh.x + uf.x) / 2, midY = (uh.y + uf.y) / 2 - uh.r * 0.6;
        if (pairStats) drawText(gm, midX, midY, `${pairStats.dist.toFixed(2)} mm`, uh.r * 1.2, "#222", "#fffb");
      }
    }

    const gf = ensureGroup("overlay-fids"); if (!gf) return;
    fiducials.forEach(f => {
      if (!f.design) return;
      const u = mmToUnits(f.design); if (!u) return;
      drawCircle(gf, u.x, u.y, u.r, hexToRgba(f.color, 0.20), f.color);
      drawText(gf, u.x + u.r * 1.2, u.y - u.r * 0.8, f.id, u.r * 1.1, f.color);
    });

    if (xf) {
      const grect = ensureGroup("overlay-ghost");
      const geom = getSvgGeom(); if (!geom) return;
      const board = [
        { x: geom.minX * geom.mmPerUnit, y: geom.minY * geom.mmPerUnit },
        { x: (geom.minX + geom.vbW) * geom.mmPerUnit, y: geom.minY * geom.mmPerUnit },
        { x: (geom.minX + geom.vbW) * geom.mmPerUnit, y: (geom.minY + geom.vbH) * geom.mmPerUnit },
        { x: geom.minX * geom.mmPerUnit, y: (geom.minY + geom.vbH) * geom.mmPerUnit },
      ];
      const poly = document.createElementNS(NS, "polyline");
      const pts = board.map(p => applyTransform(xf, p)).map(mmToUnits).map(u => `${u.x},${u.y}`).join(" ");
      poly.setAttribute("points", pts + " " + pts.split(" ")[0]);
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "#00c4ff");
      const firstPoint = mmToUnits(board[0]);
      const strokeWidth = firstPoint ? firstPoint.r * 0.25 : (1 / (getSvgGeom()?.mmPerUnit || 1)) * 0.25;
      poly.setAttribute("stroke-width", strokeWidth);
      poly.setAttribute("stroke-dasharray", "6,6");
      grect.appendChild(poly);
    } else {
      ensureGroup("overlay-ghost");
    }
  }, [homeMm, selectedMm, pairStats, fiducials, xf, mmToUnits, getSvgGeom]);

  const hexToRgba = (hex, a = 0.3) => {
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return `rgba(${r},${g},${b},${a})`;
  };

  useEffect(() => { updateOverlay(); }, [updateOverlay]);
  useEffect(() => {
    if (homeMm && selectedMm) {
      const dx = selectedMm.x - homeMm.x;
      const dy = selectedMm.y - homeMm.y;
      const dist = Math.hypot(dx, dy);
      setPairStats({ dx, dy, dist });
    } else setPairStats(null);
  }, [homeMm, selectedMm]);

  const PROX_MM = 5;
  const getEventMm = (evt) => {
    const svgEl = getSvgEl(); if (!svgEl) return null;
    const geom = getSvgGeom(); if (!geom) return null;
    const pt = svgEl.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const ctm = svgEl.getScreenCTM(); if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: (local.x - geom.minX) * geom.mmPerUnit, y: (local.y - geom.minY) * geom.mmPerUnit };
  };

  function nearestPad(mm) {
    let best = { comp: -1, pad: -1, d: Infinity, pos: null };
    components.forEach((c, ci) => {
      c.pads.forEach((p, pi) => {
        const d = Math.hypot(p.x - mm.x, p.y - mm.y);
        if (d < best.d) best = { comp: ci, pad: pi, d, pos: p };
      });
    });
    return best.d <= PROX_MM ? best : null;
  }

  const [dragFid, setDragFid] = useState(null);
  useEffect(() => {
    const svgEl = getSvgEl(); if (!svgEl || !fidPickMode) return;

    const onDown = (e) => {
      const mm = getEventMm(e); if (!mm) return;
      let targetId = null;
      let best = { id: null, d: Infinity };
      for (const f of fiducials) {
        if (!f.design) continue;
        const d = Math.hypot(f.design.x - mm.x, f.design.y - mm.y);
        if (d < best.d) { best = { id: f.id, d }; }
      }
      if (best.d <= 2) targetId = best.id;
      else if (fidActiveId) targetId = fidActiveId;

      if (targetId) {
        setFiducials(prev => prev.map(f => f.id === targetId ? { ...f, design: mm } : f));
        setDragFid(targetId);
      }
    };
    const onMove = (e) => {
      if (!dragFid) return;
      const mm = getEventMm(e); if (!mm) return;
      setFiducials(prev => prev.map(f => f.id === dragFid ? { ...f, design: mm } : f));
    };
    const onUp = () => setDragFid(null);

    svgEl.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      svgEl.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [fidPickMode, fidActiveId, dragFid, fiducials, getSvgEl]);

  useEffect(() => {
    const svgEl = document.querySelector(".viewer .canvas svg");
    if (!svgEl) return;

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "viewBox") {
          updateOverlay();
          break;
        }
      }
    });

    obs.observe(svgEl, { attributes: true, attributeFilter: ["viewBox"] });
    return () => obs.disconnect();
  }, [svg, updateOverlay]);

  const handleCanvasClick = useCallback((evt) => {
    if (fidPickMode) return;
    if (zoomState.enabled) {
      const mm = getEventMm(evt); if (!mm) return;
      const hit = nearestPad(mm);
      if (hit) { setSelectedMm(hit.pos); zoomToComponent(hit.pos); }
      else if (zoomState.isZoomed) zoomOut();
      return;
    }

    const mm = getEventMm(evt); if (!mm) return;
    const hit = nearestPad(mm); if (!hit) return;

    if (!homeMm) {
      const ok = window.confirm(
        `Set this PAD as Home/origin?\n≈ X ${hit.pos.x.toFixed(2)} mm, Y ${hit.pos.y.toFixed(2)} mm`
      );
      if (ok) {
        setHomeIdx(hit.comp);
        setHomeMm({ x: hit.pos.x, y: hit.pos.y });
        setSelectedMm(null);
      }
      return;
    }

    const measure = window.confirm(
      `Measure distance from HOME to this PAD?\n≈ X ${hit.pos.x.toFixed(2)} mm, Y ${hit.pos.y.toFixed(2)} mm`
    );
    if (measure) {
      setSelectedMm({ x: hit.pos.x, y: hit.pos.y });
    }
  }, [
    fidPickMode,
    zoomState.enabled, zoomState.isZoomed,
    homeMm,
    components
  ]);

  const zoomToComponent = useCallback((ptMm) => {
    const svgEl = getSvgEl(); if (!svgEl) return;
    const viewBoxAttr = svgEl.getAttribute("viewBox"); if (!viewBoxAttr) return;
    const [minX, minY, w, h] = viewBoxAttr.split(/\s+/).map(Number);
    if (!zoomState.baseViewBox) setZoomState(prev => ({ ...prev, baseViewBox: { minX, minY, w, h } }));

    const geom = getSvgGeom(); if (!geom) return;
    const cx = ptMm.x / geom.mmPerUnit + geom.minX;
    const cy = ptMm.y / geom.mmPerUnit + geom.minY;

    const paddingUnits = zoomState.zoomPadding / geom.mmPerUnit;
    const cont = getCanvas();
    const ar = (cont?.clientWidth || 1) / (cont?.clientHeight || 1);
    let newW = (w / 1.8) + paddingUnits * 2;
    let newH = newW / ar;
    const base = zoomState.baseViewBox || { minX, minY, w, h };
    let newMinX = Math.max(Math.min(cx - newW / 2, base.minX + base.w - newW), base.minX);
    let newMinY = Math.max(Math.min(cy - newH / 2, base.minY + base.h - newH), base.minY);
    svgEl.setAttribute("viewBox", `${newMinX} ${newMinY} ${newW} ${newH}`);
    setZoomState(prev => ({ ...prev, isZoomed: true }));

    updateOverlay();
  }, [getSvgEl, getSvgGeom, zoomState.baseViewBox, zoomState.zoomPadding, updateOverlay]);

  const zoomOut = useCallback(() => {
    const svgEl = getSvgEl(); if (!svgEl || !zoomState.baseViewBox) return;
    const { minX, minY, w, h } = zoomState.baseViewBox;
    svgEl.setAttribute("viewBox", `${minX} ${minY} ${w} ${h}`);
    setZoomState(prev => ({ ...prev, isZoomed: false }));

    updateOverlay();
  }, [getSvgEl, zoomState.baseViewBox, updateOverlay]);

  const onInputMachine = (id, partial) => {
    setFiducials(prev => prev.map(f => f.id === id ? { ...f, machine: { x: (partial.x ?? f.machine?.x ?? null), y: (partial.y ?? f.machine?.y ?? null) } } : f));
  };
  const onClearOne = (id) => setFiducials(prev => prev.map(f => f.id === id ? { ...f, design: null, machine: null } : f));
  const onClearAll = () => { setFiducials(prev => prev.map(f => ({ ...f, design: null, machine: null }))); setXf(null); };

  const onSolve2 = () => {
    const P = fiducials.filter(f => f.design && f.machine);
    if (P.length < 2) return;
    const T = fitSimilarity(P.map(f => f.design), P.map(f => f.machine));
    setXf(T);
  };
  const onSolve3 = () => {
    const P = fiducials.filter(f => f.design && f.machine);
    if (P.length < 3) return;
    const T = fitAffine(P.map(f => f.design), P.map(f => f.machine));
    setXf(T);
  };

  return (
    <div className="wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <aside className="sidebar">
        <div className="header">
          <label className="btn">
            Open Gerbers / ZIP
            <input type="file" multiple onChange={pickFiles}
              accept=".zip,.gbr,.grb,.gtl,.gbl,.gts,.gbs,.gto,.gbo,.gtp,.gbp,.gm1,.drl,.txt,.nc" />
          </label>
          <button className="btn secondary" onClick={exportAllSvgsZip}>Download SVGs (ZIP)</button>
        </div>

        <div className="section">
          <h3>Board View</h3>
          <div className="row">
            <button className="btn secondary" onClick={() => changeSide("top")}>Top</button>
            <button className="btn secondary" onClick={() => changeSide("bottom")}>Bottom</button>
            <label><input type="checkbox" checked={mirrorBottom} onChange={(e) => setMirrorBottom(e.target.checked)} /> Mirror bottom</label>
          </div>
          <LayerList layers={layers} onToggle={toggleLayer} />
        </div>

        <div className="section">
          <h3>G-code</h3>
          <div className="row">
            <button className="btn" onClick={() => exportAllGcodeZip("marlin")}>Export G-code (Marlin ZIP)</button>
            <button className="btn secondary" onClick={() => exportAllGcodeZip("grbl")}>Export G-code (GRBL ZIP)</button>
          </div>
        </div>

        <div className="section">
          <h3>Components</h3>
          <div className="row">
            <select value={pasteIdx ?? ""} onChange={(e) => {
              const idx = e.target.value === "" ? null : +e.target.value;
              setPasteIdx(idx);
              if (idx != null) {
                const pads = extractPadsMm(layers[idx].text).map(padCenter);
                setComponents(clusterByRadius(pads, 1.2));
              } else setComponents([]);
              setSelectedMm(null); setHomeMm(null);
            }}>
              <option value="">(select paste layer)</option>
              {layers.map((l, i) => l.type === "solderpaste" ? <option key={l.filename} value={i}>{l.filename}</option> : null)}
            </select>
          </div>
          <ComponentList
            components={components}
            originIdx={homeIdx}
            onSetHome={(i) => {
              const comp = components[i]; if (!comp) return;
              const pad = comp.pads[0] || { x: comp.x, y: comp.y };
              setHomeIdx(i); setHomeMm({ x: pad.x, y: pad.y });
            }}
            onFocus={(c) => {
              const pad = c.pads?.[0] || { x: c.x, y: c.y };
              setSelectedMm({ x: pad.x, y: pad.y });
            }}
          />
        </div>
      </aside>

      <main className="main">
        <div className="section"><h3>Preview</h3></div>

        <Viewer
          svg={svg}
          mirrorBottom={mirrorBottom}
          side={side}
          onClickSvg={handleCanvasClick}
          zoomEnabled={zoomState.enabled}
          isZoomed={zoomState.isZoomed}
          onToggleZoom={() => setZoomState(z => ({ ...z, enabled: !z.enabled }))}
          onZoomOut={zoomOut}
        />

        {pairStats && (
          <div className="distance-info">
            <span className="badge">Distance</span>
            <div className="kvs">
              <span>ΔX: {pairStats.dx.toFixed(2)} mm</span>
              <span>ΔY: {pairStats.dy.toFixed(2)} mm</span>
              <span><strong>{pairStats.dist.toFixed(2)} mm</strong></span>
            </div>
          </div>
        )}

        <FiducialPanel
          fiducials={fiducials}
          activeId={fidActiveId}
          setActiveId={setFidActiveId}
          pickMode={fidPickMode}
          togglePickMode={() => setFidPickMode(v => !v)}
          onInputMachine={onInputMachine}
          onClearOne={onClearOne}
          onClearAll={onClearAll}
          onSolve2={onSolve2}
          onSolve3={onSolve3}
          transformSummary={transformSummary}
          applyTransform={applyXf}
          setApplyTransform={setApplyXf}
        />

        <div className="panels">
          <CameraPanel />
          <LinearMovePanel />
          <SerialPanel />
        </div>
      </main>
    </div>
  );
}