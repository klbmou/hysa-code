import { startWebServer } from './dist/web/server.js';
startWebServer(8788).then(() => console.log('Web server ready on 8788'));
