#!/bin/bash
# Org Intel MCP Server - Rapid test script
# Usage: bash test-connector.sh [company-name]

COMPANY="${1:-OpenAI}"
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"research-company","arguments":{"companyName":"'$COMPANY'","depth":"quick"}}}' | DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY node /Users/seanj/Desktop/test/dist/server.js 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
is_err = data['result'].get('isError', False)
text = data['result']['content'][0]['text']
lines = text.split('\n')
print(f'Report: {len(lines)} lines')
print(f'Error: {is_err}')
print(text[:300])
print('...')
" 2>&1
