export function createMaxPlatformStub() {
  return {
    name: 'max',
    initData: '',
    user: null,
    ready() {},
    headers() {
      return {};
    }
  };
}
