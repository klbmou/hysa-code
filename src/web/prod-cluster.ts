import { startWebServer, getServerRef } from './server.js';

const PORT = parseInt(process.env.PORT || '10000', 10);
const HOST = process.env.HYSA_BIND_HOST || '0.0.0.0';
const PROD = process.env.NODE_ENV === 'production';

async function main() {
  try {
    await startWebServer(PORT, HOST);
    const addr = `${HOST}:${PORT}`;
    console.log(`  [HYSA Production] Server listening on ${addr}`);

    // Memory monitoring — log to stdout for PM2 to pickup
    const MEM_THRESHOLD_MB = 400;
    let lastThresholdWarn = 0;
    const memInterval = setInterval(() => {
      const usage = process.memoryUsage();
      const rssMb = (usage.rss / 1024 / 1024).toFixed(1);
      const heapMb = (usage.heapUsed / 1024 / 1024).toFixed(1);
      console.log(`[HYSA Monitor] rss=${rssMb}MB heap=${heapMb}MB`);

      // Check memory threshold (RSS)
      const rssNum = parseFloat(rssMb);
      if (rssNum >= MEM_THRESHOLD_MB) {
        // Only warn once every 60s to avoid log spam
        const now = Date.now();
        if (now - lastThresholdWarn > 60_000) {
          lastThresholdWarn = now;
          console.warn(`[HYSA WARN] Memory threshold exceeded: ${rssMb}MB >= ${MEM_THRESHOLD_MB}MB`);
          // Broadcast to PM2 message bus
          if (process.send) {
            process.send({
              type: 'MEMORY_THRESHOLD_EXCEEDED',
              data: { rss: usage.rss, rssMb: rssNum, heapMb: parseFloat(heapMb), threshold: MEM_THRESHOLD_MB, timestamp: now },
            });
          }
        }
      }
    }, 30000);

    // PM2 graceful shutdown — cleanly close HTTP server, no process.exit
    const shutdown = (signal: string) => {
      console.log(`\n  [HYSA Production] ${signal} received — shutting down gracefully...`);
      clearInterval(memInterval);
      const server = getServerRef();
      if (server) {
        server.close(() => {
          console.log('  [HYSA Production] HTTP server closed');
          // Let PM2 handle the restart; don't call process.exit
        });
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // PM2 message bus — listen for PM2 commands
    if (process.send) {
      process.on('message', (msg: any) => {
        if (msg === 'shutdown') shutdown('PM2_SHUTDOWN');
        if (msg?.type === 'health') {
          const usage = process.memoryUsage();
          process.send?.({ type: 'health', data: { rss: usage.rss, heapUsed: usage.heapUsed, uptime: process.uptime() } });
        }
      });
      // Notify PM2 the process is ready
      process.send({ type: 'ready' });
    }

    await new Promise(() => {});
  } catch (err) {
    console.error('[HYSA Production] Failed to start:', err);
    process.exitCode = 1;
  }
}

main();
