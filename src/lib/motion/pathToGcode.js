/**
 * Convert generated path to G-code for machine execution
 */

export function pathToGcode(path, options = {}) {
  const {
    feedRate = 1000, // mm/min
    safeHeight = 6, // mm
    workHeight = 0.1, // mm above PCB
    units = 'mm' // 'mm' or 'in'
  } = options;

  if (!path || !path.points || path.points.length === 0) {
    return '';
  }

  const lines = [];
  
  // Header
  lines.push('; Generated G-code from path');
  lines.push(`; Path type: ${path.type}`);
  lines.push(`; Total distance: ${path.totalDistance.toFixed(2)} mm`);
  lines.push(`; Points: ${path.points.length}`);
  lines.push('');
  
  // Setup
  lines.push('G21 ; Set units to millimeters');
  lines.push('G90 ; Absolute positioning');
  lines.push('G94 ; Feed rate per minute');
  lines.push(`F${feedRate} ; Set feed rate`);
  lines.push('');
  
  // Initial safe position
  lines.push(`G0 Z${safeHeight} ; Move to safe height`);
  lines.push('');
  
  // Process each point in the path
  for (let i = 0; i < path.points.length; i++) {
    const point = path.points[i];
    const nextPoint = path.points[i + 1];
    
    lines.push(`; Point ${i + 1}: ${point.type}`);
    
    switch (point.type) {
      case 'start':
        lines.push(`G0 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} ; Move to start position`);
        lines.push(`G0 Z${workHeight} ; Lower to work height`);
        break;
        
      case 'step':
        lines.push(`G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} ; Step movement`);
        break;
        
      case 'waypoint':
        lines.push(`G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} ; Waypoint`);
        break;
        
      case 'lift':
        lines.push(`G0 Z${point.z.toFixed(3)} ; Lift nozzle`);
        break;
        
      case 'travel':
        lines.push(`G0 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} ; Travel move`);
        break;
        
      case 'lower':
        lines.push(`G0 Z${point.z.toFixed(3)} ; Lower nozzle`);
        break;
        
      case 'end':
        lines.push(`G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} ; Move to target`);
        lines.push(`G0 Z${safeHeight} ; Lift to safe height`);
        break;
        
      default:
        lines.push(`G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} ; Move to point`);
    }
    
    lines.push('');
  }
  
  // Footer
  lines.push('M84 ; Disable motors');
  lines.push('; End of path G-code');
  
  return lines.join('\n');
}

/**
 * Generate G-code with dispensing commands
 */
export function pathToDispensingGcode(path, options = {}) {
  const {
    feedRate = 1000,
    safeHeight = 6,
    workHeight = 0.1,
    dispensePressure = 25,
    dispenseTime = 120, // milliseconds
    units = 'mm',
    targetCenter = null,
    centerValid = true
  } = options;

  if (!path || !path.points || path.points.length === 0) {
    return '';
  }

  const lines = [];
  
  // Header with center validation info
  lines.push('; Generated dispensing G-code from path');
  lines.push(`; Path type: ${path.type}`);
  lines.push(`; Total distance: ${path.totalDistance.toFixed(2)} mm`);
  if (targetCenter) {
    lines.push(`; Target center: X${targetCenter.x.toFixed(3)} Y${targetCenter.y.toFixed(3)}`);
    lines.push(`; Center validation: ${centerValid ? 'VALID' : 'WARNING - May be inaccurate'}`);
  }
  lines.push('');
  
  // Setup
  lines.push('G21 ; Set units to millimeters');
  lines.push('G90 ; Absolute positioning');
  lines.push('G94 ; Feed rate per minute');
  lines.push(`F${feedRate} ; Set feed rate`);
  lines.push('');
  
  // Initial position
  lines.push(`G0 Z${safeHeight} ; Move to safe height`);
  
  // Process path for dispensing
  const startPoint = path.points[0];
  const endPoint = path.points[path.points.length - 1];
  
  // Move to start position
  lines.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} ; Move to start`);
  lines.push(`G0 Z${workHeight} ; Lower to dispensing height`);
  lines.push('');
  
  // Follow the path
  for (let i = 1; i < path.points.length; i++) {
    const point = path.points[i];
    
    if (point.type === 'lift') {
      lines.push(`G0 Z${point.z.toFixed(3)} ; Lift for safe travel`);
    } else if (point.type === 'lower') {
      lines.push(`G0 Z${point.z.toFixed(3)} ; Lower for dispensing`);
    } else {
      lines.push(`G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} ; Follow path`);
    }
  }
  
  // Dispense at target
  lines.push('');
  lines.push('; Dispensing sequence');
  lines.push('M106 S255 ; Start dispensing (turn on pump/valve)');
  lines.push(`G4 P${dispenseTime} ; Dwell for dispensing`);
  lines.push('M107 ; Stop dispensing (turn off pump/valve)');
  lines.push('');
  
  // Retract and finish
  lines.push(`G0 Z${safeHeight} ; Retract to safe height`);
  lines.push('M84 ; Disable motors');
  lines.push('; End of dispensing G-code');
  
  return lines.join('\n');
}