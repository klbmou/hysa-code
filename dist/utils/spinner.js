import pc from 'picocolors';
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export class Spinner {
    timer = null;
    i = 0;
    currentText = '';
    start(text) {
        this.currentText = text;
        this.i = 0;
        if (this.timer)
            return;
        process.stderr.write(`${pc.cyan(FRAMES[0])} ${text}`);
        this.timer = setInterval(() => {
            this.i = (this.i + 1) % FRAMES.length;
            process.stderr.write(`\r${pc.cyan(FRAMES[this.i])} ${this.currentText}`);
        }, 100);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            process.stderr.write('\r\x1b[K');
        }
    }
    succeed(text) {
        this.stop();
        process.stderr.write(`${pc.green('✓')} ${text}\n`);
    }
    fail(text) {
        this.stop();
        process.stderr.write(`${pc.red('✗')} ${text}\n`);
    }
    update(text) {
        this.currentText = text;
    }
}
//# sourceMappingURL=spinner.js.map