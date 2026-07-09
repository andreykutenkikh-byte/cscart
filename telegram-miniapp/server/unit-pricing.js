function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeParamName(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[²₂]/g, '2')
    .replace(/[.,:;()]/g, ' ')
    .replace(/[\/\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPiecesPerM2ParamName(name) {
  const normalized = normalizeParamName(name);
  const hasPieces = /(^| )шт($| )|штук|штуки|количество штук/.test(normalized);
  const hasSquareMeter = normalized.includes('м2')
    || normalized.includes('кв м')
    || (normalized.includes('квадрат') && normalized.includes('метр'));

  return hasPieces && hasSquareMeter;
}

export function parsePositiveUnitNumber(value) {
  for (const item of asArray(value)) {
    const matches = String(item)
      .replace(/\s+/g, ' ')
      .match(/[-−+]?\d+(?:[.,]\d+)?/g);
    if (!matches || matches.length !== 1) continue;
    if (/^[-−]/.test(matches[0])) continue;
    const number = Number(matches[0].replace(',', '.'));
    if (Number.isFinite(number) && number > 0) return number;
  }

  return null;
}

export function extractPiecesPerM2(params = {}) {
  for (const [name, value] of Object.entries(params || {})) {
    if (!isPiecesPerM2ParamName(name)) continue;
    const piecesPerM2 = parsePositiveUnitNumber(value);
    if (piecesPerM2) return piecesPerM2;
  }

  return null;
}

function formatMoney(value, currency = 'RUB', maximumFractionDigits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  const symbol = currency === 'RUB' ? '₽' : currency || '';
  const formatted = number.toLocaleString('ru-RU', {
    maximumFractionDigits,
    minimumFractionDigits: 0
  });

  return `${formatted} ${symbol}`.trim();
}

export function buildUnitPricing({ price, currencyId = 'RUB', params = {} } = {}) {
  const pricePerM2 = Number(price);
  const piecesPerM2 = extractPiecesPerM2(params);
  if (!Number.isFinite(pricePerM2) || pricePerM2 <= 0 || !piecesPerM2) {
    return null;
  }

  const pricePerPieceRaw = pricePerM2 / piecesPerM2;
  const pricePerPiece = Number(pricePerPieceRaw.toFixed(2));

  return {
    canToggleUnits: true,
    defaultUnit: 'm2',
    selectedUnit: 'm2',
    pricePerM2,
    piecesPerM2,
    pricePerPiece,
    m2Label: `${formatMoney(pricePerM2, currencyId, 0)}/м²`,
    pieceLabel: `${formatMoney(pricePerPieceRaw, currencyId, 0)}/шт`
  };
}
