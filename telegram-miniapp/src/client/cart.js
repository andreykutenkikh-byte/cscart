const CART_KEY = 'dvk_cart_v1';

export function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function addToCart(cart, product, quantity = 1) {
  const key = product.externalId || product.sku;
  const current = cart[key] || {
    productExternalId: key,
    sku: product.sku,
    name: product.name,
    price: product.price,
    currencyId: product.currencyId,
    imageUrl: product.imageUrl,
    quantity: 0
  };
  return {
    ...cart,
    [key]: {
      ...current,
      quantity: current.quantity + quantity
    }
  };
}

export function updateQuantity(cart, key, quantity) {
  const next = { ...cart };
  if (quantity <= 0) delete next[key];
  else next[key] = { ...next[key], quantity };
  return next;
}

export function getCartItems(cart) {
  return Object.values(cart);
}

export function getCartTotal(cart) {
  return getCartItems(cart).reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
}
