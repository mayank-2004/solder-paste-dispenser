import { useEffect, useState, useCallback, useMemo } from "react";
import JSZip from "jszip";
import "./App.css";

import LayerList from "./components/LayerList.jsx";
import Viewer from "./components/Viewer.jsx";
import CameraPanel from "./components/CameraPanel.jsx";
import SerialPanel from "./components/SerialPanel.jsx";
import ComponentList from "./components/ComponentList.jsx";
import LinearMovePanel from "./components/LinearMovePanel.jsx";
import FiducialPanel from "./components/FiducialPanel.jsx";
import PressurePanel from "./components/PressurePanel.jsx";
import SpeedPanel from "./components/SpeedPanel.jsx";
import AutomatedDispensingPanel from "./components/AutomatedDispensingPanel.jsx";
import { identifyLayers } from "./lib/gerber/identifyLayers.js";
import { stackupToSvg } from "./lib/gerber/stackupToSvg.js";
import { extractPadsMm } from "./lib/gerber/extractPads.js";
import { convertGerberToGcode } from "./lib/gerber/gerberToGcode.js";
import { analyzeFiducialsInLayers } from "./lib/gerber/fiducialDetection.js";
import { detectPcbOrigins } from "./lib/gerber/originDetection.js";
import { FiducialVisionDetector } from "./lib/vision/fiducialVision.js";
import { zipTextFiles, downloadBlob } from "./lib/zip/zipUtils.js";
import { fitSimilarity, fitAffine, applyTransform, rmsError } from "./lib/utils/transform2d.js";
import { CollisionDetector } from "./lib/collision/collisionDetection.js";
import { PadDetector } from "./lib/vision/padDetection.js";
import { QualityController } from "./lib/quality/qualityControl.js";
import { UndoRedoManager } from "./lib/history/undoRedo.js";
import { NozzleMaintenanceManager } from "./lib/maintenance/nozzleMaintenance.js";
import { generatePath } from "./lib/motion/pathGeneration.js";
import { combinePadLayers, getAvailableLayerCombinations } from "./lib/gerber/padCombiner.js";
import { PressureController, VISCOSITY_TYPES } from "./lib/pressure/pressureControl.js";
import { SpeedProfileManager } from "./lib/speed/speedProfiles.js";
import { PasteVisualizer } from "./lib/paste/pasteVisualization.js";
import { extractBoardOutline } from "./lib/gerber/boardOutline.js";
import { DispensingSequencer } from "./lib/automation/dispensingSequence.js";
import { SafePathPlanner } from "./lib/automation/safePathPlanner.js";

function padCenter(p) {
  console.log('Processing pad for center:', p);
  
  // If already has center coordinates
  if (typeof p.cx === "number" && typeof p.cy === "number") {
    console.log('Using cx/cy:', { x: p.cx, y: p.cy });
    return { x: p.cx, y: p.cy };
  }
  
  // If has x/y coordinates
  if (typeof p.x === "number" && typeof p.y === "number") {
    const isTopLeft = p.origin === "topleft" || p.topLeft === true || p.anchor === "tl";
    
    // If top-left origin with dimensions, calculate center
    if (isTopLeft && (typeof p.width === "number" && typeof p.height === "number")) {
      const center = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
      console.log('Calculated center from top-left + dimensions:', center);
      return center;
    }
    if (isTopLeft && (typeof p.w === "number" && typeof p.h === "number")) {
      const center = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
      console.log('Calculated center from top-left + w/h:', center);
      return center;
    }
    
    // Assume x/y is already center
    console.log('Using x/y as center:', { x: p.x, y: p.y });
    return { x: p.x, y: p.y };
  }
  
  console.log('No valid coordinates, using default:', { x: 0, y: 0 });
  return { x: 0, y: 0 };
}

