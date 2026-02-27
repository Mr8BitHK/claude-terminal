// Hook: Notification — send tab:status:input
const { execFileSync } = require('child_process');
const path = require('path');
execFileSync('node', [path.join(__dirname, 'pipe-send.js'), 'tab:status:input'], { timeout: 5000 });
