import { describe, expect, it } from 'vitest';
import { createSystemSpeechCommand } from '../electron/systemSpeech';

const base = {
  isPackaged: true,
  resourcesPath: 'R:\\resources',
  appPath: 'R:\\app',
  locale: 'zh-CN',
  eventFile: 'R:\\temp\\events.jsonl',
  stopFile: 'R:\\temp\\stop',
};

describe('system speech platform command', () => {
  it('uses the packaged macOS helper and event file protocol', () => {
    const command = createSystemSpeechCommand({ ...base, platform: 'darwin', voiceProcessing: true, inputGain: 1.75 });
    expect(command.command).toBe('/usr/bin/open');
    expect(command.args).toContain('R:\\resources/native/TeleprompterSpeech.app');
    expect(command.args).toEqual(expect.arrayContaining(['--voice-processing', 'true', '--input-gain', '1.75']));
    expect(command.usesEventFile).toBe(true);
  });

  it('uses hidden Windows PowerShell with the packaged local helper', () => {
    const command = createSystemSpeechCommand({ ...base, platform: 'win32' });
    expect(command.command).toBe('powershell.exe');
    expect(command.args).toEqual(expect.arrayContaining([
      '-NonInteractive',
      '-File',
      'R:\\resources/native/windows/TeleprompterSpeech.ps1',
      '-Locale',
      'zh-CN',
    ]));
    expect(command.usesEventFile).toBe(false);
    expect(command.windowsHide).toBe(true);
  });

  it('keeps test helpers platform-independent', () => {
    const command = createSystemSpeechCommand({
      ...base,
      platform: 'linux',
      mockScript: '/tmp/mock-speech.mjs',
      nodeExecutable: '/usr/bin/node',
    });
    expect(command).toMatchObject({
      command: '/usr/bin/node',
      args: ['/tmp/mock-speech.mjs', 'system'],
      usesEventFile: false,
    });
  });
});
