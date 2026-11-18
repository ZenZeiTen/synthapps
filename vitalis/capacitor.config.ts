import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.zenzeiten.vitalis',
  appName: 'Vitalis',
  webDir: 'dist',
  backgroundColor: '#F1F5F3',
  android: {
    allowMixedContent: false
  },
  plugins: {
    SystemBars: {
      // Draw edge to edge and expose the status and navigation bar sizes to CSS.
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover'
    }
  }
};

export default config;
