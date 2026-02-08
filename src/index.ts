import 'dotenv/config';

import { createApp } from './app.js';

async function main(): Promise<void> {
  const runtime = await createApp();

  const server = runtime.app.listen(runtime.env.PORT, () => {
    console.log(`Incident tracker API listening on http://localhost:${runtime.env.PORT}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      void runtime
        .close()
        .then(() => {
          process.exit(0);
        })
        .catch(() => {
          process.exit(1);
        });
    });
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });

  process.on('SIGINT', () => {
    void shutdown();
  });
}

void main();
