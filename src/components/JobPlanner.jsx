// src/components/JobPlanner.jsx
import React from 'react';
import { useStore } from '../state/useStore.js';
import { buildPasteJob, buildPickPlaceJob } from '../lib/gcode.js';

export default function JobPlanner(){
  const parts = useStore(s => s.parts);
  const pads  = useStore(s => s.pads);
  const cfg   = useStore(s => s.config);
  const [mode, setMode] = React.useState('paste');
  const [gcode, setGcode] = React.useState('');

  const build = () => {
    const t = cfg.transform || { rotationDeg:0, scale:1, tx:0, ty:0 };
    const lines = mode === 'paste'
      ? buildPasteJob({ parts, pads, cfg, transform: t })  // pads preferred if present
      : buildPickPlaceJob({ parts, cfg, transform: t });
    setGcode(lines.join('\n'));
  };

  const download = async () => {
    try {
      if (!gcode.trim()) { alert('No G-code to save. Click "Build G-code" first.'); return; }
      const name = mode === 'paste' ? 'paste-job.gcode' : 'pnp-job.gcode';
      const res = await window.api.files.saveText({ defaultName: name, text: gcode });
      if (!res) return; // canceled
      // Optional: toast or badge — here we just log
      console.log('Saved G-code:', res.path);
    } catch (e) {
      console.error('Save error:', e);
      alert('Failed to save G-code. See console for details.');
    }
  };

  return (
    <div className="panel">
      <h3 className="h">Plan Job</h3>
      <div className="row" style={{alignItems:'center', gap:8}}>
        <select value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="paste">Solder Paste</option>
          <option value="pnp">Pick & Place</option>
        </select>
        <button onClick={build}>Build G-code</button>
        <button onClick={download} title="Save current G-code to a .gcode file">Download .gcode</button>
      </div>
      <textarea
        id="gcode-ta"
        value={gcode}
        onChange={e=>setGcode(e.target.value)}
        placeholder="Built G-code will appear here"
        style={{width:'100%', height:220, background:'#0e1217', color:'#bfe6ff', borderRadius:12, padding:10}}
      />
    </div>
  );
}
