#!/bin/bash
# Start Chrome in background, then start the gateway
/usr/bin/google-chrome-stable \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=18800 \
  --user-data-dir=/home/node/.clawdbot/browser/clawd/user-data \
  about:blank &

# Wait for Chrome to be ready
sleep 2

# Start the gateway
exec node dist/index.js gateway-daemon "$@"
