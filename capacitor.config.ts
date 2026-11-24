import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shortsquiz.studiopro',
  appName: 'استوديو شورتس برو',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#0c0c0c',
  },
};

export default config;
