import { build } from './app.ts';
import { defaultConfig } from './config.ts';

const port = Number(process.env['PORT'] ?? defaultConfig.port);
const host = process.env['HOST'] ?? defaultConfig.host;
const config = {
  ...defaultConfig,
  port,
  host,
  publicWsOrigin: process.env['PUBLIC_WS_ORIGIN'] ?? `ws://${host}:${port}`,
};

const app = await build({ config });
await app.listen({ host: config.host, port: config.port });
console.log(`talk-together backend listening on http://${config.host}:${config.port}`);
