#!/bin/bash
TAB_ID="$1"
PIPE_NAME="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Only name the tab on the first prompt
TMPDIR="${CLAUDE_TERMINAL_TMPDIR:-/tmp}"
FLAG_FILE="${TMPDIR}/claude-terminal-named-${TAB_ID}"
if [ -f "$FLAG_FILE" ]; then
  exit 0
fi
touch "$FLAG_FILE"

# Read the prompt from stdin JSON
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | node -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      const p=j.user_prompt||j.prompt||'';
      process.stdout.write(p.substring(0,500));
    }catch{process.stdout.write('')}
  });
" 2>/dev/null)

if [ -n "$PROMPT" ]; then
  bash "$SCRIPT_DIR/pipe-send.sh" "$TAB_ID" "$PIPE_NAME" "tab:generate-name" "$PROMPT"
fi
