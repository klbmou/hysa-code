import { startWebServer } from './server.js';

const PORT = parseInt(process.env.PORT || '10000', 10);
const HOST = '0.0.0.0';

async function main() {
  try {
    await startWebServer(PORT, HOST);
    console.log(`  [HYSA Web] Production server listening on 0.0.0.0:${PORT}`);

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\n  [HYSA Web] SIGTERM received, shutting down...');
      process.exit(0);
    });
    process.on('SIGINT', () => {
      console.log('\n  [HYSA Web] SIGINT received, shutting down...');
      process.exit(0);
    });

    // Keep alive indefinitely — never resolve
    await new Promise(() => {});
  } catch (err) {
    console.error('[HYSA Web] Failed to start:', err);
    process.exit(1);
  }
}

main();
