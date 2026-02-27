// Hook: UserPromptSubmit — send tab:generate-name on first prompt only
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tabId = process.env.CLAUDE_TERMINAL_TAB_ID;
const pipeSend = path.join(__dirname, 'pipe-send.js');
const tmpDir = process.env.CLAUDE_TERMINAL_TMPDIR || os.tmpdir();
const flagFile = path.join(tmpDir, `claude-terminal-named-${tabId}`);

// Only name on first prompt
if (fs.existsSync(flagFile)) {
  process.exit(0);
}
fs.writeFileSync(flagFile, '');

// Read prompt from stdin JSON
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let prompt = '';
  try {
    const j = JSON.parse(input);
    prompt = (j.user_prompt || j.prompt || '').substring(0, 500);
  } catch {}
  if (prompt) {
    execFileSync('node', [pipeSend, 'tab:generate-name', prompt], { timeout: 5000 });
  }
});
