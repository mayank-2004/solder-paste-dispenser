// src/components/ImportPanel.jsx
// import React from 'react';
// import { useStore } from '../state/useStore.js';
// import { parseRPTorPOS, aggregateBOM } from '../lib/rpt-parser.js';
// import { extractPastePadsFromZip } from '../lib/gerber.js';

// const CANDIDATES = [/\.pos$/i, /\.rpt$/i, /\.csv$/i];

// export default function ImportPanel() {
//     const setParts = useStore(s => s.setParts);
//     const setPads = useStore(s => s.setPads);
//     const [bom, setBom] = React.useState([]);
//     const [status, setStatus] = React.useState('');

//     async function safeLoadZip(base64) {
//         const mod = await import('jszip');
//         const Maybe = mod?.default ?? mod?.JSZip ?? mod;
//         if (typeof Maybe?.loadAsync === 'function') {
//             return await Maybe.loadAsync(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
//         } else {
//             const inst = new Maybe();
//             return await inst.loadAsync(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
//         }
//     }

//     async function pickFile() {
//         try {
//             setStatus('Opening picker…');
//             setBom([]); setParts([]); setPads([]);

//             if (!window.api?.files?.openAny) {
//                 console.error('[ImportPanel] window.api.files.openAny missing');
//                 setStatus('Bridge not available. Check preload.js exposure.');
//                 return;
//             }
//             const file = await window.api.files.openAny();
//             if (!file) { setStatus('No file selected'); return; }

//             if (file.kind === 'text') {
//                 const parts = parseRPTorPOS(file.text);
//                 if (!parts.length) throw new Error('No placement rows found in text file');
//                 setParts(parts);
//                 setBom(aggregateBOM(parts));
//                 setStatus(`Loaded ${parts.length} parts from ${file.name}`);
//                 return;
//             }

//             if (file.kind === 'zip') {
//                 // 1) Try to find placement (.pos/.rpt/.csv) inside the ZIP
//                 const zip = await safeLoadZip(file.base64);
//                 const names = Object.keys(zip.files);
//                 const posName =
//                     names.find(n => CANDIDATES[0].test(n)) ||
//                     names.find(n => CANDIDATES[1].test(n)) ||
//                     names.find(n => CANDIDATES[2].test(n));

//                 if (posName) {
//                     const text = await zip.file(posName).async('string');
//                     const parts = parseRPTorPOS(text);
//                     if (!parts.length) throw new Error(`Found ${posName}, but it didn’t parse`);
//                     setParts(parts);
//                     setBom(aggregateBOM(parts));
//                     setStatus(`Loaded ${parts.length} parts from ${posName}`);
//                     return;
//                 }

//                 // 2) Otherwise, parse Gerber Top Paste and create pads for paste G-code
//                 const { pasteName, pads } = await extractPastePadsFromZip(file.base64);
//                 setPads(pads);
//                 setStatus(`Loaded ${pads.length} paste apertures from ${pasteName}`);
//                 return;
//             }

//             throw new Error('Unsupported file format');
//         } catch (err) {
//             console.error('[ImportPanel] Import error:', err);
//             setStatus(`Import error: ${err.message}`);
//         }
//     }

//     return (
//         <div className="panel">
//             <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
//                 <h3 className="h">Import Placement or Gerber ZIP</h3>
//                 <button type="button" onClick={pickFile}>Open file…</button>
//             </div>
//             {status && <div style={{ marginTop: 8 }}><span className="badge">{status}</span></div>}
//             <hr />
//             <div className="row" style={{ gap: 20 }}>
//                 <div><span className="badge">BOM</span></div>
//                 <div>
//                     {bom.length === 0 ? <div>No placement BOM (Gerber paste uses apertures)</div> :
//                         bom.map(r => <div key={r.k}>{r.k} — {r.count}</div>)}
//                 </div>
//             </div>
//         </div>
//     );
// }


import React, { useState } from 'react';
import { Upload, Download, Settings, Play, Square, Circle, RotateCcw, FileText, Zap } from 'lucide-react';

