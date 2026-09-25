export type MicrophoneAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface MicrophoneAccessApi {
  getMediaAccessStatus: (mediaType: 'microphone') => MicrophoneAccessStatus;
  askForMediaAccess: (mediaType: 'microphone') => Promise<boolean>;
}

export interface MicrophoneAccessResult {
  granted: boolean;
  status: MicrophoneAccessStatus;
  requested: boolean;
}

export function allowAudioMediaCheck(
  isController: boolean,
  permission: string,
  mediaType?: string,
): boolean {
  return isController
    && permission === 'media'
    && (mediaType === undefined || mediaType === 'unknown' || mediaType === 'audio');
}

export function allowAudioMediaRequest(
  isController: boolean,
  permission: string,
  mediaTypes: readonly string[] = [],
): boolean {
  return isController
    && permission === 'media'
    && !mediaTypes.includes('video')
    && (mediaTypes.length === 0 || mediaTypes.includes('audio'));
}

export async function requestMicrophoneAccess(api: MicrophoneAccessApi): Promise<MicrophoneAccessResult> {
  const initialStatus = api.getMediaAccessStatus('microphone');
  if (initialStatus === 'granted') return { granted: true, status: initialStatus, requested: false };
  if (initialStatus === 'denied' || initialStatus === 'restricted') {
    return { granted: false, status: initialStatus, requested: false };
  }

  const granted = await api.askForMediaAccess('microphone');
  const resolvedStatus = api.getMediaAccessStatus('microphone');
  return {
    granted: granted && resolvedStatus === 'granted',
    status: resolvedStatus,
    requested: true,
  };
}
