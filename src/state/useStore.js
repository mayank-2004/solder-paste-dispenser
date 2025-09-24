import { create } from 'zustand';

const defaultConfig = {
    machine: { port: '', baud: 115200, units: 'mm', firmware: 'marlin' },
    homing: {
        onConnect: true,
        gcode: '',
        requireUnlock: false,
        unlockGcode: '$X'
    },
    axes: { hasA: true },
    offsets: {
        boardOrigin: { x: 0, y: 0, z: 0 },
        nozzleToCamera: { dx: 0, dy: 0, dz: 0, da: 0 },
        paste: { zSafe: 5, zPaste: 0.1, initMs: 100, msPerMm2: 25 },
        pick: { zPickup: 0.2, zPlace: 0.1, vacuumOn: 'M106 S255', vacuumOff: 'M107' }
    },
    componentSources: {
        // footprint@value -> tape descriptor {origin:{x,y,z}, spacing:{dx,dy}, angle, count}
    },
    transform: {
        rotationDeg: 0, scale: 1, tx: 0, ty: 0
    }
};


export const useStore = create((set, get) => ({
    config: JSON.parse(localStorage.getItem('pnp-config') || 'null') || defaultConfig,
    setConfig: (partial) => set((s) => {
        const merged = { ...s.config, ...partial };
        localStorage.setItem('pnp-config', JSON.stringify(merged));
        return { config: merged };
    }),
    parts: [], // parsed from KiCad .pos/.rpt
    pads: [], // optional: if you parse pad-level
    setParts: (parts) => set({ parts }),
    setPads: (pads) => set({ pads })
}));