// ZIP file handler for Gerber files
class GerberZipHandler {
    static async loadZip(file) {
        // Use your existing safeLoadZip function
        const base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(file);
        });
        return await GerberZipHandler.safeLoadZip(base64);
    }

    static async safeLoadZip(base64) {
    const mod = await import('jszip');
    const Maybe = mod?.default ?? mod?.JSZip ?? mod;
    if (typeof Maybe?.loadAsync === 'function') {
        return await Maybe.loadAsync(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
    } else {
        const inst = new Maybe();
        return await inst.loadAsync(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
    }
}

    static async extractGerberFiles(zip) {
    const gerberFiles = {};
    const gerberExtensions = [
        '.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo',
        '.gtp', '.gbp', '.gko', '.drl', '.txt', '.nc'
    ];

    for (const filename of Object.keys(zip.files)) {
        const file = zip.files[filename];
        if (!file.dir && !filename.startsWith('__MACOSX/')) {
            const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
            const baseName = filename.toLowerCase();

            // Check for gerber extensions or common gerber patterns
            if (gerberExtensions.includes(ext) ||
                baseName.includes('gerber') ||
                baseName.includes('copper') ||
                baseName.includes('drill') ||
                baseName.includes('paste') ||
                baseName.includes('mask') ||
                baseName.includes('silk')) {
                try {
                    const content = await file.async('string');
                    // Validate that it looks like Gerber content
                    if (content.includes('G04') || content.includes('%') || content.includes('D') || content.includes('X') || content.includes('Y')) {
                        gerberFiles[filename] = content;
                    }
                } catch (error) {
                    console.warn(`Failed to extract ${filename}:`, error);
                }
            }
        }
    }

    return gerberFiles;
}

    static detectLayerType(filename) {
    const fn = filename.toLowerCase();
    if (fn.includes('top') && (fn.includes('copper') || fn.includes('.gtl'))) return 'copper-top';
    if (fn.includes('bottom') && (fn.includes('copper') || fn.includes('.gbl'))) return 'copper-bottom';
    if (fn.includes('paste') || fn.includes('.gtp') || fn.includes('.gbp')) return 'paste';
    if (fn.includes('drill') || fn.includes('.drl') || fn.includes('.txt') || fn.includes('.nc')) return 'drill';
    if (fn.includes('outline') || fn.includes('edge') || fn.includes('.gko') || fn.includes('cutout')) return 'outline';
    if (fn.includes('mask') || fn.includes('.gts') || fn.includes('.gbs')) return 'soldermask';
    if (fn.includes('silk') || fn.includes('.gto') || fn.includes('.gbo')) return 'silkscreen';
    if (fn.includes('.gtl') || fn.includes('top')) return 'copper-top';
    if (fn.includes('.gbl') || fn.includes('bottom')) return 'copper-bottom';
    return 'copper';
}
}

// Enhanced Gerber parser that handles multiple layer types
class GerberParser {
    constructor() {
        this.apertures = {};
        this.commands = [];
        this.currentPos = { x: 0, y: 0 };
        this.currentAperture = null;
        this.interpolationMode = 'LINEAR';
        this.units = 'MM';
        this.formatSpec = { integer: 3, decimal: 3 };
        this.bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    }

    parseGerber(gerberContent) {
        const lines = gerberContent.split(/\r?\n/).map(line => line.trim()).filter(line => line);

        // Reset state
        this.commands = [];
        this.currentPos = { x: 0, y: 0 };
        this.bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

        for (const line of lines) {
            try {
                this.parseLine(line);
            } catch (error) {
                console.warn(`Error parsing line "${line}":`, error);
            }
        }

        return {
            apertures: this.apertures,
            commands: this.commands,
            units: this.units,
            formatSpec: this.formatSpec,
            bounds: this.bounds
        };
    }

    parseLine(line) {
        // Handle comments
        if (line.startsWith('G04') || line.startsWith('#')) return;

        // Handle format specification
        if (line.includes('%FSLAX')) {
            const match = line.match(/%FSLAX(\d)(\d)Y(\d)(\d)\*%/);
            if (match) {
                this.formatSpec = {
                    integer: parseInt(match[1]),
                    decimal: parseInt(match[2])
                };
            }
            return;
        }

        // Handle units
        if (line.includes('%MOMM*%')) {
            this.units = 'MM';
            return;
        }
        if (line.includes('%MOIN*%')) {
            this.units = 'INCH';
            return;
        }

        // Handle aperture definitions
        if (line.includes('%ADD')) {
            this.parseApertureDefinition(line);
            return;
        }

        // Handle aperture selection
        if (line.match(/^D\d+\*?$/)) {
            this.currentAperture = line.replace('*', '');
            return;
        }

        // Handle interpolation modes
        if (line.includes('G01')) this.interpolationMode = 'LINEAR';
        if (line.includes('G02')) this.interpolationMode = 'CIRCULAR_CW';
        if (line.includes('G03')) this.interpolationMode = 'CIRCULAR_CCW';

        // Handle coordinate commands
        if (line.includes('X') || line.includes('Y') || line.includes('D01') || line.includes('D02') || line.includes('D03')) {
            this.parseCoordinateCommand(line);
        }
    }

    parseApertureDefinition(line) {
        const match = line.match(/%ADD(\d+)([CR])([^*]*)\*%/);
        if (match) {
            const [, id, type, params] = match;
            const paramList = params.split('X').map(p => parseFloat(p)).filter(p => !isNaN(p));

            this.apertures[`D${id}`] = {
                type: type === 'C' ? 'CIRCLE' : 'RECTANGLE',
                diameter: paramList[0] || 0,
                width: paramList[0] || 0,
                height: paramList[1] || paramList[0] || 0
            };
        }
    }

    parseCoordinateCommand(line) {
        const xMatch = line.match(/X(-?\d+)/);
        const yMatch = line.match(/Y(-?\d+)/);
        const operation = line.includes('D01') ? 'INTERPOLATE' :
            line.includes('D02') ? 'MOVE' :
                line.includes('D03') ? 'FLASH' : 'MOVE';

        let x = this.currentPos.x;
        let y = this.currentPos.y;

        if (xMatch) {
            x = this.formatCoordinate(parseInt(xMatch[1]));
        }
        if (yMatch) {
            y = this.formatCoordinate(parseInt(yMatch[1]));
        }

        // Update bounds
        this.bounds.minX = Math.min(this.bounds.minX, x);
        this.bounds.maxX = Math.max(this.bounds.maxX, x);
        this.bounds.minY = Math.min(this.bounds.minY, y);
        this.bounds.maxY = Math.max(this.bounds.maxY, y);

        this.commands.push({
            type: operation,
            from: { ...this.currentPos },
            to: { x, y },
            aperture: this.currentAperture,
            interpolationMode: this.interpolationMode
        });

        this.currentPos = { x, y };
    }

    formatCoordinate(rawCoord) {
        const divisor = Math.pow(10, this.formatSpec.decimal);
        return rawCoord / divisor;
    }
}

// G-Code generator class
class GCodeGenerator {
    constructor(config = {}) {
        this.config = {
            feedRate: 1000,
            travelHeight: 5,
            workHeight: 0.1,
            spindleSpeed: 0,
            units: 'G21',
            homeAfterJob: true,
            safetyHeight: 10,
            ...config
        };
    }

    generateFromGerber(gerberData, layerType = 'copper') {
        const gcode = [];

        // Header
        gcode.push('; Generated G-Code from Gerber file');
        gcode.push('; Layer type: ' + layerType);
        gcode.push('; Generated on: ' + new Date().toISOString());
        if (gerberData.bounds) {
            gcode.push(`; Bounds: X(${gerberData.bounds.minX.toFixed(3)} to ${gerberData.bounds.maxX.toFixed(3)}) Y(${gerberData.bounds.minY.toFixed(3)} to ${gerberData.bounds.maxY.toFixed(3)})`);
        }
        gcode.push('');

        // Initialization
        gcode.push(this.config.units); // Set units
        gcode.push('G90'); // Absolute positioning
        gcode.push('G17'); // XY plane selection
        gcode.push('G94'); // Feed rate per minute
        gcode.push(`F${this.config.feedRate}`); // Set feed rate

        if (this.config.spindleSpeed > 0) {
            gcode.push(`S${this.config.spindleSpeed}`);
            gcode.push('M03'); // Start spindle
        }

        // Move to safe height
        gcode.push(`G0 Z${this.config.safetyHeight}`);
        gcode.push('G4 P1'); // Pause 1 second
        gcode.push('');

        // Process commands based on layer type
        switch (layerType) {
            case 'copper':
            case 'copper-top':
            case 'copper-bottom':
                this.generateCopperTrace(gcode, gerberData);
                break;
            case 'drill':
                this.generateDrillHoles(gcode, gerberData);
                break;
            case 'paste':
                this.generatePasteDispensing(gcode, gerberData);
                break;
            case 'outline':
                this.generateOutlineCut(gcode, gerberData);
                break;
            case 'soldermask':
                this.generateSoldermaskExposure(gcode, gerberData);
                break;
            case 'silkscreen':
                this.generateSilkscreenPrint(gcode, gerberData);
                break;
            default:
                this.generateGenericLayer(gcode, gerberData);
        }

        // Footer
        gcode.push('');
        gcode.push('; End of operations');
        gcode.push(`G0 Z${this.config.safetyHeight}`); // Return to safe height

        if (this.config.spindleSpeed > 0) {
            gcode.push('M05'); // Stop spindle
        }

        if (this.config.homeAfterJob) {
            gcode.push('G28 X Y'); // Home X and Y axes
        }

        gcode.push('M30'); // Program end and rewind

        return gcode.join('\n');
    }

    generateCopperTrace(gcode, gerberData) {
        gcode.push('; Copper trace generation');
        let isDown = false;
        let lastAperture = null;

        for (const cmd of gerberData.commands) {
            const aperture = gerberData.apertures[cmd.aperture];

            // Handle aperture changes
            if (cmd.aperture !== lastAperture && aperture) {
                gcode.push(`; Aperture: ${cmd.aperture} (${aperture.type}, ${aperture.diameter}mm)`);
                lastAperture = cmd.aperture;
            }

            if (cmd.type === 'MOVE') {
                if (isDown) {
                    gcode.push(`G0 Z${this.config.travelHeight}`); // Lift
                    isDown = false;
                }
                gcode.push(`G0 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`);
            } else if (cmd.type === 'INTERPOLATE') {
                if (!isDown) {
                    gcode.push(`G1 Z${this.config.workHeight}`); // Lower
                    isDown = true;
                }
                if (cmd.interpolationMode === 'LINEAR') {
                    gcode.push(`G1 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`);
                } else if (cmd.interpolationMode === 'CIRCULAR_CW') {
                    gcode.push(`G2 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`);
                } else if (cmd.interpolationMode === 'CIRCULAR_CCW') {
                    gcode.push(`G3 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`);
                }
            } else if (cmd.type === 'FLASH') {
                // For flashed apertures (pads), create appropriate geometry
                if (aperture && aperture.type === 'CIRCLE') {
                    this.generateCircularPad(gcode, cmd.to, aperture.diameter);
                } else if (aperture && aperture.type === 'RECTANGLE') {
                    this.generateRectangularPad(gcode, cmd.to, aperture.width, aperture.height);
                }
            }
        }

        if (isDown) {
            gcode.push(`G0 Z${this.config.travelHeight}`); // Final lift
        }
    }

    generateDrillHoles(gcode, gerberData) {
        gcode.push('; Drill hole generation');

        for (const cmd of gerberData.commands) {
            if (cmd.type === 'FLASH') {
                const aperture = gerberData.apertures[cmd.aperture];
                gcode.push(`G0 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`); // Position
                gcode.push(`G0 Z${this.config.travelHeight}`); // Approach height
                gcode.push(`G1 Z${-Math.abs(this.config.workHeight)}`); // Drill down
                gcode.push('G4 P0.1'); // Brief pause
                gcode.push(`G0 Z${this.config.travelHeight}`); // Retract
            }
        }
    }

    generatePasteDispensing(gcode, gerberData) {
        gcode.push('; Solder paste dispensing');

        for (const cmd of gerberData.commands) {
            if (cmd.type === 'FLASH') {
                const aperture = gerberData.apertures[cmd.aperture];
                gcode.push(`G0 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`); // Position
                gcode.push(`G0 Z${this.config.travelHeight}`); // Approach
                gcode.push(`G1 Z${this.config.workHeight}`); // Lower to dispense height
                gcode.push('M106 S255'); // Start paste dispensing (fan/pump on)

                // Calculate dwell time based on aperture size
                const area = aperture ? (aperture.diameter * aperture.diameter * Math.PI / 4) : 1;
                const dwellTime = Math.max(0.2, area * 0.1); // Minimum 0.2s, scale with area
                gcode.push(`G4 P${dwellTime.toFixed(2)}`); // Dwell for dispensing

                gcode.push('M107'); // Stop paste dispensing
                gcode.push(`G0 Z${this.config.travelHeight}`); // Lift
            }
        }
    }

    generateOutlineCut(gcode, gerberData) {
        gcode.push('; PCB outline cutting');
        let isDown = false;
        const cutDepth = -Math.abs(this.config.workHeight);

        for (const cmd of gerberData.commands) {
            if (cmd.type === 'MOVE') {
                if (isDown) {
                    gcode.push(`G0 Z${this.config.travelHeight}`); // Lift
                    isDown = false;
                }
                gcode.push(`G0 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`);
            } else if (cmd.type === 'INTERPOLATE') {
                if (!isDown) {
                    gcode.push(`G1 Z${cutDepth}`); // Cut depth
                    isDown = true;
                }
                if (cmd.interpolationMode === 'LINEAR') {
                    gcode.push(`G1 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`);
                } else if (cmd.interpolationMode === 'CIRCULAR_CW') {
                    gcode.push(`G2 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`);
                } else if (cmd.interpolationMode === 'CIRCULAR_CCW') {
                    gcode.push(`G3 X${cmd.to.x.toFixed(3)} Y${cmd.to.y.toFixed(3)}`);
                }
            }
        }
    }

    generateSoldermaskExposure(gcode, gerberData) {
        gcode.push('; Solder mask exposure (UV/Laser)');
        // Similar to copper trace but optimized for mask exposure
        this.generateCopperTrace(gcode, gerberData);
    }

    generateSilkscreenPrint(gcode, gerberData) {
        gcode.push('; Silkscreen printing');
        // Similar to paste dispensing but for ink
        this.generatePasteDispensing(gcode, gerberData);
    }

    generateGenericLayer(gcode, gerberData) {
        gcode.push('; Generic layer processing');
        this.generateCopperTrace(gcode, gerberData);
    }

    generateCircularPad(gcode, center, diameter) {
        const radius = diameter / 2;
        const steps = Math.max(8, Math.ceil(diameter * 4)); // More steps for larger pads
        const angleStep = (2 * Math.PI) / steps;

        gcode.push(`; Circular pad at (${center.x.toFixed(3)}, ${center.y.toFixed(3)}) diameter ${diameter}`);
        gcode.push(`G0 X${(center.x + radius).toFixed(3)} Y${center.y.toFixed(3)}`);
        gcode.push(`G1 Z${this.config.workHeight}`);

        for (let i = 1; i <= steps; i++) {
            const angle = i * angleStep;
            const x = center.x + radius * Math.cos(angle);
            const y = center.y + radius * Math.sin(angle);
            gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)}`);
        }

        gcode.push(`G0 Z${this.config.travelHeight}`);
    }

    generateRectangularPad(gcode, center, width, height) {
        const halfW = width / 2;
        const halfH = height / 2;

        gcode.push(`; Rectangular pad at (${center.x.toFixed(3)}, ${center.y.toFixed(3)}) ${width}x${height}`);

        // Move to corner and create rectangle
        gcode.push(`G0 X${(center.x - halfW).toFixed(3)} Y${(center.y - halfH).toFixed(3)}`);
        gcode.push(`G1 Z${this.config.workHeight}`);
        gcode.push(`G1 X${(center.x + halfW).toFixed(3)} Y${(center.y - halfH).toFixed(3)}`);
        gcode.push(`G1 X${(center.x + halfW).toFixed(3)} Y${(center.y + halfH).toFixed(3)}`);
        gcode.push(`G1 X${(center.x - halfW).toFixed(3)} Y${(center.y + halfH).toFixed(3)}`);
        gcode.push(`G1 X${(center.x - halfW).toFixed(3)} Y${(center.y - halfH).toFixed(3)}`);
        gcode.push(`G0 Z${this.config.travelHeight}`);
    }
}

// Main React Component
export default function ImportPanel() {
    const [gerberContent, setGerberContent] = useState('');
    const [gcode, setGcode] = useState('');
    const [layerType, setLayerType] = useState('copper');
    const [config, setConfig] = useState({
        feedRate: 1000,
        travelHeight: 5,
        workHeight: 0.1,
        spindleSpeed: 0,
        units: 'G21',
        homeAfterJob: true,
        safetyHeight: 10
    });
    const [status, setStatus] = useState('Ready to load Gerber files');
    const [parsedData, setParsedData] = useState(null);
    const [availableFiles, setAvailableFiles] = useState({});
    const [selectedFile, setSelectedFile] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsProcessing(true);
        try {
            setStatus('Loading file...');

            // Check if it's a ZIP file
            if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip') {
                setStatus('Extracting Gerber files from ZIP...');
                const zip = await GerberZipHandler.loadZip(file);
                const gerberFiles = await GerberZipHandler.extractGerberFiles(zip);

                if (Object.keys(gerberFiles).length === 0) {
                    setStatus('No Gerber files found in ZIP. Please check file contents.');
                    setIsProcessing(false);
                    return;
                }

                setAvailableFiles(gerberFiles);
                const firstFile = Object.keys(gerberFiles)[0];
                setSelectedFile(firstFile);
                setGerberContent(gerberFiles[firstFile]);
                setLayerType(GerberZipHandler.detectLayerType(firstFile));
                setStatus(`Found ${Object.keys(gerberFiles).length} Gerber files. Selected: ${firstFile}`);
            } else {
                // Handle single Gerber file
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    // Check if content looks like binary (ZIP) data
                    if (content.startsWith('PK') || /[\x00-\x08\x0E-\x1F\x7F]/.test(content.substr(0, 100))) {
                        setStatus('File appears to be binary/compressed. Please upload a ZIP file or plain text Gerber file.');
                        setIsProcessing(false);
                        return;
                    }
                    setGerberContent(content);
                    setAvailableFiles({ [file.name]: content });
                    setSelectedFile(file.name);
                    setLayerType(GerberZipHandler.detectLayerType(file.name));
                    setStatus(`Loaded ${file.name} - ${content.length} characters`);
                    setIsProcessing(false);
                };
                reader.readAsText(file);
                return; // Early return for single file
            }
        } catch (error) {
            setStatus(`Error loading file: ${error.message}`);
            console.error(error);
        }
        setIsProcessing(false);
    };

    const handleFileSelection = (filename) => {
        if (availableFiles[filename]) {
            setSelectedFile(filename);
            setGerberContent(availableFiles[filename]);
            setLayerType(GerberZipHandler.detectLayerType(filename));
            setStatus(`Selected: ${filename}`);
            setParsedData(null); // Clear previous parse data
            setGcode(''); // Clear previous G-code
        }
    };

    const parseGerber = () => {
        if (!gerberContent.trim()) {
            setStatus('No Gerber content to parse');
            return;
        }

        setIsProcessing(true);
        try {
            setStatus('Parsing Gerber file...');
            const parser = new GerberParser();
            const data = parser.parseGerber(gerberContent);
            setParsedData(data);
            setStatus(`Parsed ${data.commands.length} commands, ${Object.keys(data.apertures).length} apertures (${data.units})`);
        } catch (error) {
            setStatus(`Parse error: ${error.message}`);
            console.error(error);
        }
        setIsProcessing(false);
    };

    const generateGCode = () => {
        if (!parsedData) {
            setStatus('Please parse Gerber file first');
            return;
        }

        setIsProcessing(true);
        try {
            setStatus('Generating G-Code...');
            const generator = new GCodeGenerator(config);
            const generatedGcode = generator.generateFromGerber(parsedData, layerType);
            setGcode(generatedGcode);
            const lineCount = generatedGcode.split('\n').length;
            setStatus(`Generated ${lineCount} lines of G-Code for ${layerType} layer`);
        } catch (error) {
            setStatus(`Generation error: ${error.message}`);
            console.error(error);
        }
        setIsProcessing(false);
    };

    const downloadGCode = () => {
        if (!gcode) {
            setStatus('No G-Code to download');
            return;
        }

        const blob = new Blob([gcode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedFile.replace(/\.[^/.]+$/, '')}_${layerType}.gcode`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus(`Downloaded: ${selectedFile}_${layerType}.gcode`);
    };

    const clearAll = () => {
        setGerberContent('');
        setGcode('');
        setParsedData(null);
        setAvailableFiles({});
        setSelectedFile('');
        setStatus('Ready to load Gerber files');
    };

    return (
        <div className="max-w-7xl mx-auto p-6 bg-white min-h-screen">
            <div className="mb-6">
                <h1 className="text-4xl font-bold text-gray-800 mb-2">Gerber to G-Code Converter</h1>
                <p className="text-gray-600">Convert Gerber files (including ZIP archives) to G-Code for PCB manufacturing</p>
            </div>

            {/* Status Bar */}
            <div className="bg-gray-100 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${isProcessing ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
                        <span className="font-medium">Status:</span>
                        <span className={isProcessing ? 'text-yellow-600' : 'text-gray-700'}>{status}</span>
                    </div>
                    <button
                        onClick={clearAll}
                        className="flex items-center gap-2 text-red-600 hover:text-red-700 text-sm"
                    >
                        <RotateCcw size={16} />
                        Clear All
                    </button>
                </div>
            </div>

            {/* File Upload */}
            <div className="bg-gray-50 rounded-lg p-6 mb-6">
                <div className="flex items-center gap-4 mb-4">
                    <label className="flex items-center gap-2 cursor-pointer bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-300">
                        <Upload size={16} />
                        Upload Gerber/ZIP File
                        <input
                            type="file"
                            accept=".gbr,.ger,.gtl,.gbl,.gts,.gbs,.gto,.gbo,.gtp,.gbp,.gko,.drl,.txt,.nc,.zip"
                            onChange={handleFileUpload}
                            disabled={isProcessing}
                            className="hidden"
                        />
                    </label>
                    <button
                        onClick={parseGerber}
                        disabled={!gerberContent || isProcessing}
                        className="flex items-center gap-2 bg-green-500 text-white px-6 py-3 rounded-lg hover:bg-green-600 transition-colors disabled:bg-gray-300"
                    >
                        <Settings size={16} />
                        {isProcessing ? 'Parsing...' : 'Parse Gerber'}
                    </button>
                </div>

                {/* File Selection for ZIP files */}
                {Object.keys(availableFiles).length > 1 && (
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-3 text-gray-700">Available Gerber Files:</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {Object.keys(availableFiles).map((filename) => (
                                <button
                                    key={filename}
                                    onClick={() => handleFileSelection(filename)}
                                    disabled={isProcessing}
                                    className={`p-3 text-sm rounded-lg border text-left transition-colors ${selectedFile === filename
                                        ? 'bg-blue-500 text-white border-blue-600 shadow-lg'
                                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400'
                                        }`}
                                >
                                    <div className="font-medium truncate">{filename}</div>
                                    <div className="text-xs opacity-75 mt-1">
                                        {GerberZipHandler.detectLayerType(filename)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Configuration */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <FileText size={16} />
                        Layer Configuration
                    </h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium mb-2">Layer Type</label>
                            <select
                                value={layerType}
                                onChange={(e) => setLayerType(e.target.value)}
                                className="w-full p-3 border rounded-lg bg-white"
                                disabled={isProcessing}
                            >
                                <option value="copper">Generic Copper</option>
                                <option value="copper-top">Top Copper Layer</option>
                                <option value="copper-bottom">Bottom Copper Layer</option>
                                <option value="drill">Drill Holes</option>
                                <option value="paste">Solder Paste</option>
                                <option value="outline">PCB Outline</option>
                                <option value="soldermask">Solder Mask</option>
                                <option value="silkscreen">Silkscreen</option>
                            </select>
                        </div>
                        {selectedFile && (
                            <div className="bg-blue-50 p-3 rounded border border-blue-200">
                                <div className="text-sm text-blue-700">
                                    <strong>Auto-detected:</strong> {GerberZipHandler.detectLayerType(selectedFile)}
                                </div>
                                <div className="text-xs text-blue-600 mt-1">
                                    File: {selectedFile}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <Settings size={16} />
                        G-Code Settings
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Feed Rate (mm/min)</label>
                            <input
                                type="number"
                                value={config.feedRate}
                                onChange={(e) => setConfig({ ...config, feedRate: Number(e.target.value) })}
                                className="w-full p-2 border rounded-lg"
                                min="1"
                                max="10000"
                                disabled={isProcessing}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Travel Height (mm)</label>
                            <input
                                type="number"
                                step="0.1"
                                value={config.travelHeight}
                                onChange={(e) => setConfig({ ...config, travelHeight: Number(e.target.value) })}
                                className="w-full p-2 border rounded-lg"
                                min="0.1"
                                max="50"
                                disabled={isProcessing}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Work Height (mm)</label>
                            <input
                                type="number"
                                step="0.1"
                                value={config.workHeight}
                                onChange={(e) => setConfig({ ...config, workHeight: Number(e.target.value) })}
                                className="w-full p-2 border rounded-lg"
                                min="-10"
                                max="10"
                                disabled={isProcessing}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Spindle Speed (RPM)</label>
                            <input
                                type="number"
                                value={config.spindleSpeed}
                                onChange={(e) => setConfig({ ...config, spindleSpeed: Number(e.target.value) })}
                                className="w-full p-2 border rounded-lg"
                                min="0"
                                max="30000"
                                disabled={isProcessing}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Safety Height (mm)</label>
                            <input
                                type="number"
                                step="0.1"
                                value={config.safetyHeight}
                                onChange={(e) => setConfig({ ...config, safetyHeight: Number(e.target.value) })}
                                className="w-full p-2 border rounded-lg"
                                min="1"
                                max="100"
                                disabled={isProcessing}
                            />
                        </div>
                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                id="homeAfterJob"
                                checked={config.homeAfterJob}
                                onChange={(e) => setConfig({ ...config, homeAfterJob: e.target.checked })}
                                className="mr-2"
                                disabled={isProcessing}
                            />
                            <label htmlFor="homeAfterJob" className="text-sm font-medium">
                                Home after job
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {/* Generation Controls */}
            <div className="flex flex-wrap gap-4 mb-6">
                <button
                    onClick={generateGCode}
                    disabled={!parsedData || isProcessing}
                    className="flex items-center gap-2 bg-purple-500 text-white px-6 py-3 rounded-lg hover:bg-purple-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                    <Play size={16} />
                    {isProcessing ? 'Generating...' : 'Generate G-Code'}
                </button>
                <button
                    onClick={downloadGCode}
                    disabled={!gcode || isProcessing}
                    className="flex items-center gap-2 bg-orange-500 text-white px-6 py-3 rounded-lg hover:bg-orange-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                    <Download size={16} />
                    Download G-Code
                </button>
            </div>

            {/* Preview Panels */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                <div className="bg-white border rounded-lg">
                    <div className="border-b p-4">
                        <h3 className="font-semibold flex items-center gap-2">
                            <FileText size={16} />
                            Gerber Content
                            {gerberContent && (
                                <span className="text-sm text-gray-500">
                                    ({gerberContent.length.toLocaleString()} chars)
                                </span>
                            )}
                        </h3>
                    </div>
                    <div className="p-4">
                        <textarea
                            value={gerberContent}
                            onChange={(e) => setGerberContent(e.target.value)}
                            className="w-full h-96 p-3 border rounded-lg font-mono text-sm resize-none"
                            placeholder="Upload a Gerber file or paste content here..."
                            disabled={isProcessing}
                        />
                    </div>
                </div>

                <div className="bg-white border rounded-lg">
                    <div className="border-b p-4">
                        <h3 className="font-semibold flex items-center gap-2">
                            <Zap size={16} />
                            Generated G-Code
                            {gcode && (
                                <span className="text-sm text-gray-500">
                                    ({gcode.split('\n').length} lines)
                                </span>
                            )}
                        </h3>
                    </div>
                    <div className="p-4">
                        <textarea
                            value={gcode}
                            readOnly
                            className="w-full h-96 p-3 border rounded-lg font-mono text-sm bg-gray-50 resize-none"
                            placeholder="G-Code will appear here after generation..."
                        />
                    </div>
                </div>
            </div>

            {/* Parsed Data Summary */}
            {parsedData && (
                <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <Circle size={16} />
                        Parsed Data Summary
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div className="text-center">
                            <div className="text-3xl font-bold text-blue-600">{parsedData.commands.length}</div>
                            <div className="text-sm text-gray-600">Commands</div>
                            <div className="text-xs text-gray-500 mt-1">
                                Draw, Move, Flash operations
                            </div>
                        </div>
                        <div className="text-center">
                            <div className="text-3xl font-bold text-green-600">{Object.keys(parsedData.apertures).length}</div>
                            <div className="text-sm text-gray-600">Apertures</div>
                            <div className="text-xs text-gray-500 mt-1">
                                Tools/shapes defined
                            </div>
                        </div>
                        <div className="text-center">
                            <div className="text-3xl font-bold text-purple-600">{parsedData.units}</div>
                            <div className="text-sm text-gray-600">Units</div>
                            <div className="text-xs text-gray-500 mt-1">
                                Measurement system
                            </div>
                        </div>
                        <div className="text-center">
                            {parsedData.bounds && (
                                <>
                                    <div className="text-xl font-bold text-orange-600">
                                        {(parsedData.bounds.maxX - parsedData.bounds.minX).toFixed(1)}×{(parsedData.bounds.maxY - parsedData.bounds.minY).toFixed(1)}
                                    </div>
                                    <div className="text-sm text-gray-600">Size ({parsedData.units})</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        Width × Height
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Aperture Details */}
                    {Object.keys(parsedData.apertures).length > 0 && (
                        <div className="mt-6">
                            <h4 className="font-medium mb-2">Aperture Details:</h4>
                            <div className="bg-white rounded p-3 max-h-32 overflow-y-auto">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                                    {Object.entries(parsedData.apertures).map(([id, aperture]) => (
                                        <div key={id} className="flex justify-between items-center py-1">
                                            <span className="font-mono text-blue-600">{id}</span>
                                            <span className="text-gray-600">
                                                {aperture.type} {aperture.diameter?.toFixed(2) || aperture.width?.toFixed(2)}mm
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Layer Type Information */}
            {/* <div className="mt-6 bg-gray-50 rounded-lg p-4">
                <h3 className="font-semibold mb-3">Layer Type Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div className="bg-white p-3 rounded border">
                        <div className="font-medium text-blue-600 mb-1">Copper Traces</div>
                        <div className="text-gray-600">Tool path for etching/milling copper traces</div>
                    </div>
                    <div className="bg-white p-3 rounded border">
                        <div className="font-medium text-green-600 mb-1">Drill Holes</div>
                        <div className="text-gray-600">Point-to-point drilling operations</div>
                    </div>
                    <div className="bg-white p-3 rounded border">
                        <div className="font-medium text-orange-600 mb-1">Solder Paste</div>
                        <div className="text-gray-600">Dispensing operations with dwell times</div>
                    </div>
                    <div className="bg-white p-3 rounded border">
                        <div className="font-medium text-red-600 mb-1">PCB Outline</div>
                        <div className="text-gray-600">Cutting operations for board shape</div>
                    </div>
                </div>
            </div> */}
        </div>
    );
}