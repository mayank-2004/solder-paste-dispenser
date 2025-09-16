import { useEffect, useRef, useState } from "react";

export default function CameraPanel() {
  const videoRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    (async () => {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter(d => d.kind === 'videoinput'));
    })();
  }, []);

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true
    });
    videoRef.current.srcObject = stream;
    await videoRef.current.play();
  };
  const stop = () => {
    const s = videoRef.current?.srcObject;
    s?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  return (
    <div className="card">
      <h3>Camera</h3>
      <div className="row">
        <select value={deviceId} onChange={e=>setDeviceId(e.target.value)}>
          <option value="">Default camera</option>
          {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
        </select>
        <button className="btn" onClick={start}>Start</button>
        <button className="btn secondary" onClick={stop}>Stop</button>
      </div>
      <video ref={videoRef} style={{width:"100%", borderRadius:8}} />
    </div>
  );
}
