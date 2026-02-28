export interface KeyEvent {
  name: string;
  ctrl: boolean;
  shift: boolean;
}

export function parseKey(buf: Buffer): KeyEvent {
  const s = buf.toString("utf-8");

  // Ctrl+C
  if (buf.length === 1 && buf[0] === 3) return { name: "c", ctrl: true, shift: false };

  // Escape sequences
  if (buf.length >= 3 && buf[0] === 0x1b && buf[1] === 0x5b) {
    const code = buf[2];
    // Shift+Tab = ESC [ Z
    if (code === 0x5a) return { name: "tab", ctrl: false, shift: true };
    // Arrow keys
    if (code === 0x41) return { name: "up", ctrl: false, shift: false };
    if (code === 0x42) return { name: "down", ctrl: false, shift: false };
    if (code === 0x43) return { name: "right", ctrl: false, shift: false };
    if (code === 0x44) return { name: "left", ctrl: false, shift: false };
    if (code === 0x48) return { name: "home", ctrl: false, shift: false };
    if (code === 0x46) return { name: "end", ctrl: false, shift: false };

    // Extended sequences: ESC [ N ~
    if (buf.length >= 4 && buf[3] === 0x7e) {
      if (code === 0x35) return { name: "pageup", ctrl: false, shift: false };
      if (code === 0x36) return { name: "pagedown", ctrl: false, shift: false };
    }
  }

  // Escape alone
  if (buf.length === 1 && buf[0] === 0x1b) return { name: "escape", ctrl: false, shift: false };

  // Tab
  if (buf.length === 1 && buf[0] === 0x09) return { name: "tab", ctrl: false, shift: false };

  // Enter
  if (buf.length === 1 && buf[0] === 0x0d) return { name: "enter", ctrl: false, shift: false };

  // Backspace
  if (buf.length === 1 && buf[0] === 0x7f) return { name: "backspace", ctrl: false, shift: false };

  // Printable character
  if (s.length === 1 && s.charCodeAt(0) >= 32) {
    return { name: s, ctrl: false, shift: s === s.toUpperCase() && s !== s.toLowerCase() };
  }

  return { name: s, ctrl: false, shift: false };
}

export function startKeyListener(handler: (key: KeyEvent) => void): () => void {
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf-8");

  const onData = (data: Buffer) => {
    handler(parseKey(Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as string)));
  };

  stdin.on("data", onData);

  return () => {
    stdin.removeListener("data", onData);
    stdin.setRawMode(false);
    stdin.pause();
  };
}
