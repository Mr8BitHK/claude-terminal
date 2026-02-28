// Hook: PreToolUse — send tab:status:working
const { execFileSync } = require('child_process');
const path = require('path');
try {
  execFileSync('node', [path.join(__dirname, 'pipe-send.js'), 'tab:status:working'], { timeout: 5000 });
} catch { /* not running inside ClaudeTerminal */ }
