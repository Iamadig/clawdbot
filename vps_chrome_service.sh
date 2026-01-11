#!/bin/bash
# Start Chrome for Clawdbot to attach to
/usr/bin/google-chrome-stable \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=18800 \
  --user-data-dir=/home/node/.clawdbot/browser/clawd/user-data \
  about:blank
