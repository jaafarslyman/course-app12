import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor/privacy-screen';

export async function enableScreenProtection(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  await PrivacyScreen.enable({
    android: {
      preventScreenshots: true,
    },
  });
}
