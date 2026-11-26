import express from 'express';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
import { createAuthDependencies } from './server/auth.ts';
import { loadServerConfig } from './server/config.ts';
import { closeDatabasePool, createDatabasePool } from './server/db.ts';
import { apiErrorHandler, sendJsonError } from './server/errors.ts';
import { createFoundationApiRouter } from './server/routes/foundation.ts';
import { createReadApiRouter } from './server/routes/readApi.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  const config = loadServerConfig();
  const dbState = createDatabasePool(config);
  const authDeps = createAuthDependencies(config, dbState);

  for (const errMsg of config.validationErrors) {
    console.error(`[config:error] ${errMsg}`);
  }
  for (const warnMsg of config.validationWarnings) {
    console.warn(`[config:warn] ${warnMsg}`);
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Baseline security headers compatible with iframe embedding in preview
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api', express.json({ limit: '1mb' }));
  app.use('/api', createReadApiRouter(config, dbState, authDeps));
  app.use('/api', createFoundationApiRouter(config, dbState, authDeps));
  app.use('/api', apiErrorHandler);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  const httpServer: Server = http.createServer(app);

  const distDir = path.resolve(__dirname, 'dist');
  const distIndexPath = path.join(distDir, 'index.html');
  const isProduction =
    config.nodeEnv === 'production' ||
    (process.env.NODE_ENV !== 'development' && fs.existsSync(distIndexPath));

  let viteServer: ViteDevServer | null = null;

  if (isProduction) {
    app.use(express.static(distDir, { index: false }));
    app.get('*', (req, res) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      if (!fs.existsSync(distIndexPath)) {
        sendJsonError(
          res,
          503,
          'FRONTEND_BUILD_MISSING',
          'Production frontend build (dist/index.html) was not found. Run `npm run build` first.'
        );
        return;
      }
      res.sendFile(distIndexPath);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    viteServer = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !hmrDisabled,
        ws: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  }

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(
      `[server] Sponsorship Growth Platform listening on http://0.0.0.0:${config.port} (mode=${isProduction ? 'production' : 'development'}, app_env=${config.appEnv})`
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] Received ${signal}, shutting down gracefully...`);

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    if (viteServer) {
      await viteServer.close();
    }

    await closeDatabasePool(dbState);
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

startServer().catch((err: unknown) => {
  const name = err instanceof Error ? err.name : 'StartupError';
  console.error(`[server] Fatal startup error (${name})`);
  process.exit(1);
});
