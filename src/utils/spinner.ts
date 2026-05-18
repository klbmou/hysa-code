import pc from 'picocolors';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private i = 0;
  private currentText = '';

  start(text: string): void {
    this.currentText = text;
    this.i = 0;
    if (this.timer) return;

    process.stderr.write(`${pc.cyan(FRAMES[0])} ${text}`);
    this.timer = setInterval(() => {
      this.i = (this.i + 1) % FRAMES.length;
      process.stderr.write(`\r${pc.cyan(FRAMES[this.i])} ${this.currentText}`);
    }, 100);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stderr.write('\r\x1b[K');
    }
  }

  succeed(text: string): void {
    this.stop();
    process.stderr.write(`${pc.green('✓')} ${text}\n`);
  }

  fail(text: string): void {
    this.stop();
    process.stderr.write(`${pc.red('✗')} ${text}\n`);
  }

  update(text: string): void {
    this.currentText = text;
  }
}
