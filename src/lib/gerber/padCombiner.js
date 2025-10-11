import { extractPadsMm } from './extractPads.js';

/**
 * Combines soldermask and solderpaste layers to get complete pad information
 * @param {Array} layers - Array of layer objects with type, side, and text properties
 * @param {string} side - 'top' or 'bottom'
 * @returns {Object} Combined pad data with positions from soldermask and dispensing info from solderpaste
 */
export function combinePadLayers(layers, side) {
  const soldermaskLayer = layers.find(l => l.type === 'soldermask' && l.side === side);
  const solderpasteLayer = layers.find(l => l.type === 'solderpaste' && l.side === side);
  
  if (!soldermaskLayer && !solderpasteLayer) {
    return { pads: [], hasGeometry: false, hasDispensing: false };
  }

  let maskPads = [];
  let pastePads = [];
  
  // Extract pad positions from soldermask (more accurate geometry)
  if (soldermaskLayer) {
    maskPads = extractPadsMm(soldermaskLayer.text);
  }
  
  // Extract dispensing targets from solderpaste
  if (solderpasteLayer) {
    pastePads = extractPadsMm(solderpasteLayer.text);
  }
  
  // If we have both layers, match pads by proximity
  if (maskPads.length > 0 && pastePads.length > 0) {
    return matchPadsByProximity(maskPads, pastePads);
  }
  
  // If only one layer available, use what we have
  if (maskPads.length > 0) {
    return {
      pads: maskPads.map((pad, idx) => ({
        ...pad,
        id: `M${idx + 1}`,
        source: 'soldermask',
        needsPaste: false // Unknown without solderpaste layer
      })),
      hasGeometry: true,
      hasDispensing: false
    };
  }
  
  if (pastePads.length > 0) {
    return {
      pads: pastePads.map((pad, idx) => ({
        ...pad,
        id: `P${idx + 1}`,
        source: 'solderpaste',
        needsPaste: true
      })),
      hasGeometry: false,
      hasDispensing: true
    };
  }
  
  return { pads: [], hasGeometry: false, hasDispensing: false };
}

/**
 * Matches soldermask pads with solderpaste pads by proximity
 * @param {Array} maskPads - Pads from soldermask layer (accurate positions)
 * @param {Array} pastePads - Pads from solderpaste layer (dispensing targets)
 * @returns {Object} Combined pad data
 */
function matchPadsByProximity(maskPads, pastePads) {
  const MATCH_THRESHOLD = 0.5; // mm - maximum distance to consider pads as matching
  const combinedPads = [];
  const usedPasteIndices = new Set();
  
  // For each soldermask pad, find closest solderpaste pad
  maskPads.forEach((maskPad, maskIdx) => {
    let closestPasteIdx = -1;
    let minDistance = Infinity;
    
    pastePads.forEach((pastePad, pasteIdx) => {
      if (usedPasteIndices.has(pasteIdx)) return;
      
      const distance = Math.hypot(maskPad.x - pastePad.x, maskPad.y - pastePad.y);
      if (distance < minDistance && distance <= MATCH_THRESHOLD) {
        minDistance = distance;
        closestPasteIdx = pasteIdx;
      }
    });
    
    if (closestPasteIdx >= 0) {
      // Matched pad - use soldermask position (more accurate) with solderpaste info
      usedPasteIndices.add(closestPasteIdx);
      combinedPads.push({
        x: maskPad.x,
        y: maskPad.y,
        id: `C${combinedPads.length + 1}`,
        source: 'combined',
        needsPaste: true,
        pasteOrder: closestPasteIdx + 1,
        matchDistance: minDistance
      });
    } else {
      // Unmatched soldermask pad - no paste needed
      combinedPads.push({
        x: maskPad.x,
        y: maskPad.y,
        id: `M${maskIdx + 1}`,
        source: 'soldermask',
        needsPaste: false
      });
    }
  });
  
  // Add any unmatched solderpaste pads
  pastePads.forEach((pastePad, pasteIdx) => {
    if (!usedPasteIndices.has(pasteIdx)) {
      combinedPads.push({
        x: pastePad.x,
        y: pastePad.y,
        id: `P${pasteIdx + 1}`,
        source: 'solderpaste',
        needsPaste: true,
        pasteOrder: pasteIdx + 1,
        geometryMissing: true
      });
    }
  });
  
  return {
    pads: combinedPads,
    hasGeometry: true,
    hasDispensing: true,
    matchedCount: usedPasteIndices.size,
    totalMaskPads: maskPads.length,
    totalPastePads: pastePads.length
  };
}

/**
 * Gets available layer combinations for a given side
 * @param {Array} layers - Array of layer objects
 * @param {string} side - 'top' or 'bottom'
 * @returns {Object} Available layer information
 */
export function getAvailableLayerCombinations(layers, side) {
  const soldermask = layers.find(l => l.type === 'soldermask' && l.side === side);
  const solderpaste = layers.find(l => l.type === 'solderpaste' && l.side === side);
  
  return {
    hasSoldermask: !!soldermask,
    hasSolderpaste: !!solderpaste,
    soldermaskFile: soldermask?.filename,
    solderpasteFile: solderpaste?.filename,
    canCombine: !!(soldermask && solderpaste)
  };
}