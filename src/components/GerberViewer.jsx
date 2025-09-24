// src/components/GerberViewer.jsx
import React from 'react';

// Simple layer matchers — extend as you like:
const LAYERS = [
  { id: 'top-paste',  label: 'Top Paste',  re: /(F[_\-\. ]?Paste|Top[_\-\. ]?Paste|\.gtp$|\.gxp$|\.gct$|\.cream$|paste\.gbr$)/i },
  { id: 'top-copper', label: 'Top Copper', re: /(F[_\-\. ]?Cu|Top[_\-\. ]?Copper|\.gtl$|top\.gbr$|f_cu\.gbr$)/i },
  { id: 'top-silk',   label: 'Top Silks',  re: /(F[_\-\. ]?Silks?|Top[_\-\. ]?Silk|\.gto$|silk.*top|f_silk)/i },
  { id: 'solder-mask',label: 'Top Mask',   re: /(F[_\-\. ]?Mask|Top[_\-\. ]?Mask|\.gts$|f_mask)/i },
];

export default function GerberViewer() {
  const [status, setStatus]     = React.useState('');
  const [svgStr, setSvgStr]     = React.useState(''); // raw SVG string
  const [bounds, setBounds]     = React.useState(null); // {minX,minY,maxX,maxY}
  const [layerId, setLayerId]   = React.useState('top-copper');

  const wrapperRef = React.useRef(null); // div that holds the SVG
  const svgRef     = React.useRef(null); // actual <svg> node (queried after inject)

  // Pan/Zoom state
  const [scale, setScale] = React.useState(1);
  const [pan, setPan]     = React.useState({ x: 0, y: 0 });

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 20;

  // After we inject the SVG string, grab a ref to the <svg> node
  React.useEffect(() => {
    if (!wrapperRef.current) return;
    const svgEl = wrapperRef.current.querySelector('svg');
    svgRef.current = svgEl || null;
    // apply current transform on (re)mount
    applyTransform();
  }, [svgStr]);

  // Apply CSS transform to the SVG element
  function applyTransform(nextPan = pan, nextScale = scale) {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    svgEl.style.transformOrigin = '0 0'; // top-left of viewBox space
    svgEl.style.transform = `translate(${nextPan.x}px, ${nextPan.y}px) scale(${nextScale})`;
  }

  // Wheel zoom centered at cursor position
  function onWheel(e) {
    if (!svgRef.current || !wrapperRef.current) return;
    e.preventDefault();

    const rect  = wrapperRef.current.getBoundingClientRect();
    const mx    = e.clientX - rect.left; // mouse in container coords
    const my    = e.clientY - rect.top;

    const delta = -e.deltaY; // positive to zoom in
    const zoomFactor = Math.exp(delta * 0.0015); // smooth exponential zoom
    const newScale = clamp(scale * zoomFactor, MIN_SCALE, MAX_SCALE);

    // Keep the mouse focus point stable: compute world coords before, then solve new pan
    const wx = (mx - pan.x) / scale;
    const wy = (my - pan.y) / scale;

    const newPan = {
      x: mx - wx * newScale,
      y: my - wy * newScale
    };

    setScale(newScale);
    setPan(newPan);
    applyTransform(newPan, newScale);
  }

  // Drag to pan
  const dragState = React.useRef({ dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  function onMouseDown(e) {
    if (!svgRef.current) return;
    e.preventDefault();
    dragState.current = {
      dragging: true,
      sx: e.clientX,
      sy: e.clientY,
      ox: pan.x,
      oy: pan.y
    };
    // improve feel: prevent text selection during drag
    document.body.style.userSelect = 'none';
  }

  function onMouseMove(e) {
    const st = dragState.current;
    if (!st.dragging) return;
    const dx = e.clientX - st.sx;
    const dy = e.clientY - st.sy;
    const newPan = { x: st.ox + dx, y: st.oy + dy };
    setPan(newPan);
    applyTransform(newPan, scale);
  }

  function onMouseUpLeave() {
    if (dragState.current.dragging) {
      dragState.current.dragging = false;
      document.body.style.userSelect = '';
    }
  }

  // Buttons
  function zoomIn()  { const s = clamp(scale * 1.2, MIN_SCALE, MAX_SCALE); setScale(s); applyTransform(pan, s); }
  function zoomOut() { const s = clamp(scale / 1.2, MIN_SCALE, MAX_SCALE); setScale(s); applyTransform(pan, s); }

  function reset()   { setScale(1); const p={x:0,y:0}; setPan(p); applyTransform(p,1); }

  // Fit the SVG viewBox inside the container
  function fit() {
    if (!svgRef.current || !wrapperRef.current || !bounds) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const viewW = Math.max(1, bounds.maxX - bounds.minX);
    const viewH = Math.max(1, bounds.maxY - bounds.minY);

    const pad = 20; // px padding around
    const s = Math.min( (rect.width - pad*2) / viewW, (rect.height - pad*2) / viewH );
    const newScale = clamp(s, MIN_SCALE, MAX_SCALE);

    const panX = (rect.width  - viewW * newScale) / 2;
    const panY = (rect.height - viewH * newScale) / 2;

    setScale(newScale);
    const newPan = { x: panX, y: panY };
    setPan(newPan);
    applyTransform(newPan, newScale);
  }

  async function onOpenZip() {
    try {
      setStatus('Opening ZIP…'); setSvgStr('');
      if (!window.api?.files?.openAny) {
        setStatus('Bridge missing: files.openAny'); return;
      }
      const file = await window.api.files.openAny();
      if (!file || file.kind !== 'zip') {
        setStatus('Please choose a Gerber ZIP'); return;
      }
      const { svg, bounds } = await renderGerberLayerSVG(file.base64, layerId);
      setSvgStr(svg);
      setBounds(bounds);
      setStatus('Rendered.');
      // After render, auto-fit once
      setTimeout(fit, 0);
    } catch (e) {
      console.error(e);
      setStatus(`Render error: ${e.message}`);
    }
  }

  return (
    <div className="panel">
      <div className="row" style={{alignItems:'center', justifyContent:'space-between'}}>
        <h3 className="h">Gerber Viewer</h3>
        <div className="row" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
          <select value={layerId} onChange={e=>setLayerId(e.target.value)}>
            {LAYERS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <button type="button" onClick={onOpenZip}>Open Gerber ZIP…</button>
          <button type="button" onClick={zoomOut}>−</button>
          <button type="button" onClick={zoomIn}>+</button>
          <button type="button" onClick={fit}>Fit</button>
          <button type="button" onClick={reset}>Reset</button>
        </div>
      </div>

      {status && <div style={{marginTop:8}}><span className="badge">{status}</span></div>}

      <div
        ref={wrapperRef}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUpLeave}
        onMouseLeave={onMouseUpLeave}
        style={{
          marginTop:10,
          border:'1px solid #1e2a38',
          borderRadius:12,
          height: 480,
          overflow: 'hidden',
          background: '#0b0f14',
          // helps trackpad/scroll behavior
          overscrollBehavior: 'contain',
          cursor: dragState.current.dragging ? 'grabbing' : 'grab',
          userSelect: 'none'
        }}
        // prevent the wheel from causing page scroll on some platforms
      >
        {/* We inject the SVG string. We transform the <svg> itself via CSS transform */}
        {svgStr
          ? <div dangerouslySetInnerHTML={{ __html: svgStr }} />
          : <div style={{padding:14, color:'#8aa0b2'}}>No layer rendered yet.</div>}
      </div>

      <div style={{marginTop:8, fontSize:12, color:'#8aa0b2'}}>
        Tip: Use your Fiducials tab to compute the board→machine transform.
        This viewer is for visual inspection; the Preview tab overlays pads/parts.
      </div>
    </div>
  );
}

// --- helper: lazy render a single layer to an SVG string + bounds ---
async function renderGerberLayerSVG(base64Zip, layerId) {
  const JSZipMod = await import('jszip');
  const JSZipCtor = JSZipMod?.default ?? JSZipMod?.JSZip ?? JSZipMod;
  const hasStatic = typeof JSZipCtor?.loadAsync === 'function';
  const data = Uint8Array.from(atob(base64Zip), c => c.charCodeAt(0));
  const zip  = hasStatic ? await JSZipCtor.loadAsync(data) : await (new JSZipCtor()).loadAsync(data);

  const names = Object.keys(zip.files);

  const matcher = {
    'top-paste':  /(F[_\-\. ]?Paste|Top[_\-\. ]?Paste|\.gtp$|\.gxp$|\.gct$|\.cream$|paste\.gbr$)/i,
    'top-copper': /(F[_\-\. ]?Cu|Top[_\-\. ]?Copper|\.gtl$|top\.gbr$|f_cu\.gbr$)/i,
    'top-silk':   /(F[_\-\. ]?Silks?|Top[_\-\. ]?Silk|\.gto$|silk.*top|f_silk)/i,
    'solder-mask':/(F[_\-\. ]?Mask|Top[_\-\. ]?Mask|\.gts$|f_mask)/i,
  }[layerId];

  const fname = names.find(n => matcher.test(n));
  if (!fname) throw new Error('Requested layer not found in ZIP');

  const fileText = await zip.file(fname).async('string');

  const { parse: parseGerber } = await import('@tracespace/parser');
  const { plot } = await import('@tracespace/plotter');

  const ast   = parseGerber(fileText);
  const image = plot(ast, { precision: 6 });

  const [minX, minY, maxX, maxY] = getBounds(image);
  const width  = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const parts = [];
  for (const shape of image.layers?.[0]?.shapes || []) {
    if (shape.type === 'polygon') {
      const d = shape.points.map(([x,y], i) =>
        `${i ? 'L' : 'M'} ${x - minX} ${maxY - y}`).join(' ') + ' Z';
      parts.push(`<path d="${d}" fill="currentColor" fill-opacity="0.85"/>`);
    } else if (shape.type === 'segment') {
      const [x1,y1] = shape.start, [x2,y2] = shape.end;
      parts.push(`<line x1="${x1 - minX}" y1="${maxY - y1}" x2="${x2 - minX}" y2="${maxY - y2}" stroke="currentColor" stroke-width="${shape.strokeWidth || 0.2}"/>`);
    }
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${width} ${height}"
     style="width:${width}px; height:${height}px; color:#18bfff; display:block;">
  <g>${parts.join('\n')}</g>
</svg>`.trim();

  return { svg, bounds: { minX, minY, maxX, maxY } };
}

function getBounds(image){
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  const upd = (x,y)=>{ if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; };
  for (const shape of image.layers?.[0]?.shapes || []) {
    if (shape.type === 'polygon') {
      for (const [x,y] of shape.points) upd(x,y);
    } else if (shape.type === 'segment') {
      const [x1,y1] = shape.start, [x2,y2] = shape.end;
      upd(x1,y1); upd(x2,y2);
    }
  }
  if (!isFinite(minX)) return [0,0,1,1];
  return [minX,minY,maxX,maxY];
}

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
