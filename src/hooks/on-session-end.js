// Hook: SessionEnd — send tab:closed
const { execFileSync } = require('child_process');
const path = require('path');
execFileSync('node', [path.join(__dirname, 'pipe-send.js'), 'tab:closed'], { timeout: 5000 });
