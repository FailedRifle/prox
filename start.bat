@echo off
echo Installing dependencies...
call npm install
echo.
echo Starting CheddarOS Proxy...
start "" http://localhost:8080
node index.js
pause
