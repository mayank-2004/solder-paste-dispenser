import React from 'react';
import { useStore } from '../state/useStore.js';


export default function OffsetConfig() {
    const cfg = useStore(s => s.config);
    const setCfg = useStore(s => s.setConfig);


    const upd = (path, v) => {
        const parts = path.split('.');
        const next = JSON.parse(JSON.stringify(cfg));
        let o = next; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
        o[parts.at(-1)] = v;
        setCfg(next);
    };


    return (
        <div className="panel">
            <h3 className="h">Offsets & Machine</h3>
            <div className="row">
                <div className="col" style={{ minWidth: 260 }}>
                    <label>Port <input value={cfg.machine.port} onChange={e => upd('machine.port', e.target.value)} placeholder="/dev/ttyACM0" /></label>
                    <label>Baud <input type="number" value={cfg.machine.baud} onChange={e => upd('machine.baud', +e.target.value)} /></label>
                    <label>Units
                        <select value={cfg.machine.units} onChange={e => upd('machine.units', e.target.value)}>
                            <option>mm</option><option>inch</option>
                        </select>
                    </label>
                </div>
                <div className="col">
                    <h4 className="h">Board origin</h4>
                    <div className="row">
                        {['x', 'y', 'z'].map(k => (
                            <label key={k}>{k.toUpperCase()} <input type="number" step="0.01" value={cfg.offsets.boardOrigin[k]} onChange={e => upd(`offsets.boardOrigin.${k}`, +e.target.value)} /></label>
                        ))}
                    </div>
                    <h4 className="h">Homing</h4>
                    <div className="row">
                        <label>
                            Auto-home on connect
                            <input type="checkbox"
                                checked={cfg.homing.onConnect}
                                onChange={e => upd('homing.onConnect', e.target.checked)} />
                        </label>
                        <label>
                            Firmware
                            <select value={cfg.machine.firmware}
                                onChange={e => upd('machine.firmware', e.target.value)}>
                                <option value="marlin">Marlin / RepRap</option>
                                <option value="grbl">GRBL</option>
                            </select>
                        </label>
                    </div>
                    <div className="row">
                        <label style={{ flex: 1 }}>
                            Custom homing G-code (optional)
                            <input placeholder="Leave blank for G28 (Marlin) / $H (GRBL)"
                                value={cfg.homing.gcode}
                                onChange={e => upd('homing.gcode', e.target.value)} />
                        </label>
                    </div>
                    <div className="row">
                        <label>
                            Require unlock
                            <input type="checkbox"
                                checked={cfg.homing.requireUnlock}
                                onChange={e => upd('homing.requireUnlock', e.target.checked)} />
                        </label>
                        <label>
                            Unlock G-code
                            <input value={cfg.homing.unlockGcode}
                                onChange={e => upd('homing.unlockGcode', e.target.value)} />
                        </label>
                    </div>
                    <h4 className="h">Nozzle → Camera offset</h4>
                    <div className="row">
                        {['dx', 'dy', 'dz', 'da'].map(k => (
                            <label key={k}>{k.toUpperCase()} <input type="number" step="0.01" value={cfg.offsets.nozzleToCamera[k]} onChange={e => upd(`offsets.nozzleToCamera.${k}`, +e.target.value)} /></label>
                        ))}
                    </div>
                    <h4 className="h">Paste</h4>
                    <div className="row">
                        {['zSafe', 'zPaste', 'initMs', 'msPerMm2'].map(k => (
                            <label key={k}>{k} <input type="number" step="0.01" value={cfg.offsets.paste[k]} onChange={e => upd(`offsets.paste.${k}`, +e.target.value)} /></label>
                        ))}
                    </div>
                    <h4 className="h">Pick</h4>
                    <div className="row">
                        {['zPickup', 'zPlace'].map(k => (
                            <label key={k}>{k} <input type="number" step="0.01" value={cfg.offsets.pick[k]} onChange={e => upd(`offsets.pick.${k}`, +e.target.value)} /></label>
                        ))}
                    </div>
                    <div className="row">
                        <label>Vacuum ON <input value={cfg.offsets.pick.vacuumOn} onChange={e => upd('offsets.pick.vacuumOn', e.target.value)} /></label>
                        <label>Vacuum OFF <input value={cfg.offsets.pick.vacuumOff} onChange={e => upd('offsets.pick.vacuumOff', e.target.value)} /></label>
                    </div>
                </div>
            </div>
        </div>
    );
}