const DEV_USER_KEY = 'dvk_dev_user_id';

function getDevUserId() {
  let id = localStorage.getItem(DEV_USER_KEY);
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    localStorage.setItem(DEV_USER_KEY, id);
  }
  return id;
}

export function createBrowserPlatform() {
  const id = getDevUserId();
  return {
    name: 'browser',
    initData: '',
    user: {
      id,
      firstName: 'Browser',
      lastName: 'Dev',
      username: 'browser_dev'
    },
    ready() {},
    headers() {
      return { 'x-dev-telegram-user-id': id };
    }
  };
}
