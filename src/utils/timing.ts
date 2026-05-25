import pc from 'picocolors';

export class Timer {
  private marks = new Map<string, { start: number; elapsed?: number }>();

  start(label: string): void {
    this.marks.set(label, { start: Date.now() });
  }

  stop(label: string): number {
    const mark = this.marks.get(label);
    if (!mark) return 0;
    const elapsed = Date.now() - mark.start;
    mark.elapsed = elapsed;
    return elapsed;
  }

  elapsed(label: string): number {
    const mark = this.marks.get(label);
    if (!mark) return 0;
    return mark.elapsed ?? (Date.now() - mark.start);
  }

  table(prefix?: string): string {
    const lines: string[] = [];
    const total = [...this.marks.values()].reduce((sum, m) => sum + (m.elapsed ?? 0), 0);

    for (const [label, mark] of this.marks) {
      if (mark.elapsed !== undefined) {
        const pct = total > 0 ? Math.round((mark.elapsed / total) * 100) : 0;
        const bar = '█'.repeat(Math.round(pct / 10));
        lines.push(`  ${(prefix ? prefix + '.' : '') + label}: ${mark.elapsed}ms (${pct}%) ${pc.dim(bar)}`);
      }
    }
    if (lines.length > 0) {
      lines.push(`  total: ${total}ms`);
    }
    return lines.join('\n');
  }

  reset(): void {
    this.marks.clear();
  }
}
