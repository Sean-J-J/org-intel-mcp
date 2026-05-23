#!/bin/bash
# Company org intelligence research - for use from any shell or OpenClaw agent
# Usage: bash org-research.sh "Company Name" "business need" [depth]

COMPANY="${1:-}"
NEED="${2:-}"
DEPTH="${3:-standard}"

if [ -z "$COMPANY" ]; then
  echo "Usage: bash org-research.sh \"Company Name\" [\"business need\"] [depth]"
  echo "  depth: quick | standard (default) | deep"
  exit 1
fi

TMPFILE=$(mktemp /tmp/org-result-XXXXXX.json)

# Build JSON-RPC request
if [ -n "$NEED" ]; then
  ARGS="{\"companyName\":\"$COMPANY\",\"businessNeed\":\"$NEED\",\"depth\":\"$DEPTH\"}"
else
  ARGS="{\"companyName\":\"$COMPANY\",\"depth\":\"$DEPTH\"}"
fi

echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"research-company\",\"arguments\":$ARGS}}" | DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY node /Users/seanj/Desktop/test/dist/server.js 2>/dev/null > "$TMPFILE"

python3 -c "
import json
with open('$TMPFILE') as f:
    data = json.load(f)
is_err = data.get('result', {}).get('isError', False)
if is_err:
    print('ERROR:', data['result']['content'][0]['text'][:300])
else:
    print(data['result']['content'][0]['text'])
" 2>&1

rm -f "$TMPFILE"
