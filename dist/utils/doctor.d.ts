interface DoctorOptions {
    probeModels?: boolean;
}
export declare function runVisionDiagnostics(debug?: boolean): Promise<void>;
export declare function runDoctor(debug?: boolean, provider?: string, options?: DoctorOptions): Promise<void>;
export {};
//# sourceMappingURL=doctor.d.ts.map