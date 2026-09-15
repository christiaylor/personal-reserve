import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAllocations } from '../src/allocationEngine.js';

test('calculates fixed and percentage-based allocations', () => {
  const result = computeAllocations({
    monthlyIncome: 6000,
    rules: [
      { category: 'Housing', type: 'fixed', amount: 1200 },
      { category: 'Emergency fund', type: 'percent', percent: 20 },
      { category: 'Lifestyle', type: 'percent', percent: 15 },
    ],
  });

  assert.equal(result.fixedTotal, 1200);
  assert.equal(result.percentTotal, 35);
  assert.equal(result.rules.length, 3);
  assert.equal(result.totalAllocated, 2880);
  assert.equal(result.remaining, 3120);
});

test('rejects percentage rules above 100%', () => {
  assert.throws(() => computeAllocations({
    monthlyIncome: 5000,
    rules: [
      { category: 'Savings', type: 'percent', percent: 70 },
      { category: 'Lifestyle', type: 'percent', percent: 45 },
    ],
  }), /exceeds the 100% monthly limit/);
});

test('handles zero or empty rules cleanly', () => {
  const result = computeAllocations({ monthlyIncome: 4000, rules: [] });
  assert.equal(result.totalAllocated, 0);
  assert.equal(result.remaining, 4000);
});
