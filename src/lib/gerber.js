const PASTE_MATCH = /(F[_\-\. ]?Paste|Top[_\-\. ]?Paste|\.gtp$|\.gxp$|\.gct$|\.cream$|paste\.gbr$)/i;

export async function extractPastePadsFromZip(base64Zip) {
  const JSZip = (await import('jszip')).default;
  const { parse: parseGerber } = await import('@tracespace/parser');
  const { plot } = await import('@tracespace/plotter');

  const bin = Uint8Array.from(atob(base64Zip), c => c.charCodeAt(0));
  const zip = await JSZip.loadAsync(bin);

  const entries = Object.keys(zip.files);
  const pasteName = entries.find(n => PASTE_MATCH.test(n));
  if (!pasteName) throw new Error('No Top Paste layer found in ZIP (e.g., F_Paste.gbr, .gtp)');

  const pasteText = await zip.file(pasteName).async('string');

  // Parse Gerber and convert to polygons
  const ast = parseGerber(pasteText);
  const image = plot(ast, { precision: 6 });

  const pads = [];
  const shapes = image.layers?.[0]?.shapes || [];
  for (const shape of shapes) {
    if (shape.type !== 'polygon') continue;
    const pts = shape.points.map(([x, y]) => ({ x, y }));
    const { area, cx, cy } = polygonAreaCentroid(pts);
    if (area <= 0) continue;
    pads.push({ x: cx, y: cy, area, polygon: pts });
  }
  if (!pads.length) throw new Error('No paste apertures detected in Top Paste layer');

  return { pasteName, pads };
}

function polygonAreaCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const p0 = pts[j], p1 = pts[i];
    const cross = p0.x * p1.y - p1.x * p0.y;
    a += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return { area: 0, cx: 0, cy: 0 };
  cx /= (6 * a); cy /= (6 * a);
  return { area: Math.abs(a), cx, cy };
}
