// src/components/CameraPanel.jsx
import React from 'react';

export default function CameraPanel() {
  const videoRef = React.useRef(null);
  const [status, setStatus] = React.useState('');

  React.useEffect(() => {
    let stream;
    (async () => {
      try {
        setStatus('Opening camera…');
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
          setStatus('');
        } else {
          setStatus('Video element not ready');
        }
      } catch (e) {
        console.error('Camera error', e);
        setStatus(`Camera error: ${e.message}`);
      }
    })();

    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="panel">
      <h3 className="h">Camera</h3>
      {status && <div style={{marginBottom:8}}><span className="badge">{status}</span></div>}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: 360, background: '#000', borderRadius: 12 }}
      />
    </div>
  );
}
