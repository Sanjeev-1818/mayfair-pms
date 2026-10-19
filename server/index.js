import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { initDb } from './db.js';
import { seed } from './seed.js';
import { attachUsers } from './auth.js';
import { authRouter } from './routes/auth.js';
import { memberRouter } from './routes/member.js';
import { staffRouter } from './routes/staff.js';
import { adminRouter } from './routes/admin.js';
import { publicRouter } from './routes/public.js';
import { UserError } from './lib/members.js';
import { AadhaarError } from './lib/aadhaar.js';

await initDb();
await seed();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  });
  next();
});
app.use(express.json({ limit: '6mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(attachUsers);
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(authRouter, memberRouter, staffRouter, adminRouter, publicRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// The React app (built by Vite into dist/).
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => {
    if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('API running. Start the web app with "npm run dev" and open http://localhost:5173'));
}

app.use((err, req, res, _next) => {
  if (err instanceof UserError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof AadhaarError) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Photo is too large. Please take it again.' });
  console.error(req.method, req.path, err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Mayfair PMS listening on port ${config.port}${config.authTestMode ? ' (TEST sign-in mode)' : ''}`);
});
