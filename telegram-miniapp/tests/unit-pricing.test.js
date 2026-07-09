import assert from 'node:assert/strict';
import { buildUnitPricing, extractPiecesPerM2, parsePositiveUnitNumber } from '../server/unit-pricing.js';

const paramNames = [
  'шт в м2',
  'шт. в м2',
  'шт/м2',
  'штук в м2',
  'штук в кв м',
  'штук в квадратном метре',
  'шт в м²',
  'шт./м²',
  'количество штук в м2',
  'Штук в кв.м.'
];

for (const name of paramNames) {
  assert.equal(extractPiecesPerM2({ [name]: '10' }), 10, name);
}

assert.equal(parsePositiveUnitNumber('10 шт'), 10);
assert.equal(parsePositiveUnitNumber('10,5'), 10.5);
assert.equal(parsePositiveUnitNumber('10.5 шт/м²'), 10.5);
assert.equal(parsePositiveUnitNumber('0'), null);
assert.equal(parsePositiveUnitNumber('нет данных'), null);
assert.equal(extractPiecesPerM2({ Материал: 'Мрамор', 'Штук в кв.м.': ['10.749', '10,749'] }), 10.749);
assert.equal(extractPiecesPerM2({ 'штук в м2': '0' }), null);

assert.deepEqual(buildUnitPricing({
  price: 840,
  currencyId: 'RUB',
  params: { 'штук в м2': '10' }
}), {
  canToggleUnits: true,
  defaultUnit: 'm2',
  selectedUnit: 'm2',
  pricePerM2: 840,
  piecesPerM2: 10,
  pricePerPiece: 84,
  m2Label: '840 ₽/м²',
  pieceLabel: '84 ₽/шт'
});

assert.equal(buildUnitPricing({
  price: 840,
  currencyId: 'RUB',
  params: { Материал: 'Мрамор' }
}), null);
