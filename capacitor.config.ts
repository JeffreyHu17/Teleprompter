import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.teleprompter.studio',
  appName: 'Teleprompter Studio',
  webDir: 'dist-android',
  android: {
    path: 'native/android',
    allowMixedContent: false,
    backgroundColor: '#050606',
  },
};

export default config;
