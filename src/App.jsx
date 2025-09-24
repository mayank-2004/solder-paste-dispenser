import React from 'react';
import ImportPanel from './components/ImportPanel.jsx';
import OffsetConfig from './components/OffsetConfig.jsx';
import FiducialsCalib from './components/FiducialsCalib.jsx';
import CameraPanel from './components/CameraPanel.jsx';
import JogPanel from './components/JogPanel.jsx';
import PreviewCanvas from './components/PreviewCanvas.jsx';
import JobPlanner from './components/JobPlanner.jsx';
import JobRunner from './components/JobRunner.jsx';
import GerberViewer from './components/GerberViewer.jsx';
import BoardOriginTools from './components/BoardOriginTools.jsx';

export default function App() {
  const [tab, setTab] = React.useState('import');
  const tabs = [
    ['import', 'Import'], ['offsets', 'Offsets'], ['fid', 'Fiducials'], ['camera', 'Camera'], ['jog', 'Jog'], ['preview', 'Preview'], ['gerber', 'Gerber'], ['plan', 'Plan'], ['run', 'Run'], ['board', 'Board']
  ];

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <div className="nav">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ opacity: tab === id ? 1 : 0.7 }}>{label}</button>
        ))}
      </div>
      {tab === 'import' && <ImportPanel />}
      {tab === 'offsets' && <OffsetConfig />}
      {tab === 'fid' && <FiducialsCalib />}
      {tab === 'camera' && <CameraPanel />}
      {tab === 'jog' && <JogPanel />}
      {tab === 'preview' && <PreviewCanvas />}
      {tab === 'gerber' && <GerberViewer />}
      {tab === 'board' && <BoardOriginTools />}
      {tab === 'plan' && <JobPlanner />}
      {tab === 'run' && <JobRunner />}
    </div>
  );
}