import { installSafeAreaBridge } from './safe-area.js';

export function createTelegramPlatform() {
  const webApp = window.Telegram?.WebApp;
  const user = webApp?.initDataUnsafe?.user || null;
  const updateSafeArea = installSafeAreaBridge(webApp);

  return {
    name: 'telegram',
    initData: webApp?.initData || '',
    user: user ? {
      id: String(user.id),
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      username: user.username || ''
    } : null,
    ready() {
      webApp?.ready?.();
      webApp?.expand?.();
      updateSafeArea();
    },
    headers() {
      return webApp?.initData ? { 'x-telegram-init-data': webApp.initData } : {};
    }
  };
}
