// Hook: Stop — send tab:status:idle
const { execFileSync } = require('child_process');
const path = require('path');
execFileSync('node', [path.join(__dirname, 'pipe-send.js'), 'tab:status:idle'], { timeout: 5000 });
