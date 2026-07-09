import { createBrowserPlatform } from './browser.js';
import { createTelegramPlatform } from './telegram.js';

export function getPlatform() {
  const webApp = window.Telegram?.WebApp;
  if (webApp?.initData || webApp?.initDataUnsafe?.user) {
    return createTelegramPlatform();
  }
  return createBrowserPlatform();
}
