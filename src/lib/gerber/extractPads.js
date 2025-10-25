const IN2MM = 25.4;

export function extractPadsMm(gerberText) {
  const paramBlocks = [];
  gerberText.replace(/%[^%]*%/g, (m) => { paramBlocks.push(m); return ''; });

  let units = 'mm';
  let zeroSupp = 'L';
  let xInt = 2, xDec = 4, yInt = 2, yDec = 4;
  const apertures = {};

  for (const block of paramBlocks) {
    const mo = block.match(/%MO(IN|MM)\*%/i);
    if (mo) units = mo[1].toLowerCase() === 'in' ? 'in' : 'mm';
    const fs = block.match(/%FS([LT])([AI])X(\d)(\d)Y(\d)(\d)\*%/i);
    if (fs) { zeroSupp = fs[1].toUpperCase(); xInt=+fs[3]; xDec=+fs[4]; yInt=+fs[5]; yDec=+fs[6]; }
    
    // Parse aperture definitions
    const ad = block.match(/%ADD(\d+)([CR]),([\.\d]+)(?:X([\d\.]+))?\*%/i);
    if (ad) {
      const [, dCode, shape, size1, size2] = ad;
      const s1 = parseFloat(size1);
      const s2 = size2 ? parseFloat(size2) : s1;
      apertures[parseInt(dCode)] = {
        shape: shape.toUpperCase(),
        width: shape === 'C' ? s1 : s1, // Circle: diameter, Rectangle: width
        height: shape === 'C' ? s1 : s2 // Circle: diameter, Rectangle: height
      };
    }
  }

  const opsText = gerberText.replace(/%[^%]*%/g, '');
  const tokens = opsText.split('*').map(s => s.trim()).filter(Boolean);

  const parseCoord = (val, i, d, z = zeroSupp) => {
    if (val.includes('.')) return parseFloat(val);
    let sign = 1;
    if (val.startsWith('+')) val = val.slice(1);
    if (val.startsWith('-')) { sign = -1; val = val.slice(1); }
    const total = i + d;
    let s = z === 'L' ? val.padStart(total, '0') : val.padEnd(total, '0');
    return sign * parseFloat(`${s.slice(0,i)}.${s.slice(i)}`);
  };

  const parseXY = (t, last) => {
    const m = {};
    t.replace(/([XY])([+\-]?\d+(?:\.\d+)?)?/gi, (_, k, v) => { m[k.toUpperCase()] = v || ''; return ''; });
    let x = last.x, y = last.y;
    if (m.X !== undefined) x = parseCoord(m.X, xInt, xDec);
    if (m.Y !== undefined) y = parseCoord(m.Y, yInt, yDec);
    return { x, y };
  };

  let curX = 0, curY = 0, currentD = null;
  const pads = [];

  for (const raw of tokens) {
    const t = raw.replace(/\s+/g, '');
    if (!t || /^G0?4/i.test(t)) continue;

    const md = t.match(/D0?(\d+)$/i);
    if (md) currentD = +md[1];

    if (/[XY]/i.test(t)) {
      const { x, y } = parseXY(t, { x: curX, y: curY });
      if (currentD === 2 || currentD == null) { curX=x; curY=y; continue; }
      if (currentD === 1) { curX=x; curY=y; continue; }
      if (currentD === 3) { // FLASH
        // Find aperture for current D-code, fallback to reasonable defaults
        let aperture = null;
        for (const [dCode, apt] of Object.entries(apertures)) {
          if (parseInt(dCode) >= 10) { // Skip D01, D02, D03 codes
            aperture = apt;
            break;
          }
        }
        if (!aperture) aperture = { width: 1.0, height: 1.0, shape: 'C' };
        
        pads.push({ 
          x, 
          y, 
          width: aperture.width, 
          height: aperture.height,
          shape: aperture.shape
        });
        curX=x; curY=y; continue;
      }
    }
  }

  if (units === 'in') {
    return pads.map(p => ({ 
      x: p.x * IN2MM, 
      y: p.y * IN2MM,
      width: p.width * IN2MM,
      height: p.height * IN2MM,
      shape: p.shape
    }));
  }
  return pads;
}
