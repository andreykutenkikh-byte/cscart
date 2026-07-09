const TELEGRAM_SAFE_AREA_EVENTS = [
  'viewportChanged',
  'safeAreaChanged',
  'contentSafeAreaChanged',
  'fullscreenChanged'
];

const wiredWebApps = new WeakSet();
let resizeListenersInstalled = false;

function toPx(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${number}px` : '0px';
}

function getInset(insets, side) {
  return insets && typeof insets === 'object' ? insets[side] : 0;
}

function setInsetVariables(root, prefix, insets) {
  root.style.setProperty(`${prefix}-top`, toPx(getInset(insets, 'top')));
  root.style.setProperty(`${prefix}-right`, toPx(getInset(insets, 'right')));
  root.style.setProperty(`${prefix}-bottom`, toPx(getInset(insets, 'bottom')));
  root.style.setProperty(`${prefix}-left`, toPx(getInset(insets, 'left')));
}

export function installSafeAreaBridge(webApp = null) {
  const root = document.documentElement;

  const applySafeArea = () => {
    setInsetVariables(root, '--tg-safe', webApp?.safeAreaInset);
    setInsetVariables(root, '--tg-content-safe', webApp?.contentSafeAreaInset);

    const viewportHeight = Number(webApp?.viewportHeight || 0);
    const stableHeight = Number(webApp?.viewportStableHeight || 0);
    root.style.setProperty('--tg-viewport-height', viewportHeight > 0 ? `${viewportHeight}px` : '100dvh');
    root.style.setProperty('--tg-viewport-stable-height', stableHeight > 0 ? `${stableHeight}px` : '100dvh');
  };

  applySafeArea();

  if (webApp && typeof webApp === 'object' && !wiredWebApps.has(webApp)) {
    for (const eventName of TELEGRAM_SAFE_AREA_EVENTS) {
      webApp?.onEvent?.(eventName, applySafeArea);
    }
    wiredWebApps.add(webApp);
  }

  if (!resizeListenersInstalled) {
    window.addEventListener('resize', applySafeArea, { passive: true });
    window.addEventListener('orientationchange', applySafeArea, { passive: true });
    resizeListenersInstalled = true;
  }

  return applySafeArea;
}