function processPads(points) {
  return points.map((pad, idx) => ({
    x: pad.x,
    y: pad.y,
    id: `P${idx + 1}`,
    width: pad.width || 1,
    height: pad.height || 1
  }));
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

  const [pads, setPads] = useState([]);
  const [pasteIdx, setPasteIdx] = useState(null);

  const [selectedMm, setSelectedMm] = useState(null);
  const [padDistances, setPadDistances] = useState([]);
  const [generatedPath, setGeneratedPath] = useState(null);
  const [pathType, setPathType] = useState('direct'); // 'direct', 'safe', 'optimized'

  const [zoomState, setZoomState] = useState({ 
    enabled: false, 
    isZoomed: false, 
    baseViewBox: null, 
    zoomLevel: 0, // 0 = normal, 1 = 2x, 2 = 4x, 3 = 8x
    maxZoomLevel: 3,
    zoomPadding: 2 
  });

  const [fidPickMode, setFidPickMode] = useState(false);
  const [fidActiveId, setFidActiveId] = useState(null);
  const [fiducials, setFiducials] = useState([
    { id: "F1", design: null, machine: null, color: "#2ea8ff" },
    { id: "F2", design: null, machine: null, color: "#8e2bff" },
    { id: "F3", design: null, machine: null, color: "#00c49a" },
  ]);
  const [fiducialDetectionResult, setFiducialDetectionResult] = useState(null);
  const [originCandidates, setOriginCandidates] = useState([]);
  const [selectedOrigin, setSelectedOrigin] = useState(null);
  const [referencePoint, setReferencePoint] = useState(null); // Can be origin or fiducial
  const [referenceType, setReferenceType] = useState('origin'); // 'origin' or 'fiducial'
  const [xf, setXf] = useState(null);
  const [applyXf, setApplyXf] = useState(false);

  // New feature states
  const [collisionDetector] = useState(() => new CollisionDetector());
  const [padDetector] = useState(() => new PadDetector());
  const [qualityController] = useState(() => new QualityController());
  const [undoManager] = useState(() => new UndoRedoManager());
  const [maintenanceManager] = useState(() => new NozzleMaintenanceManager());
  const [fiducialVisionDetector] = useState(() => new FiducialVisionDetector());
  const [pressureController] = useState(() => new PressureController());
  const [speedProfileManager] = useState(() => new SpeedProfileManager());
  const [pasteVisualizer] = useState(() => new PasteVisualizer());
  const [dispensingSequencer] = useState(() => new DispensingSequencer());
  const [safePathPlanner] = useState(() => new SafePathPlanner());
  const [showPasteDots, setShowPasteDots] = useState(false);
  const [boardOutline, setBoardOutline] = useState(null);
  const [dispensingSequence, setDispensingSequence] = useState([]);
  const [safeSequence, setSafeSequence] = useState([]);
  const [jobStatistics, setJobStatistics] = useState(null);
  const [useSafePathPlanning, setUseSafePathPlanning] = useState(true);
  const [componentHeights, setComponentHeights] = useState([]);
  // const [visionEnabled, setVisionEnabled] = useState(false);
  // const [qualityEnabled, setQualityEnabled] = useState(false);
  const [maintenanceAlert, setMaintenanceAlert] = useState(null);
  const [toolOffset, setToolOffset] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("toolOffset") || '{"dx": 0, "dy": 0');
    } catch (error) {
      return { dx: 0, dy: 0 };
    }
  });

  const [pcbOriginOffset, setPcbOriginOffset] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pcbOriginOffset") || '{"x": 0, "y": 0');
    } catch (error) {
      return { x: 0, y: 0 };
    }
  });

  useEffect(() => {
    localStorage.setItem("toolOffset", JSON.stringify(toolOffset));
  }, [toolOffset]);

  useEffect(() => {
    localStorage.setItem("pcbOriginOffset", JSON.stringify(pcbOriginOffset));
  }, [pcbOriginOffset]);
  useEffect(() => {
    maintenanceManager.setReminderCallback((alert) => {
      setMaintenanceAlert(alert);
    });
  }, [maintenanceManager]);

  // Save state for undo/redo
  const saveStateForUndo = (action) => {
    const state = {
      layers, side, mirrorBottom, pads, pasteIdx, selectedMm,
      fiducials, xf, applyXf, toolOffset, nozzleDia
    };
    undoManager.saveState(state, action);
  };

  // Undo function
  const handleUndo = () => {
    const previousState = undoManager.undo();
    if (previousState) {
      setLayers(previousState.layers || []);
      setSide(previousState.side || 'top');
      setMirrorBottom(previousState.mirrorBottom ?? true);
      setPads(previousState.pads || []);
      setPasteIdx(previousState.pasteIdx);
      setSelectedMm(previousState.selectedMm);
      setFiducials(previousState.fiducials || []);
      setXf(previousState.xf);
      setApplyXf(previousState.applyXf || false);
      setToolOffset(previousState.toolOffset || { dx: 0, dy: 0 });
      setNozzleDia(previousState.nozzleDia || 0.6);
    }
  };

  // Redo function
  const handleRedo = () => {
    const nextState = undoManager.redo();
    if (nextState) {
      setLayers(nextState.layers || []);
      setSide(nextState.side || 'top');
      setMirrorBottom(nextState.mirrorBottom ?? true);
      setPads(nextState.pads || []);
      setPasteIdx(nextState.pasteIdx);
      setSelectedMm(nextState.selectedMm);
      setFiducials(nextState.fiducials || []);
      setXf(nextState.xf);
      setApplyXf(nextState.applyXf || false);
      setToolOffset(nextState.toolOffset || { dx: 0, dy: 0 });
      setNozzleDia(nextState.nozzleDia || 0.6);
    }
  };

  const [nozzleDia, setNozzleDia] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nozzleDia") || "0.6");
    } catch (error) {
      return 0.6;
    }
  });

  const [pressureSettings, setPressureSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pressureSettings") || '{"viscosity": "medium", "customPressure": 25, "customDwellTime": 120}');
    } catch (error) {
      return { viscosity: "medium", customPressure: 25, customDwellTime: 120 };
    }
  });

  const [speedSettings, setSpeedSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("speedSettings") || '{"autoAdjust": true, "globalMultiplier": 1.0}');
    } catch (error) {
      return { autoAdjust: true, globalMultiplier: 1.0 };
    }
  });

  useEffect(() => {
    localStorage.setItem("nozzleDia", JSON.stringify(nozzleDia));
  }, [nozzleDia]);

  useEffect(() => {
    localStorage.setItem("pressureSettings", JSON.stringify(pressureSettings));
  }, [pressureSettings]);

  useEffect(() => {
    localStorage.setItem("speedSettings", JSON.stringify(speedSettings));
  }, [speedSettings]);

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

  // Verify coordinate transformation
  const verifyTransform = useCallback((designPt) => {
    if (!xf || !applyXf) return designPt;
    const transformed = applyTransform(xf, designPt);
    console.log(`Transform verification: Design(${designPt.x.toFixed(3)}, ${designPt.y.toFixed(3)}) → Machine(${transformed.x.toFixed(3)}, ${transformed.y.toFixed(3)})`);
    return transformed;
  }, [xf, applyXf]);

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
      const padData = extractPadsMm(ls[pi].text).map(padCenter);
      setPads(processPads(padData));
    } else setPads([]);

    // Detect fiducials automatically
    const detectedFiducials = analyzeFiducialsInLayers(ls);
    setFiducialDetectionResult(detectedFiducials);

    // Detect board outline if available
    const outlineLayer = ls.find(l => l.filename.toLowerCase().includes('outline') || l.filename.toLowerCase().includes('edge'));
    if (outlineLayer) {
      const outline = extractBoardOutline(outlineLayer.text);
      setBoardOutline(outline);
      console.log('Board outline detected:', outline);
    }

    // Detect origin candidates
    const origins = detectPcbOrigins(ls);
    console.log('Detected origins:', origins);
    setOriginCandidates(origins);
    if (origins.length > 0) {
      const origin = { ...origins[0], id: 'O1' };
      console.log('Setting selected origin:', origin);
      setSelectedOrigin(origin); // Auto-select bottom-left origin
      setPcbOriginOffset({ x: origin.x, y: origin.y });
    }

    if (detectedFiducials.length > 0) {
      // Auto-populate fiducials with detected positions
      const colors = ["#2ea8ff", "#8e2bff", "#00c49a", "#ff6b35", "#9c27b0", "#4caf50"];
      const autoFiducials = detectedFiducials.map((fid, idx) => ({
        id: fid.id,
        design: { x: fid.x, y: fid.y },
        machine: null,
        color: colors[idx % colors.length],
        confidence: fid.confidence
      }));

      // Fill remaining slots with empty fiducials
      while (autoFiducials.length < 3) {
        autoFiducials.push({
          id: `F${autoFiducials.length + 1}`,
          design: null,
          machine: null,
          color: colors[autoFiducials.length % colors.length]
        });
      }

      setFiducials(autoFiducials);
    } else {
      // No fiducials detected, use default empty ones
      setFiducials([
        { id: "F1", design: null, machine: null, color: "#2ea8ff" },
        { id: "F2", design: null, machine: null, color: "#8e2bff" },
        { id: "F3", design: null, machine: null, color: "#00c49a" },
      ]);
      setFiducialDetectionResult([]);
    }

    await rebuild(ls, side);

    setSelectedMm(null);
    setZoomState(z => ({ ...z, isZoomed: false, baseViewBox: null }));
    setXf(null); setApplyXf(false);
    setFidPickMode(false); setFidActiveId(null);
    // Don't clear origin candidates and selectedOrigin here - they were just set above
    
    queueMicrotask(() => { updateOverlay(); });

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
  const changeSide = async (s) => {
    saveStateForUndo(`Change side to ${s}`);
    setSide(s);
    await rebuild(layers, s);
    setZoomState(z => ({ ...z, isZoomed: false }));
  };

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
      const v = parseFloat(m[1]);
      const u = (m[2] || 'px').toLowerCase();
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
    }

    return { svgEl, minX, minY, vbW, vbH, mmPerUnit };
  }, [getSvgEl]);

  const mmToUnits = useCallback((ptMm) => {
    const g = getSvgGeom(); if (!g) return null;
    return {
      x: ptMm.x / g.mmPerUnit + g.minX,
      y: ptMm.y / g.mmPerUnit + g.minY,
      r: 1 / g.mmPerUnit,
      _vb: g
    };
  }, [getSvgGeom]);

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

  const inView = (u) => {
    if (!u || !u._vb) return false;
    const { minX, minY, vbW, vbH } = u._vb;
    return u.x >= minX && u.x <= (minX + vbW) && u.y >= minY && u.y <= (minY + vbH);
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
    t.setAttribute("stroke-width", String(size * 0.2)); t.textContent = String(text || '');
    g.appendChild(t);
  };

  const updateOverlay = useCallback(() => {
    const gm = ensureGroup("overlay-markers"); if (!gm) return;
    const svgEl = getSvgEl(); if (!svgEl) return;

    // Always get fresh geometry from current viewBox
    const geom = getSvgGeom(); if (!geom) return;

    // Helper to convert mm to current viewBox units
    const mmToCurrentUnits = (ptMm) => {
      return {
        x: ptMm.x / geom.mmPerUnit + geom.minX,
        y: ptMm.y / geom.mmPerUnit + geom.minY,
        r: 1 / geom.mmPerUnit
      };
    };

    // Draw reference point (origin or fiducial)
    const activeRef = referencePoint || selectedOrigin;
    if (activeRef) {
      const uh = mmToCurrentUnits({ x: activeRef.x, y: activeRef.y });
      const isOrigin = activeRef === selectedOrigin;
      const color = isOrigin ? "#0a0" : "#ff6600";
      const label = isOrigin ? "TOP-LEFT ORIGIN" : `REF: ${activeRef.id || 'FIDUCIAL'}`;
      drawCircle(gm, uh.x, uh.y, uh.r, isOrigin ? "rgba(0,180,0,0.25)" : "rgba(255,102,0,0.25)", color);
      drawText(gm, uh.x + uh.r * 1.6, uh.y - uh.r * 0.8, label, uh.r * 1.0, color);
    }

    if (selectedMm) {
      // Find the selected pad to draw border around it
      const selectedPad = pads.find(p => Math.abs(p.x - selectedMm.x) < 0.1 && Math.abs(p.y - selectedMm.y) < 0.1);
      if (selectedPad) {
        
        // Use actual pad center coordinates from the pad object
        const padCenter = { x: selectedPad.x, y: selectedPad.y };
        const u = mmToCurrentUnits(padCenter);
        
        // Calculate marker radius based on actual pad dimensions
        const padWidth = selectedPad.width || 1.0;
        const padHeight = selectedPad.height || 1.0;
        const maxDimension = Math.max(padWidth, padHeight);
        
        // Marker radius should be slightly larger than the pad (110% of max dimension)
        const markerRadius = (maxDimension * 1) / geom.mmPerUnit;
        
        // Draw border circle centered on actual pad center
        const circle = document.createElementNS(NS, "circle");
        circle.setAttribute("cx", u.x);
        circle.setAttribute("cy", u.y);
        circle.setAttribute("r", markerRadius);
        circle.setAttribute("fill", "none");
        circle.setAttribute("stroke", "#ff0000");
        circle.setAttribute("stroke-width", markerRadius * 0.08);
        circle.setAttribute("stroke-dasharray", "3,3");
        gm.appendChild(circle);
        
        // Draw center crosshair at actual pad center
        const crossSize = (maxDimension * 0.3) / geom.mmPerUnit;
        const hLine = document.createElementNS(NS, "line");
        hLine.setAttribute("x1", u.x - crossSize);
        hLine.setAttribute("y1", u.y);
        hLine.setAttribute("x2", u.x + crossSize);
        hLine.setAttribute("y2", u.y);
        hLine.setAttribute("stroke", "#ff0000");
        hLine.setAttribute("stroke-width", markerRadius * 0.06);
        gm.appendChild(hLine);
        
        const vLine = document.createElementNS(NS, "line");
        vLine.setAttribute("x1", u.x);
        vLine.setAttribute("y1", u.y - crossSize);
        vLine.setAttribute("x2", u.x);
        vLine.setAttribute("y2", u.y + crossSize);
        vLine.setAttribute("stroke", "#ff0000");
        vLine.setAttribute("stroke-width", markerRadius * 0.06);
        gm.appendChild(vLine);
        
        // Add center dot for precise center indication
        const centerDot = document.createElementNS(NS, "circle");
        centerDot.setAttribute("cx", u.x);
        centerDot.setAttribute("cy", u.y);
        centerDot.setAttribute("r", markerRadius * 0.15);
        centerDot.setAttribute("fill", "#ff0000");
        gm.appendChild(centerDot);
        
        // Draw paste visualization dots if enabled
        if (showPasteDots) {
          const pasteDots = pasteVisualizer.calculateDotPattern(selectedPad, nozzleDia);
          pasteDots.forEach((dot, idx) => {
            const dotU = mmToCurrentUnits({ x: dot.x, y: dot.y });
            const dotRadius = (nozzleDia * 0.3) / geom.mmPerUnit; // Smaller dots
            
            const pasteCircle = document.createElementNS(NS, "circle");
            pasteCircle.setAttribute("cx", dotU.x);
            pasteCircle.setAttribute("cy", dotU.y);
            pasteCircle.setAttribute("r", dotRadius);
            pasteCircle.setAttribute("fill", "rgba(0, 200, 0, 0.7)");
            pasteCircle.setAttribute("stroke", "#008800");
            pasteCircle.setAttribute("stroke-width", dotRadius * 0.15);
            gm.appendChild(pasteCircle);
            
            // Add dot number (smaller text)
            const dotText = document.createElementNS(NS, "text");
            dotText.setAttribute("x", dotU.x);
            dotText.setAttribute("y", dotU.y + dotRadius * 0.2);
            dotText.setAttribute("text-anchor", "middle");
            dotText.setAttribute("font-size", dotRadius * 0.6);
            dotText.setAttribute("fill", "#ffffff");
            dotText.setAttribute("font-weight", "bold");
            dotText.textContent = idx + 1;
            gm.appendChild(dotText);
          });
        }
      }
    }

    // Draw generated path
    if (generatedPath && activeRef && selectedMm) {
      const gp = ensureGroup("overlay-path");
      
      // Draw path segments
      generatedPath.segments.forEach((segment, idx) => {
        const start = mmToCurrentUnits(segment.start);
        const end = mmToCurrentUnits(segment.end);
        
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", start.x); line.setAttribute("y1", start.y);
        line.setAttribute("x2", end.x); line.setAttribute("y2", end.y);
        
        // Different colors for different segment types
        const color = segment.type === 'lift' ? '#00ff00' : 
                     segment.type === 'travel' ? '#0080ff' :
                     segment.type === 'lower' ? '#ff8000' : '#ff0';
        
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", start.r * 0.3);
        line.setAttribute("stroke-dasharray", segment.type === 'travel' ? "4,2" : "none");
        gp.appendChild(line);
      });
      
      // Draw waypoints
      generatedPath.points.forEach((point, idx) => {
        if (point.type === 'waypoint') {
          const up = mmToCurrentUnits(point);
          drawCircle(gp, up.x, up.y, up.r * 0.5, "rgba(255,165,0,0.3)", "#ffa500");
        }
      });
      
      // Draw distance label
      const start = mmToCurrentUnits({ x: activeRef.x, y: activeRef.y });
      const end = mmToCurrentUnits(selectedMm);
      const midX = (start.x + end.x) / 2, midY = (start.y + end.y) / 2 - start.r * 0.6;
      drawText(gp, midX, midY, `${generatedPath.totalDistance.toFixed(2)} mm`, start.r * 1.2, "#222", "#fffb");
    } else if (activeRef && selectedMm) {
      // Fallback to simple line if no path generated
      const uh = mmToCurrentUnits({ x: activeRef.x, y: activeRef.y });
      const uf = mmToCurrentUnits(selectedMm);
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", uh.x); line.setAttribute("y1", uh.y);
      line.setAttribute("x2", uf.x); line.setAttribute("y2", uf.y);
      line.setAttribute("stroke", "#ff0"); line.setAttribute("stroke-width", uh.r * 0.25);
      line.setAttribute("stroke-dasharray", `${uh.r * 0.8},${uh.r * 0.6}`);
      gm.appendChild(line);
      
      const dx = selectedMm.x - activeRef.x;
      const dy = selectedMm.y - activeRef.y;
      const dist = Math.hypot(dx, dy);
      console.log('Distance calculation:', { dx, dy, dist, selectedMm, activeRef });
      const midX = (uh.x + uf.x) / 2, midY = (uh.y + uf.y) / 2 - uh.r * 0.6;
      drawText(gm, midX, midY, `${dist.toFixed(2)} mm`, uh.r * 1.2, "#222", "#fffb");
    }

    const gf = ensureGroup("overlay-fids");
    fiducials.forEach(f => {
      if (!f.design) return;
      const u = mmToCurrentUnits(f.design);
      if (u.x >= geom.minX && u.x <= (geom.minX + geom.vbW) &&
        u.y >= geom.minY && u.y <= (geom.minY + geom.vbH)) {
        drawCircle(gf, u.x, u.y, u.r, hexToRgba(f.color, 0.20), f.color);
        drawText(gf, u.x + u.r * 1.2, u.y - u.r * 0.8, f.id, u.r * 1.1, f.color);
      }
    });

    // Draw selected origin point
    if (selectedOrigin) {
      console.log('Drawing origin overlay:', selectedOrigin);
      const go = ensureGroup("overlay-origin");
      const uo = mmToCurrentUnits({ x: selectedOrigin.x, y: selectedOrigin.y });
      console.log('Origin units:', uo, 'geom:', geom);
      
      // Always draw origin, ignore bounds check for debugging
      const size = uo.r * 1.5;
      const cross1 = document.createElementNS(NS, "line");
      cross1.setAttribute("x1", uo.x - size); cross1.setAttribute("y1", uo.y);
      cross1.setAttribute("x2", uo.x + size); cross1.setAttribute("y2", uo.y);
      cross1.setAttribute("stroke", "#ff4500"); cross1.setAttribute("stroke-width", uo.r * 0.3);
      go.appendChild(cross1);
      
      const cross2 = document.createElementNS(NS, "line");
      cross2.setAttribute("x1", uo.x); cross2.setAttribute("y1", uo.y - size);
      cross2.setAttribute("x2", uo.x); cross2.setAttribute("y2", uo.y + size);
      cross2.setAttribute("stroke", "#ff4500"); cross2.setAttribute("stroke-width", uo.r * 0.3);
      go.appendChild(cross2);
      
      drawCircle(go, uo.x, uo.y, uo.r * 0.8, "rgba(255,69,0,0.15)", "#ff4500");
      drawText(go, uo.x + uo.r * 1.8, uo.y - uo.r * 0.8, "TOP-LEFT", uo.r * 1.0, "#ff4500");
      console.log('Origin marker drawn at:', uo.x, uo.y);
    } else {
      console.log('No selectedOrigin to draw');
    }

    if (xf) {
      const grect = ensureGroup("overlay-ghost");
      const board = [
        { x: geom.minX * geom.mmPerUnit, y: geom.minY * geom.mmPerUnit },
        { x: (geom.minX + geom.vbW) * geom.mmPerUnit, y: geom.minY * geom.mmPerUnit },
        { x: (geom.minX + geom.vbW) * geom.mmPerUnit, y: (geom.minY + geom.vbH) * geom.mmPerUnit },
        { x: geom.minX * geom.mmPerUnit, y: (geom.minY + geom.vbH) * geom.mmPerUnit },
      ];
      const poly = document.createElementNS(NS, "polyline");
      const pts = board.map(p => applyTransform(xf, p)).map(mmToCurrentUnits).map(u => `${u.x},${u.y}`).join(" ");
      poly.setAttribute("points", pts + " " + pts.split(" ")[0]);
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "#00c4ff");
      poly.setAttribute("stroke-width", (1 / geom.mmPerUnit) * 0.25);
      poly.setAttribute("stroke-dasharray", "6,6");
      grect.appendChild(poly);
    } else {
      ensureGroup("overlay-ghost");
    }
  }, [selectedMm, fiducials, xf, selectedOrigin, generatedPath, pads, getSvgEl, getSvgGeom]);

  const hexToRgba = (hex, a = 0.3) => {
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return `rgba(${r},${g},${b},${a})`;
  };

  useEffect(() => { updateOverlay(); }, [updateOverlay]);
  // Calculate distances from reference point to all pads
  useEffect(() => {
    const refPoint = referencePoint || selectedOrigin;
    if (refPoint && pads.length > 0) {
      const distances = pads.map(pad => {
        const dx = pad.x - refPoint.x;
        const dy = pad.y - refPoint.y;
        const dist = Math.hypot(dx, dy);
        return {
          ...pad,
          distance: dist,
          dx,
          dy
        };
      });
      setPadDistances(distances);
    } else {
      setPadDistances(pads);
    }
  }, [referencePoint, selectedOrigin, pads]);

  // Generate path when reference point and target change
  useEffect(() => {
    const refPoint = referencePoint || selectedOrigin;
    if (refPoint && selectedMm) {
      const path = generatePath(refPoint, selectedMm, pads, {
        pathType,
        avoidPads: pathType !== 'direct',
        safeHeight: 2
      });
      setGeneratedPath(path);
    } else {
      setGeneratedPath(null);
    }
  }, [referencePoint, selectedOrigin, selectedMm, pads, pathType]);

  // Generate dispensing sequence when reference point or pads change
  useEffect(() => {
    const refPoint = referencePoint || selectedOrigin;
    if (refPoint && pads.length > 0) {
      if (useSafePathPlanning) {
        // Use safe path planning with collision avoidance
        const safeSeq = safePathPlanner.calculateSafeSequence(refPoint, pads, boardOutline, componentHeights);
        setSafeSequence(safeSeq);
        setDispensingSequence(safeSeq);
        
        const stats = {
          totalPads: safeSeq.length,
          totalDistance: safeSeq.reduce((sum, pad) => sum + (pad.pathDistance || 0), 0).toFixed(2),
          estimatedTime: Math.ceil(safeSeq.length * 3 + safeSeq.reduce((sum, pad) => sum + (pad.pathDistance || 0), 0) / 50),
          averageDistance: (safeSeq.reduce((sum, pad) => sum + (pad.pathDistance || 0), 0) / safeSeq.length).toFixed(2),
          safePathsUsed: safeSeq.filter(p => !p.requiresHighClearance).length,
          highClearancePaths: safeSeq.filter(p => p.requiresHighClearance).length
        };
        setJobStatistics(stats);
      } else {
        // Use simple nearest neighbor
        const sequence = dispensingSequencer.calculateOptimalSequence(refPoint, pads);
        setDispensingSequence(sequence);
        setSafeSequence([]);
        
        const stats = dispensingSequencer.calculateJobStatistics(refPoint, sequence);
        setJobStatistics(stats);
      }
    } else {
      setDispensingSequence([]);
      setSafeSequence([]);
      setJobStatistics(null);
    }
  }, [referencePoint, selectedOrigin, pads, dispensingSequencer, safePathPlanner, useSafePathPlanning, boardOutline, componentHeights]);

  const getEventMm = (evt) => {
    const svgEl = getSvgEl(); if (!svgEl) return null;
    const geom = getSvgGeom(); if (!geom) return null;
    const pt = svgEl.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const ctm = svgEl.getScreenCTM(); if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    const mmX = (local.x - geom.minX) * geom.mmPerUnit;
    const mmY = (local.y - geom.minY) * geom.mmPerUnit;
    console.log('Click conversion:', { clientX: evt.clientX, clientY: evt.clientY, localX: local.x, localY: local.y, mmX, mmY });
    return { x: mmX, y: mmY };
  };

  function isClickInsidePad(clickMm) {
    if (pads.length === 0) {
      console.warn('No pads loaded. Please select a paste layer from the dropdown.');
      return null;
    }
    
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const halfWidth = Math.max((pad.width || 1) / 2, 0.5);
      const halfHeight = Math.max((pad.height || 1) / 2, 0.5);
      const tolerance = 0.3;
      
      if (clickMm.x >= pad.x - halfWidth - tolerance && 
          clickMm.x <= pad.x + halfWidth + tolerance &&
          clickMm.y >= pad.y - halfHeight - tolerance && 
          clickMm.y <= pad.y + halfHeight + tolerance) {
        return { pad: i, pos: pad };
      }
    }
    return null;
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

  useEffect(() => {
    updateOverlay();
  }, [zoomState.isZoomed, updateOverlay]);

  // Update overlay when origin changes
  useEffect(() => {
    if (selectedOrigin) {
      console.log('Origin changed, updating overlay:', selectedOrigin);
      setTimeout(() => updateOverlay(), 100); // Small delay to ensure SVG is ready
    }
  }, [selectedOrigin, updateOverlay]);


  const smoothZoom = useCallback((fromViewBox, toViewBox, duration = 300) => {
    const svgEl = getSvgEl(); if (!svgEl) return;
    
    const startTime = performance.now();
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Smooth easing function
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      
      const currentViewBox = {
        minX: fromViewBox.minX + (toViewBox.minX - fromViewBox.minX) * easeProgress,
        minY: fromViewBox.minY + (toViewBox.minY - fromViewBox.minY) * easeProgress,
        w: fromViewBox.w + (toViewBox.w - fromViewBox.w) * easeProgress,
        h: fromViewBox.h + (toViewBox.h - fromViewBox.h) * easeProgress
      };
      
      svgEl.setAttribute("viewBox", `${currentViewBox.minX} ${currentViewBox.minY} ${currentViewBox.w} ${currentViewBox.h}`);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        updateOverlay();
      }
    };
    
    requestAnimationFrame(animate);
  }, [getSvgEl, updateOverlay]);

  const zoomToComponent = useCallback((ptMm) => {
    const svgEl = getSvgEl(); if (!svgEl) return;
    const viewBoxAttr = svgEl.getAttribute("viewBox"); if (!viewBoxAttr) return;
    const [minX, minY, w, h] = viewBoxAttr.split(/\s+/).map(Number);
    const currentViewBox = { minX, minY, w, h };
    
    if (!zoomState.baseViewBox) {
      setZoomState(prev => ({ ...prev, baseViewBox: currentViewBox }));
    }

    const geom = getSvgGeom(); if (!geom) return;
    const cx = ptMm.x / geom.mmPerUnit + geom.minX;
    const cy = ptMm.y / geom.mmPerUnit + geom.minY;

    const nextZoomLevel = Math.min(zoomState.zoomLevel + 1, zoomState.maxZoomLevel);
    const zoomFactor = Math.pow(2, nextZoomLevel); // 2x, 4x, 8x
    
    const paddingUnits = zoomState.zoomPadding / geom.mmPerUnit;
    const cont = getCanvas();
    const ar = (cont?.clientWidth || 1) / (cont?.clientHeight || 1);
    const baseViewBox = zoomState.baseViewBox || currentViewBox;
    
    let newW = (baseViewBox.w / zoomFactor) + paddingUnits * 2;
    let newH = newW / ar;
    
    let newMinX = Math.max(Math.min(cx - newW / 2, baseViewBox.minX + baseViewBox.w - newW), baseViewBox.minX);
    let newMinY = Math.max(Math.min(cy - newH / 2, baseViewBox.minY + baseViewBox.h - newH), baseViewBox.minY);
    
    const targetViewBox = { minX: newMinX, minY: newMinY, w: newW, h: newH };
    
    smoothZoom(currentViewBox, targetViewBox);
    setZoomState(prev => ({ ...prev, isZoomed: true, zoomLevel: nextZoomLevel }));
  }, [getSvgEl, getSvgGeom, zoomState.baseViewBox, zoomState.zoomLevel, zoomState.maxZoomLevel, zoomState.zoomPadding, getCanvas, smoothZoom]);

  const zoomOut = useCallback(() => {
    const svgEl = getSvgEl(); if (!svgEl) return;
    
    if (zoomState.zoomLevel > 0) {
      // Step back one zoom level
      const viewBoxAttr = svgEl.getAttribute("viewBox");
      if (!viewBoxAttr) return;
      const [minX, minY, w, h] = viewBoxAttr.split(/\s+/).map(Number);
      const currentViewBox = { minX, minY, w, h };
      
      const prevZoomLevel = zoomState.zoomLevel - 1;
      const baseViewBox = zoomState.baseViewBox;
      if (!baseViewBox) return;
      
      let targetViewBox;
      if (prevZoomLevel === 0) {
        // Back to original view
        targetViewBox = baseViewBox;
      } else {
        // Calculate intermediate zoom level
        const zoomFactor = Math.pow(2, prevZoomLevel);
        const paddingUnits = zoomState.zoomPadding / (getSvgGeom()?.mmPerUnit || 1);
        const cont = getCanvas();
        const ar = (cont?.clientWidth || 1) / (cont?.clientHeight || 1);
        
        const centerX = currentViewBox.minX + currentViewBox.w / 2;
        const centerY = currentViewBox.minY + currentViewBox.h / 2;
        
        let newW = (baseViewBox.w / zoomFactor) + paddingUnits * 2;
        let newH = newW / ar;
        
        targetViewBox = {
          minX: Math.max(Math.min(centerX - newW / 2, baseViewBox.minX + baseViewBox.w - newW), baseViewBox.minX),
          minY: Math.max(Math.min(centerY - newH / 2, baseViewBox.minY + baseViewBox.h - newH), baseViewBox.minY),
          w: newW,
          h: newH
        };
      }
      
      smoothZoom(currentViewBox, targetViewBox);
      setZoomState(prev => ({ 
        ...prev, 
        isZoomed: prevZoomLevel > 0, 
        zoomLevel: prevZoomLevel 
      }));
    }
  }, [getSvgEl, zoomState.baseViewBox, zoomState.zoomLevel, zoomState.zoomPadding, getCanvas, getSvgGeom, smoothZoom]);

  const handleCanvasClick = useCallback((evt) => {
    if (fidPickMode) return;

    const mm = getEventMm(evt);
    if (!mm) return;
    
    const hit = isClickInsidePad(mm);
    
    // Only process clicks inside actual pad boundaries
    if (!hit) {
      // Clear selection when clicking outside pads
      setSelectedMm(null);
      return;
    }

    if (zoomState.enabled) {
      setSelectedMm(hit.pos);
      if (zoomState.zoomLevel < zoomState.maxZoomLevel) {
        zoomToComponent(hit.pos);
      } else {
        zoomOut();
      }
      return;
    }

    // Always use pad center coordinates, not click coordinates
    const padCenter = { x: hit.pos.x, y: hit.pos.y };
    
    // Show distance from reference point to clicked pad
    const refPoint = referencePoint || selectedOrigin;
    if (refPoint) {
      const dx = padCenter.x - refPoint.x;
      const dy = padCenter.y - refPoint.y;
      const dist = Math.hypot(dx, dy);
      const refName = refPoint === selectedOrigin ? 'Top-Left Origin' : `Fiducial ${refPoint.id || ''}`;
      const show = window.confirm(
        `Distance from ${refName}:\n` +
        `ΔX: ${dx.toFixed(2)} mm\n` +
        `ΔY: ${dy.toFixed(2)} mm\n` +
        `Distance: ${dist.toFixed(2)} mm\n\n` +
        `Show measurement line?`
      );
      if (show) {
        setSelectedMm(padCenter);
      }
    } else {
      setSelectedMm(padCenter);
    }
  }, [
    fidPickMode,
    zoomState.enabled, zoomState.isZoomed,
    selectedOrigin,
    pads,
    getEventMm,
    zoomToComponent,
    zoomOut
  ]);

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

  const onRedetectFiducials = () => {
    if (layers.length === 0) return;

    // Re-run fiducial detection
    const detectedFiducials = analyzeFiducialsInLayers(layers);
    setFiducialDetectionResult(detectedFiducials);

    if (detectedFiducials.length > 0) {
      // Auto-populate fiducials with detected positions
      const colors = ["#2ea8ff", "#8e2bff", "#00c49a", "#ff6b35", "#9c27b0", "#4caf50"];
      const autoFiducials = detectedFiducials.map((fid, idx) => ({
        id: fid.id,
        design: { x: fid.x, y: fid.y },
        machine: null,
        color: colors[idx % colors.length],
        confidence: fid.confidence
      }));

      // Fill remaining slots with empty fiducials
      while (autoFiducials.length < 3) {
        autoFiducials.push({
          id: `F${autoFiducials.length + 1}`,
          design: null,
          machine: null,
          color: colors[autoFiducials.length % colors.length]
        });
      }

      setFiducials(autoFiducials);
    } else {
      // No fiducials detected, keep current fiducials but clear design positions
      setFiducials(prev => prev.map(f => ({ ...f, design: null })));
    }

    // Clear transform since fiducials changed
    setXf(null);
  };

  const onAutoAlign = () => {
    // Auto-populate machine coordinates from design coordinates
    const alignedFiducials = fiducials.map(f => {
      if (f.design && f.design.x !== null && f.design.y !== null) {
        return {
          ...f,
          machine: {
            x: f.design.x + (pcbOriginOffset?.x || 0) + (toolOffset?.dx || 0),
            y: f.design.y + (pcbOriginOffset?.y || 0) + (toolOffset?.dy || 0)
          }
        };
      }
      return f;
    });

    setFiducials(alignedFiducials);

    // Auto-solve transformation if we have enough fiducials
    const validFiducials = alignedFiducials.filter(f => f.design && f.machine);
    if (validFiducials.length >= 2) {
      const T = fitSimilarity(validFiducials.map(f => f.design), validFiducials.map(f => f.machine));
      setXf(T);
    }
  };

  const onAutoDetectCamera = async () => {
    // This will be called from CameraPanel when fiducials are detected
    console.log('Camera-based fiducial detection initiated');
  };

  const onDetectOrigins = () => {
    if (layers.length === 0) return;
    
    const origins = detectPcbOrigins(layers);
    setOriginCandidates(origins);
    
    if (origins.length > 0) {
      const origin = { ...origins[0], id: 'O1' };
      setSelectedOrigin(origin);
      setPcbOriginOffset({ x: origin.x, y: origin.y });
    } else {
      setSelectedOrigin(null);
    }
  };
  useEffect(() => {
    window.updateFiducialsFromCamera = (detectedFiducials) => {
      const colors = ["#2ea8ff", "#8e2bff", "#00c49a", "#ff6b35", "#9c27b0", "#4caf50"];
      
      const updatedFiducials = detectedFiducials.map((detected, idx) => ({
        id: detected.id || `F${idx + 1}`,
        design: fiducials[idx]?.design || null, // Keep existing design coordinates
        machine: detected.machine,
        color: colors[idx % colors.length],
        confidence: detected.confidence,
        autoDetected: true
      }));
      
      // Fill remaining slots
      while (updatedFiducials.length < 3) {
        updatedFiducials.push({
          id: `F${updatedFiducials.length + 1}`,
          design: null,
          machine: null,
          color: colors[updatedFiducials.length % colors.length]
        });
      }
      
      setFiducials(updatedFiducials);
      
      // Auto-solve if we have enough data
      const validFiducials = updatedFiducials.filter(f => f.design && f.machine);
      if (validFiducials.length >= 2) {
        const T = fitSimilarity(validFiducials.map(f => f.design), validFiducials.map(f => f.machine));
        setXf(T);
      }
    };
    
    return () => {
      delete window.updateFiducialsFromCamera;
    };
  }, [fiducials]);

  return (
    <div className="wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <aside className="sidebar">
        <div className="header" >
          <div className="row" style={{ marginBottom: 12 }}>
            <label className="btn">
              Open Gerbers / ZIP
              <input type="file" multiple onChange={pickFiles}
                accept=".zip,.gbr,.grb,.gtl,.gbl,.gts,.gbs,.gto,.gbo,.gtp,.gbp,.gbc,.gm1,.drl,.txt,.nc" />
            </label>
            <button className="btn secondary" onClick={exportAllSvgsZip} disabled={layers.length === 0}>Download SVGs (ZIP)</button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={handleUndo} disabled={!undoManager.canUndo()} title="Undo">
              ↶ Undo
            </button>
            <button className="btn sm" onClick={handleRedo} disabled={!undoManager.canRedo()} title="Redo">
              ↷ Redo
            </button>
          </div>
        </div>

        <div className="section Board-section">
          <h3 style={{ color: '#007bff', padding: '8px 12px', borderBottom: '2px solid #007bff' }}>Board View</h3>
          <div className="flex-row">
            <button className="btn secondary" onClick={() => changeSide("top")}>Top</button>
            <button className="btn secondary" onClick={() => changeSide("bottom")}>Bottom</button>
            <label><input type="checkbox" checked={mirrorBottom} onChange={(e) => setMirrorBottom(e.target.checked)} /> Mirror bottom</label>
          </div>
          <LayerList layers={layers} onToggle={toggleLayer} />
        </div>



        <div className="section Components-section">
          <h3 style={{ color: '#007bff', padding: '8px 12px', borderBottom: '2px solid #007bff' }}>Components</h3>
          <div className="flex-row" style={{ marginLeft: 8 }}>
            <select value={pasteIdx ?? ""} onChange={(e) => {
              const idx = e.target.value === "" ? null : +e.target.value;
              setPasteIdx(idx);
              if (idx != null) {
                const selectedSide = layers[idx].side || side;
                const combinedData = combinePadLayers(layers, selectedSide);
                setPads(processPads(combinedData.pads.map(padCenter)));
                console.log('Combined pad data:', combinedData);
              } else setPads([]);
              setSelectedMm(null);
            }}>
              <option value="">(select paste + copper layers)</option>
              {layers.map((l, i) => {
                if (l.type === "solderpaste") {
                  const combo = getAvailableLayerCombinations(layers, l.side);
                  const label = combo.canCombine ? 
                    `${l.filename} + copper (combined)` : 
                    `${l.filename} (paste only)`;
                  return <option key={l.filename} value={i}>{label}</option>;
                }
                return null;
              })}
            </select>
          </div>
          <ComponentList
            components={padDistances}
            onFocus={(pad) => {
              setSelectedMm({ x: pad.x, y: pad.y });
            }}
          />

          {/* <div className="section">
            <h3>Advanced Features</h3>
            <div className="flex-row wrap" style={{ gap: 8 }}>
              <label><input type="checkbox" checked={visionEnabled} onChange={(e) => setVisionEnabled(e.target.checked)} /> Vision Guidance</label>
              <label><input type="checkbox" checked={qualityEnabled} onChange={(e) => setQualityEnabled(e.target.checked)} /> Quality Control</label>
            </div>
          </div> */}

          <div className="section Origin-section">
            <h3 style={{ color: '#007bff', padding: '8px 12px', borderBottom: '2px solid #007bff' }}>PCB Origin</h3>
            {selectedOrigin && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ padding: 8, background: '#e3effaff', borderRadius: 4 }}>
                  <strong>{selectedOrigin.description}</strong><br/>
                  <small>Position: ({selectedOrigin.x.toFixed(2)}, {selectedOrigin.y.toFixed(2)}) mm</small>
                  <small>Confidence: {(selectedOrigin.confidence * 100).toFixed(0)}%</small>
                </div>
              </div>
            )}
            <div className="flex-row" style={{ marginLeft: 8 }}>
              <label>X (mm) <input type="number" step="0.1" value={pcbOriginOffset?.x || 0}
                onChange={(e) => setPcbOriginOffset({ x: +e.target.value || 0, y: pcbOriginOffset?.y || 0 })}
                style={{ width: 80 }} /></label>
              <label>Y (mm) <input type="number" step="0.1" value={pcbOriginOffset?.y || 0}
                onChange={(e) => setPcbOriginOffset({ x: pcbOriginOffset?.x || 0, y: +e.target.value || 0 })}
                style={{ width: 80 }} /></label>
            </div>
            <div className="flex-row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn sm secondary" onClick={onDetectOrigins} disabled={layers.length === 0}>
                🎯 Detect Origins
              </button>
              <button className="btn sm secondary" onClick={() => {
                // Test origin at top-left corner
                const testOrigin = { id: 'O1', x: 0, y: 0, confidence: 0.9, description: 'Top-left corner (test)' };
                setSelectedOrigin(testOrigin);
                console.log('Set test origin (top-left):', testOrigin);
                setTimeout(() => updateOverlay(), 100);
              }}>
                Test Origin (Top-Left)
              </button>
              <button className="btn sm secondary" onClick={() => {
                setSelectedOrigin(null);
                setPcbOriginOffset({ x: 0, y: 0 });
              }}>
                Clear
              </button>
            </div>
            <small>Machine coordinates where PCB top-left corner (0,0) is located</small>
          </div>
          
          <div className="section Reference-section" style={{ marginTop: 16 }}>
            <h4 style={{ color: '#007bff', margin: '8px 0' }}>Reference Point</h4>
            <div className="flex-row" style={{ marginLeft: 8, gap: 8 }}>
              <label>
                <input type="radio" name="refType" checked={referenceType === 'origin'} 
                  onChange={() => {
                    setReferenceType('origin');
                    setReferencePoint(null);
                  }} />
                Top-Left Origin
              </label>
              <label>
                <input type="radio" name="refType" checked={referenceType === 'fiducial'} 
                  onChange={() => setReferenceType('fiducial')} />
                Fiducial
              </label>
            </div>
            {referenceType === 'fiducial' && (
              <div className="flex-row" style={{ marginLeft: 8, marginTop: 8 }}>
                <select value={referencePoint?.id || ''} onChange={(e) => {
                  const fidId = e.target.value;
                  const fid = fiducials.find(f => f.id === fidId && f.design);
                  setReferencePoint(fid ? { x: fid.design.x, y: fid.design.y, id: fid.id } : null);
                }}>
                  <option value="">(select fiducial)</option>
                  {fiducials.filter(f => f.design).map(f => (
                    <option key={f.id} value={f.id}>{f.id} ({f.design.x.toFixed(1)}, {f.design.y.toFixed(1)})</option>
                  ))}
                </select>
              </div>
            )}
            <small>Reference point for measuring distances to pads</small>
          </div>
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

        {(referencePoint || selectedOrigin) && selectedMm && (
          <div className="distance-info">
            <span className="badge">Path from {referencePoint ? `Fiducial ${referencePoint.id}` : 'Top-Left Origin'}</span>
            <div className="kvs">
              <span>ΔX: {(selectedMm.x - (referencePoint || selectedOrigin).x).toFixed(2)} mm</span>
              <span>ΔY: {(selectedMm.y - (referencePoint || selectedOrigin).y).toFixed(2)} mm</span>
              <span><strong>2D: {Math.hypot(selectedMm.x - (referencePoint || selectedOrigin).x, selectedMm.y - (referencePoint || selectedOrigin).y).toFixed(2)} mm</strong></span>
              {generatedPath && <span>3D Path: {generatedPath.totalDistance.toFixed(2)} mm</span>}
            </div>
            <div className="path-controls" style={{ marginTop: 8 }}>
              <select value={pathType} onChange={(e) => setPathType(e.target.value)} style={{ fontSize: 12 }}>
                <option value="direct">Direct Path</option>
                <option value="safe">Safe Path (Lift)</option>
                <option value="optimized">Optimized Path</option>
              </select>
              <label style={{ marginLeft: 8, fontSize: 12 }}>
                <input type="checkbox" checked={showPasteDots} onChange={(e) => setShowPasteDots(e.target.checked)} />
                Show Paste Dots
              </label>
              {generatedPath && (
                <small style={{ marginLeft: 8, color: '#666' }}>
                  {generatedPath.type} • {generatedPath.segments.length} segments
                </small>
              )}
            </div>
          </div>
        )}

        <div className="fiducial-panel">
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
            detectionResult={fiducialDetectionResult}
            onRedetectFiducials={onRedetectFiducials}
            onAutoAlign={onAutoAlign}
            onAutoDetectCamera={onAutoDetectCamera}
          />
          {selectedOrigin && selectedMm && xf && applyXf && (
            <div style={{ padding: 8, background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 4, marginTop: 8 }}>
              <small><strong>Transform Verification:</strong></small>
              <div style={{ fontSize: '0.8em', fontFamily: 'monospace' }}>
                Origin: {selectedOrigin.x.toFixed(3)}, {selectedOrigin.y.toFixed(3)} → {verifyTransform(selectedOrigin).x.toFixed(3)}, {verifyTransform(selectedOrigin).y.toFixed(3)}
              </div>
              <div style={{ fontSize: '0.8em', fontFamily: 'monospace' }}>
                Target: {selectedMm.x.toFixed(3)}, {selectedMm.y.toFixed(3)} → {verifyTransform(selectedMm).x.toFixed(3)}, {verifyTransform(selectedMm).y.toFixed(3)}
              </div>
            </div>
          )}
        </div>

        {maintenanceAlert && (
          <div className="maintenance-alert" style={{
            position: 'fixed', top: 20, right: 20, background: '#ff6b35', color: 'white',
            padding: 16, borderRadius: 8, zIndex: 1000, maxWidth: 300
          }}>
            <h4>🔧 Nozzle Maintenance Required</h4>
            <p>{maintenanceAlert.type === 'cleaning_reminder' ?
              `Dispenses: ${maintenanceAlert.dispenseCount}, Hours: ${Math.round(maintenanceAlert.hoursSinceLastCleaning)}` :
              'Cleaning completed'}
            </p>
            <div className="flex-row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn sm" onClick={() => {
                maintenanceManager.markCleaned();
                setMaintenanceAlert(null);
              }}>Mark Cleaned</button>
              <button className="btn sm secondary" onClick={() => setMaintenanceAlert(null)}>Dismiss</button>
            </div>
          </div>
        )}

        <div className="panels">
          <AutomatedDispensingPanel
            dispensingSequencer={dispensingSequencer}
            dispensingSequence={dispensingSequence}
            safeSequence={safeSequence}
            jobStatistics={jobStatistics}
            referencePoint={referencePoint}
            selectedOrigin={selectedOrigin}
            pressureSettings={pressureSettings}
            speedSettings={speedSettings}
            boardOutline={boardOutline}
            useSafePathPlanning={useSafePathPlanning}
            setUseSafePathPlanning={setUseSafePathPlanning}
            componentHeights={componentHeights}
            setComponentHeights={setComponentHeights}
            safePathPlanner={safePathPlanner}
            onStartJob={(gcode, sequence) => {
              console.log('Starting automated dispensing job:', { gcode, sequence });
              // This will be handled by SerialPanel for sending to machine
            }}
          />
          <CameraPanel
            fiducials={fiducials}
            xf={xf}
            applyXf={applyXf}
            selectedDesign={selectedMm}
            toolOffset={toolOffset}
            setToolOffset={(setToolOffset)}
            nozzleDia={nozzleDia}
            setNozzleDia={setNozzleDia}
            padDetector={padDetector}
            qualityController={qualityController}
            fiducialVisionDetector={fiducialVisionDetector}
          />
          <PressurePanel
            pressureController={pressureController}
            pressureSettings={pressureSettings}
            setPressureSettings={setPressureSettings}
            selectedPad={selectedMm ? pads.find(p => Math.abs(p.x - selectedMm.x) < 0.1 && Math.abs(p.y - selectedMm.y) < 0.1) : null}
          />
          <SpeedPanel
            speedProfileManager={speedProfileManager}
            speedSettings={speedSettings}
            setSpeedSettings={setSpeedSettings}
            selectedPad={selectedMm ? pads.find(p => Math.abs(p.x - selectedMm.x) < 0.1 && Math.abs(p.y - selectedMm.y) < 0.1) : null}
            pressureSettings={pressureSettings}
            pads={pads}
          />
          <LinearMovePanel
            homeDesign={selectedOrigin ? { x: selectedOrigin.x, y: selectedOrigin.y } : null}
            focusDesign={selectedMm}
            xf={xf}
            applyXf={applyXf}
            components={pads}
            axisLetter="A"
            collisionDetector={collisionDetector}
            maintenanceManager={maintenanceManager}
            pressureController={pressureController}
            pressureSettings={pressureSettings}
            speedProfileManager={speedProfileManager}
            speedSettings={speedSettings}
            dispensingSequencer={dispensingSequencer}
            dispensingSequence={dispensingSequence}
            safeSequence={safeSequence}
            jobStatistics={jobStatistics}
            boardOutline={boardOutline}
            safePathPlanner={safePathPlanner}
            useSafePathPlanning={useSafePathPlanning}
          />
          <SerialPanel />
        </div>
      </main>
    </div>
  );
}