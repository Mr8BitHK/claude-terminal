#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Read the hook input from stdin (contains session_id, source, model, etc.)
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      process.stdout.write(j.session_id||'');
    }catch{process.stdout.write('')}
  });
" 2>/dev/null)

# Send tab:ready with session_id as data
bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:ready" "$SESSION_ID"

# Set CLAUDE_TERMINAL_TAB_ID for this session
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export CLAUDE_TERMINAL_TAB_ID=\"$TAB_ID\"" >> "$CLAUDE_ENV_FILE"
fi
