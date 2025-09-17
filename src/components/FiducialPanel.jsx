import React from "react";

export default function FiducialPanel({
  fiducials,           
  activeId,            
  setActiveId,
  pickMode,          
  togglePickMode,
  onInputMachine,      
  onClearOne,          
  onClearAll,
  onSolve2,            
  onSolve3,            
  transformSummary,    
  applyTransform,      
  setApplyTransform
}) {
  const ready2 = fiducials.filter(f => f.design && f.machine).length >= 2;
  const ready3 = fiducials.filter(f => f.design && f.machine).length >= 3;

  return (
    <div className="section">
      <h3>Fiducials & Alignment</h3>

      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <button className={`btn ${pickMode ? "" : "secondary"}`} onClick={togglePickMode}>
          {pickMode ? "Pick/Drag fiducials: ON" : "Pick/Drag fiducials"}
        </button>
        <select value={activeId ?? ""} onChange={(e)=>setActiveId(e.target.value || null)}>
          <option value="">(select F to arm)</option>
          {fiducials.map(f => <option key={f.id} value={f.id}>{f.id}</option>)}
        </select>
        <button className="btn secondary" onClick={onClearAll}>Clear all</button>
        <label className="row" style={{ gap: 6, marginLeft: "auto" }}>
          <input type="checkbox" checked={applyTransform} onChange={(e)=>setApplyTransform(e.target.checked)} />
          Apply transform to outputs
        </label>
      </div>

      <table className="kv small">
        <thead>
          <tr><th>F</th><th>Design (mm)</th><th>Machine (mm)</th><th/></tr>
        </thead>
        <tbody>
          {fiducials.map(f => (
            <tr key={f.id}>
              <td>
                <span style={{ display: "inline-block", width: 10, height: 10, background: f.color, borderRadius: 4, marginRight: 6 }}/>
                <strong>{f.id}</strong>{activeId === f.id ? " (armed)" : ""}
              </td>
              <td>
                {f.design ? `X ${f.design.x.toFixed(3)}, Y ${f.design.y.toFixed(3)}` : <em>— click/drag on PCB —</em>}
              </td>
              <td>
                <div className="row" style={{ gap: 6 }}>
                  <input className="in sm" placeholder="Mx"
                         value={f.machine?.x ?? ""} onChange={(e)=>onInputMachine(f.id, {x:parseFloat(e.target.value), y:f.machine?.y})}/>
                  <input className="in sm" placeholder="My"
                         value={f.machine?.y ?? ""} onChange={(e)=>onInputMachine(f.id, {x:f.machine?.x, y:parseFloat(e.target.value)})}/>
                </div>
              </td>
              <td><button className="btn secondary" onClick={()=>onClearOne(f.id)}>Clear</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn" disabled={!ready2} onClick={onSolve2}>Solve (2-pt similarity)</button>
        <button className="btn secondary" disabled={!ready3} onClick={onSolve3}>Solve (3-pt affine)</button>
      </div>

      {transformSummary && (
        <div className="info" style={{ marginTop: 8 }}>
          <div><strong>Transform</strong>: {transformSummary.type}</div>
          {"thetaDeg" in transformSummary && <div>Rotation: {transformSummary.thetaDeg.toFixed(3)}°</div>}
          {"scale" in transformSummary && <div>Scale: {transformSummary.scale.toFixed(6)}×</div>}
          <div>tx: {transformSummary.tx.toFixed(3)} mm, ty: {transformSummary.ty.toFixed(3)} mm</div>
          {"rms" in transformSummary && <div>RMS error: {transformSummary.rms.toFixed(3)} mm</div>}
        </div>
      )}
    </div>
  );
}
