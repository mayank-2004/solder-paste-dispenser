// src/components/SerialPanel.jsx
import { useEffect, useRef, useState } from "react";

export default function SerialPanel() {
  const [ports, setPorts] = useState([]);           // [{path, label}]
  const [path, setPath] = useState('');
  const [baud, setBaud] = useState(115200);
  const [connected, setConnected] = useState(false);
  const [consoleLines, setConsoleLines] = useState([]);
  const inputRef = useRef(null);

  const refresh = async () => {
    try {
      const list = await window.serial.list();
      setPorts(list);
      setPath(prev => prev || (list[0]?.path ?? ''));
    } catch (e) {
      console.error('Failed to list serial ports', e);
      setPorts([]);
      setPath('');
    }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    window.serial.onData((line) => {
      setConsoleLines((prev) => [...prev, line].slice(-500));
    });
  }, []);

  const connect = async () => {
    if (!path) {
      alert("Select a serial port first (click Refresh, pick COM/tty, then Connect).");
      return;
    }
    try {
      await window.serial.open({ path, baudRate: baud });
      setConnected(true);
    } catch (e) {
      alert(`Failed to open ${path}: ${e.message || e}`);
    }
  };

  const disconnect = async () => {
    try { await window.serial.close(); } catch {}
    setConnected(false);
  };

  const sendLine = async () => {
    const line = inputRef.current.value.trim();
    if (!line) return;
    inputRef.current.value = '';
    try {
      await window.serial.writeLine(line);
    } catch (e) {
      alert(`Write failed: ${e.message || e}`);
    }
  };

  const sendFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    try {
      await window.serial.sendGcode(text);
    } catch (err) {
      alert(`Send file failed: ${err.message || err}`);
    }
    e.target.value = '';
  };

  return (
    <div className="card">
      <h3>Machine</h3>

      <div className="row">
        <button className="btn secondary" onClick={refresh}>Refresh</button>

        {/* Port dropdown */}
        <select value={path} onChange={e=>setPath(e.target.value)} style={{minWidth:220}}>
          {ports.length === 0
            ? <option value="">(no serial ports found)</option>
            : ports.map(p => (
                <option key={p.path} value={p.path}>
                  {p.label} — {p.path}
                </option>
              ))
          }
        </select>

        <input type="number" value={baud} onChange={e=>setBaud(+e.target.value)} style={{width:120}} />

        <button className="btn" onClick={connect} disabled={!path || connected}>Connect</button>
        <button className="btn secondary" onClick={disconnect} disabled={!connected}>Disconnect</button>
      </div>

      {ports.length === 0 && (
        <div style={{fontSize:12, opacity:.8, marginTop:6}}>
          No ports found. Make sure your machine is plugged in and shows a COM/tty in Device Manager.
          Install drivers if needed (common: FTDI/CP2102/CH340). Click Refresh after plugging in.
        </div>
      )}

      <div className="row" style={{marginTop:8}}>
        <input ref={inputRef} placeholder="G-code line..." style={{flex:1}} />
        <button className="btn" onClick={sendLine} disabled={!connected}>Send</button>
        <label className="btn">
          Send file
          <input type="file" accept=".gcode,.nc,.txt" style={{display:'none'}} onChange={sendFile} disabled={!connected}/>
        </label>
      </div>

      <div className="console" style={{marginTop:8}}>
        {consoleLines.map((l,i)=> <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
