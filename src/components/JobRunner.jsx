import React, { use } from 'react';
import { useStore } from '../state/useStore';

export default function JobRunner() {
    const [connected, setConnected] = React.useState(false);
    const [ports, setPorts] = React.useState([]);
    const [log, setLog] = React.useState([]);
    const [sel, setSel] = React.useState('');

    const cfg = useStore(s => s.config);

    React.useEffect(() => {
        window.api.serial.list().then(setPorts);
        window.api.serial.onLine(line => setLog(l => [...l, line].slice(-200)));
    }, []);


    const open = async () => {
        await window.api.serial.open({ path: sel, baudRate: cfg.machine.baud, firmware: cfg.machine.firmware, homing: cfg.homing });
        setConnected(true);
    };

    const close = async () => { await window.api.serial.close(); setConnected(false); };


    const send = async () => {
        const ta = document.getElementById('gcode-ta');
        const lines = ta.value.split(/\r?\n/).filter(Boolean);
        await window.api.gcode.sendMany({ lines });
    };


    return (
        <div className="panel">
            <h3 className="h">Send to Machine</h3>
            <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                <select value={sel} onChange={e => setSel(e.target.value)}>
                    <option value="">Select port…</option>
                    {ports.map(p => <option key={p.path} value={p.path}>{p.path}</option>)}
                </select>
                <button onClick={() => window.api.machine.home({
                    firmware: cfg.machine.firmware,
                    gcode: cfg.homing.gcode,
                    requireUnlock: cfg.homing.requireUnlock,
                    unlockGcode: cfg.homing.unlockGcode
                })} disabled={!connected}>Home</button>
                {!connected ? <button onClick={open}>Open</button> : <button onClick={close}>Close</button>}
                <button onClick={send} disabled={!connected}>Stream current G‑code</button>
            </div>
            <textarea id="gcode-ta" placeholder="Paste or build G‑code here" style={{ width: '100%', height: 160, background: '#0e1217', color: '#cfeaff', borderRadius: 12, padding: 10 }} />
            <div style={{ marginTop: 8 }}>
                <div className="h">Machine log</div>
                <div style={{ height: 160, overflow: 'auto', background: '#0e1217', border: '1px solid #1e2a38', borderRadius: 12, padding: 8 }}>
                    {log.map((l, i) => <div key={i} style={{ color: l.startsWith('error') ? '#ff7788' : '#9bd7ff' }}>{l}</div>)}
                </div>
            </div>
        </div>
    );
}