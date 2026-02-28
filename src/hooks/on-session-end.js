// Hook: SessionEnd — send tab:closed
const { execFileSync } = require('child_process');
const path = require('path');
try {
  execFileSync('node', [path.join(__dirname, 'pipe-send.js'), 'tab:closed'], { timeout: 5000 });
} catch { /* not running inside ClaudeTerminal */ }
