import { join } from 'node:path';

export interface SystemSpeechCommand {
  command: string;
  args: string[];
  usesEventFile: boolean;
  windowsHide: boolean;
}

interface SystemSpeechCommandOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  locale: string;
  eventFile: string;
  stopFile: string;
  voiceProcessing?: boolean;
  inputGain?: number;
  mockScript?: string;
  nodeExecutable?: string;
}

export function createSystemSpeechCommand(options: SystemSpeechCommandOptions): SystemSpeechCommand {
  if (options.mockScript) {
    return {
      command: options.nodeExecutable ?? 'node',
      args: [options.mockScript, 'system'],
      usesEventFile: false,
      windowsHide: true,
    };
  }

  if (options.platform === 'darwin') {
    const helper = options.isPackaged
      ? join(options.resourcesPath, 'native', 'TeleprompterSpeech.app')
      : join(options.appPath, 'native', 'macos', 'build', 'TeleprompterSpeech.app');
    return {
      command: '/usr/bin/open',
      args: [
        '-W', '-n', helper, '--args', '--locale', options.locale,
        '--event-file', options.eventFile, '--stop-file', options.stopFile,
        '--voice-processing', options.voiceProcessing ? 'true' : 'false',
        '--input-gain', String(options.inputGain ?? 1),
      ],
      usesEventFile: true,
      windowsHide: false,
    };
  }

  if (options.platform === 'win32') {
    const helper = options.isPackaged
      ? join(options.resourcesPath, 'native', 'windows', 'TeleprompterSpeech.ps1')
      : join(options.appPath, 'native', 'windows', 'TeleprompterSpeech.ps1');
    return {
      command: 'powershell.exe',
      args: [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', helper, '-Locale', options.locale,
      ],
      usesEventFile: false,
      windowsHide: true,
    };
  }

  throw new Error(`System speech is not available on ${options.platform}`);
}
