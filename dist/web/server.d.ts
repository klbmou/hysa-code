import type { Server } from 'node:http';
export declare function getServerRef(): Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse> | null;
export declare function startWebServer(port?: number): Promise<void>;
//# sourceMappingURL=server.d.ts.map