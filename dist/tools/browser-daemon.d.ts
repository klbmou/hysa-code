declare function importPlaywright(): Promise<any>;
declare function startServer(port: number): Promise<number>;
export declare function daemonCommand(port: number, cmd: any, timeoutMs?: number): Promise<any>;
export { startServer, importPlaywright };
//# sourceMappingURL=browser-daemon.d.ts.map