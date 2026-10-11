import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from './app.js';

// Load the monorepo root .env regardless of which directory this process
// was started from (turbo/tsx may run with cwd = apps/server).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const PORT = Number(process.env.PORT ?? 4000);

const { app } = await createServer();

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`server listening on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
