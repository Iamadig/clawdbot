#!/bin/bash
set -e
export PATH="/opt/homebrew/bin:$PATH"

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  npm install
fi

# Check for cookies
if [ ! -s "cookies_js.txt" ]; then
  echo "ERROR: cookies_js.txt is empty or missing. Please paste your cookies into it."
  exit 1
fi

echo "Starting Walmart Skill Node on Port 9099..."
echo "Ensure you have an SSH Tunnel or Tailscale connection from VPS to this port."

# Run socat to listen on TCP 9099 and pipe to the skill
# We use 'fork' to allow reconnection, but note that `index.ts` might maintain state.
# Ideally, we want a persistent server.
# StdioServerTransport is stateful per connection.
# 'fork' spawns a new process for each connection. This is good.

socat TCP-LISTEN:9099,fork,bind=0.0.0.0 EXEC:"/opt/homebrew/bin/node dist/index.js",pty,stderr
