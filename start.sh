#!/bin/bash
echo "Installing dependencies..."
npm install
echo ""
echo "Starting CheddarOS Proxy..."
node index.js &
sleep 2
open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080 2>/dev/null
wait
