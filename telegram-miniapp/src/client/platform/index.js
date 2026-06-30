import { createBrowserPlatform } from './browser.js';
import { createTelegramPlatform } from './telegram.js';

export function getPlatform() {
  if (window.Telegram?.WebApp) {
    return createTelegramPlatform();
  }
  return createBrowserPlatform();
}
