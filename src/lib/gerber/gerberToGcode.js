export function convertGerberToGcode(gerberText, opts = {}) {
  const cfg = {
    flavor: 'grbl',  
    units: 'auto',
    // GRBL:
    travelZ: 3.0, workZ: -0.02, feedXY: 600, feedZ: 300, toolOn: 'M3', toolOff: 'M5',
    // Marlin (viewer/paste):
    layerZ: 0.2, ePerMm: 0.04,
    ...opts
  };

  const fmt = (n, dp = 4) => Number(n).toFixed(dp);
  const IN2MM = 25.4;

  const paramBlocks = [];
  gerberText.replace(/%[^%]*%/g, (m) => { paramBlocks.push(m); return ''; });

  let fileUnits = 'mm';
  let zeroSupp = 'L';
  let xInt = 2, xDec = 4, yInt = 2, yDec = 4;

  for (const block of paramBlocks) {
    const mo = block.match(/%MO(IN|MM)\*%/i);
    if (mo) fileUnits = mo[1].toLowerCase() === 'in' ? 'in' : 'mm';
    const fs = block.match(/%FS([LT])([AI])X(\d)(\d)Y(\d)(\d)\*%/i);
    if (fs) { zeroSupp = fs[1].toUpperCase(); xInt=+fs[3]; xDec=+fs[4]; yInt=+fs[5]; yDec=+fs[6]; }
  }

  const opsText = gerberText.replace(/%[^%]*%/g, '');
  const tokens = opsText.split('*').map(s => s.trim()).filter(Boolean);

  let units = (cfg.units === 'auto') ? fileUnits : cfg.units;
  let curX = 0, curY = 0, currentD = null, interp = 'G01';

  const parseCoord = (val, i, d, z = zeroSupp) => {
    if (val.includes('.')) return parseFloat(val);
    let sign = 1;
    if (val.startsWith('+')) val = val.slice(1);
    if (val.startsWith('-')) { sign = -1; val = val.slice(1); }
    const total = i + d;
    let s = z === 'L' ? val.padStart(total, '0') : val.padEnd(total, '0');
    return sign * parseFloat(`${s.slice(0,i)}.${s.slice(i)}`);
  };
  const parseXYIJ = (t, last) => {
    const m = {};
    t.replace(/([XYIJ])([+\-]?\d+(?:\.\d+)?)?/gi, (_, k, v) => { m[k.toUpperCase()] = v || ''; return ''; });
    let x = last.x, y = last.y, i = null, j = null;
    if (m.X !== undefined) x = parseCoord(m.X, xInt, xDec);
    if (m.Y !== undefined) y = parseCoord(m.Y, yInt, yDec);
    if (m.I !== undefined && m.I !== '') i = parseCoord(m.I, xInt, xDec);
    if (m.J !== undefined && m.J !== '') j = parseCoord(m.J, yInt, yDec);
    return { x, y, i, j };
  };

  // ---------- MARLIN flavor ----------
  if (cfg.flavor === 'marlin') {
    const out = [];
    let E = 0;
    const mmX = (x) => units === 'in' ? x * IN2MM : x;
    const mmY = (y) => units === 'in' ? y * IN2MM : y;
    const dmm = (x0,y0,x1,y1) => Math.hypot(mmX(x1)-mmX(x0), mmY(y1)-mmY(y0));

    out.push(`;FLAVOR:Marlin`);
    out.push(`G90`); out.push(`G21`); out.push(`M82`); out.push(`G92 E0`);
    out.push(`G0 Z${fmt(cfg.layerZ,3)} F300`);

    for (let raw of tokens) {
      const t = raw.replace(/\s+/g,''); if (!t || /^G0?4/i.test(t)) continue;
      if (/^G0?1$/i.test(t)) { interp='G01'; continue; }
      if (/^G0?2$/i.test(t)) { interp='G02'; continue; }
      if (/^G0?3$/i.test(t)) { interp='G03'; continue; }
      const md = t.match(/D0?([123])$/i); if (md) currentD = +md[1];

      if (/[XY]/i.test(t)) {
        const { x, y } = parseXYIJ(t, { x: curX, y: curY });
        const X = mmX(x), Y = mmY(y);
        if (currentD === 2 || currentD == null) {
          out.push(`G0 X${fmt(X)} Y${fmt(Y)} F12000`);
          curX = x; curY = y; continue;
        }
        if (currentD === 1) {
          const X0 = mmX(curX), Y0 = mmY(curY);
          E += dmm(curX,curY,x,y) * (cfg.ePerMm || 0.04);
          out.push(`G1 X${fmt(X)} Y${fmt(Y)} E${fmt(E,5)} F${fmt(cfg.feedXY,0)}`);
          curX = x; curY = y; continue;
        }
        if (currentD === 3) {
          // flash -> tiny extrusion tick
          out.push(`G0 X${fmt(X)} Y${fmt(Y)} F12000`);
          E += 0.02 * (cfg.ePerMm || 0.04);
          out.push(`G1 X${fmt(X+0.01)} Y${fmt(Y)} E${fmt(E,5)} F${fmt(cfg.feedXY,0)}`);
          curX = x; curY = y; continue;
        }
      }
    }
    out.push(`G92 E0`); out.push(`M84`);
    return out.join('\n');
  }

  // ---------- GRBL flavor ----------
  const out = [];
  const push = (s) => out.push(s);
  push(units === 'in' ? 'G20' : 'G21');
  push('G90'); push('G94'); push(`F${fmt(cfg.feedXY,2)}`); push(`G0 Z${fmt(cfg.travelZ,3)}`);

  const toolOn  = () => push(cfg.toolOn);
  const toolOff = () => push(cfg.toolOff);
  const plunge  = () => push(`G1 Z${fmt(cfg.workZ,3)} F${fmt(cfg.feedZ,2)}`);
  const retract = () => push(`G0 Z${fmt(cfg.travelZ,3)}`);
  const rapidXY = (x,y) => push(`G0 X${fmt(x)} Y${fmt(y)}`);
  const lineXY  = (x,y) => push(`G1 X${fmt(x)} Y${fmt(y)}`);
  const arcXYIJ = (code, x, y, i, j) => push(`${code} X${fmt(x)} Y${fmt(y)} I${fmt(i)} J${fmt(j)}`);

  for (let raw of tokens) {
    const t = raw.replace(/\s+/g,''); if (!t || /^G0?4/i.test(t)) continue;
    if (/^G70$/i.test(t)) { units='in'; push('G20'); continue; }
    if (/^G71$/i.test(t)) { units='mm'; push('G21'); continue; }
    if (/^G0?1$/i.test(t)) { interp='G01'; continue; }
    if (/^G0?2$/i.test(t)) { interp='G02'; continue; }
    if (/^G0?3$/i.test(t)) { interp='G03'; continue; }
    const md = t.match(/D0?([123])$/i); if (md) currentD = +md[1];

    if (/[XY]/i.test(t)) {
      const { x, y, i, j } = parseXYIJ(t, { x: curX, y: curY });
      if (currentD === 2 || currentD == null) { rapidXY(x,y); curX=x; curY=y; continue; }
      if (currentD === 1) {
        rapidXY(curX,curY); plunge(); toolOn();
        if ((interp==='G02'||interp==='G03') && i!=null && j!=null) arcXYIJ(interp,x,y,i,j);
        else lineXY(x,y);
        toolOff(); retract(); curX=x; curY=y; continue;
      }
      if (currentD === 3) { rapidXY(x,y); plunge(); toolOn(); toolOff(); retract(); curX=x; curY=y; continue; }
    }
  }
  push(`G0 Z${fmt(cfg.travelZ,3)}`); push('G0 X0 Y0'); push(cfg.toolOff);
  return out.join('\n');
}
