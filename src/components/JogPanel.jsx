import React from 'react';


export default function JogPanel(){
const [inc, setInc] = React.useState(0.1);
const jog = (dx=0,dy=0,dz=0) => {
const cmd = `G91`;
const move = `G1 ${dx?`X${dx}`:''} ${dy?`Y${dy}`:''} ${dz?`Z${dz}`:''}`.replace(/\s+/g,' ').trim();
const abs = `G90`;
window.api.gcode.send(cmd);
window.api.gcode.send(move);
window.api.gcode.send(abs);
};
return (
<div className="panel">
<h3 className="h">Manual Jog</h3>
<div className="row" style={{alignItems:'center'}}>
<label>Increment (mm) <input type="number" step="0.01" value={inc} onChange={e=>setInc(+e.target.value)}/></label>
</div>
<div className="row" style={{gap:8}}>
<button onClick={()=>jog(0, inc, 0)}>↑ Y</button>
<div className="col" style={{gap:8}}>
<button onClick={()=>jog(-inc,0,0)}>← X</button>
<button onClick={()=>jog(+inc,0,0)}>→ X</button>
</div>
<button onClick={()=>jog(0,-inc,0)}>↓ Y</button>
<button onClick={()=>jog(0,0,inc)}>Z+</button>
<button onClick={()=>jog(0,0,-inc)}>Z-</button>
</div>
</div>
);
}