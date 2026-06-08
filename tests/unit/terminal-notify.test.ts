import { describe, it, expect, vi, afterEach } from 'vitest';
// Source of truth is packages/cli/src/kern/lib/terminal-notify.kern;
// the generated/*.js below is regenerated from it (npm run kern:compile).
import { bell, setWindowTitle } from '../../packages/cli/src/generated/lib/terminal-notify.js';

const BEL = String.fromCharCode(7); // 0x07 BEL
const OSC = String.fromCharCode(27) + ']0;'; // ESC ] 0 ; window-title opener

describe('terminal-notify', () => {
  const origIsTTY = process.stdout.isTTY;
  const origNoBell = process.env.AGON_NO_BELL;
  const origNoTitle = process.env.AGON_NO_TITLE;

  afterEach(() => {
    (process.stdout as any).isTTY = origIsTTY;
    if (origNoBell === undefined) delete process.env.AGON_NO_BELL;
    else process.env.AGON_NO_BELL = origNoBell;
    if (origNoTitle === undefined) delete process.env.AGON_NO_TITLE;
    else process.env.AGON_NO_TITLE = origNoTitle;
    vi.restoreAllMocks();
  });

  describe('bell', () => {
    it('writes BEL (0x07) exactly once when TTY and AGON_NO_BELL unset', () => {
      (process.stdout as any).isTTY = true;
      delete process.env.AGON_NO_BELL;
      const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      bell();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(BEL);
    });

    it('writes nothing when AGON_NO_BELL is set', () => {
      (process.stdout as any).isTTY = true;
      process.env.AGON_NO_BELL = '1';
      const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      bell();
      expect(spy).not.toHaveBeenCalled();
    });

    it('writes nothing when stdout is not a TTY (piped/CI)', () => {
      (process.stdout as any).isTTY = false;
      delete process.env.AGON_NO_BELL;
      const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      bell();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('setWindowTitle', () => {
    it('writes the OSC 0 ; <label> BEL sequence when TTY and AGON_NO_TITLE unset', () => {
      (process.stdout as any).isTTY = true;
      delete process.env.AGON_NO_TITLE;
      const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      setWindowTitle('agon - running');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(`${OSC}agon - running${BEL}`);
    });

    it('no-ops when AGON_NO_TITLE is set', () => {
      (process.stdout as any).isTTY = true;
      process.env.AGON_NO_TITLE = '1';
      const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      setWindowTitle('agon');
      expect(spy).not.toHaveBeenCalled();
    });

    it('no-ops when stdout is not a TTY (piped/CI)', () => {
      (process.stdout as any).isTTY = false;
      delete process.env.AGON_NO_TITLE;
      const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      setWindowTitle('agon');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
