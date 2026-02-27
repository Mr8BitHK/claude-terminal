// Sends a JSON message to the ClaudeTerminal named pipe.
// Reads pipe name and tab ID from environment variables to avoid
// Windows cmd.exe backslash mangling in CLI arguments.
// Usage: node pipe-send.js <event> [data]
const net = require('net');

const tabId = process.env.CLAUDE_TERMINAL_TAB_ID;
const pipeName = process.env.CLAUDE_TERMINAL_PIPE;
const [,, event, data] = process.argv;

// Silently exit when not running inside ClaudeTerminal
if (!tabId || !pipeName || !event) {
  process.exit(0);
}

const msg = JSON.stringify({
  tabId,
  event,
  data: data || null,
});

const client = net.createConnection(pipeName, () => {
  client.end(msg + '\n');
});
client.on('close', () => process.exit(0));
client.on('error', () => process.exit(0));
setTimeout(() => process.exit(0), 3000);
