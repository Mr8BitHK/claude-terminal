#!/bin/bash
# Sends a JSON message to the ClaudeTerminal named pipe.
# Usage: pipe-send.sh <tab-id> <pipe-name> <event> [data]

TAB_ID="$1"
PIPE_NAME="$2"
EVENT="$3"
DATA="${4:-}"

# Build and send JSON via Node.js (handles escaping and pipe transport)
PIPE_TAB_ID="$TAB_ID" PIPE_EVENT="$EVENT" PIPE_DATA="$DATA" PIPE_PATH="$PIPE_NAME" node -e "
  const net = require('net');
  const msg = JSON.stringify({
    tabId: process.env.PIPE_TAB_ID,
    event: process.env.PIPE_EVENT,
    data: process.env.PIPE_DATA || null
  });
  const client = net.createConnection(process.env.PIPE_PATH, () => {
    client.end(msg + '\n');
  });
  client.on('close', () => process.exit(0));
  client.on('error', () => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
"
