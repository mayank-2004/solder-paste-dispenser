import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    serial: {
        list: () => ipcRenderer.invoke('serial:list'),
        open: (cfg) => ipcRenderer.invoke('serial:open', cfg),
        close: () => ipcRenderer.invoke('serial:close'),
        onLine: (cb) => ipcRenderer.on('serial:line', (_e, line) => cb(line)),
    },
    gcode: {
        send: (line) => ipcRenderer.invoke('gcode:send', { line }),
        sendMany: (lines) => ipcRenderer.invoke('gcode:sendMany', { lines })
    },
    files: {
        openText: () => ipcRenderer.invoke('file:openText'),
        openAny: () => ipcRenderer.invoke('file:openAny'),
        saveText: (opts) => ipcRenderer.invoke('file:saveText', opts),
    },
    machine: {
        home: (opts) => ipcRenderer.invoke('machine:home', opts)
    }
});