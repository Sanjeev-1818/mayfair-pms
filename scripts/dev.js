// Local development: API server (auto-restarts) + Vite (hot reload) together.
// Open http://localhost:5173. The API runs on PORT (default 5050; macOS uses 5000 for AirPlay).
import { spawn } from 'node:child_process';

const apiPort = process.env.PORT || '5050';
const env = { ...process.env, PORT: apiPort, API_PORT: apiPort };
const procs = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit', env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env }),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', stop));
