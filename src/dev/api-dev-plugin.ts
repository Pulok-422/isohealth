import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import path from 'path';
import fs from 'fs';

/**
 * Vite dev middleware that mounts the `/api/*.ts` Vercel serverless functions
 * during local development. In production, Vercel picks up the same files
 * automatically — no extra config needed.
 */
export function apiDevPlugin(): Plugin {
  return {
    name: 'iso-health-api-dev',
    config(_, { mode }) {
      // Load all env vars (including non-VITE_) into process.env so
      // server-side handlers can read process.env.ORS_API_KEY in dev.
      const env = loadEnv(mode, process.cwd(), '');
      for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const pathname = req.url.split('?')[0];
        const routeName = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
        const filePath = path.resolve(process.cwd(), 'api', `${routeName}.ts`);

        if (!fs.existsSync(filePath)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: `Unknown API route: ${routeName}` }));
          return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString('utf8');
            (req as any).body = raw ? JSON.parse(raw) : {};
          } catch {
            (req as any).body = {};
          }
        }

        (res as any).status = (code: number) => {
          res.statusCode = code;
          return res;
        };
        (res as any).json = (data: unknown) => {
          if (!res.getHeader('Content-Type')) {
            res.setHeader('Content-Type', 'application/json');
          }
          res.end(JSON.stringify(data));
          return res;
        };

        try {
          const mod = await server.ssrLoadModule(filePath);
          const handler = mod.default;
          if (typeof handler !== 'function') {
            res.statusCode = 500;
            (res as any).json({ success: false, error: 'API route missing default export' });
            return;
          }
          await handler(req, res);
        } catch (err: any) {
          console.error(`[api-dev] ${pathname} crashed:`, err);
          res.statusCode = 500;
          (res as any).json({ success: false, error: err?.message || 'Server error' });
        }
      });
    },
  };
}