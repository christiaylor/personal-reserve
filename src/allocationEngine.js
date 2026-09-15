export function computeAllocations({ monthlyIncome, rules = [] }) {
  const income = Number(monthlyIncome ?? 0);
  if (!Number.isFinite(income) || income < 0) {
    throw new Error('Monthly income must be a non-negative number.');
  }

  const normalized = rules
    .map((rule, index) => {
      const type = rule.type === 'fixed' || rule.type === 'percent'
        ? rule.type
        : (rule.amount != null ? 'fixed' : 'percent');
      const category = String(rule.category || rule.name || `Bucket ${index + 1}`);
      const percent = Number(rule.percent ?? 0);
      const amount = Number(rule.amount ?? 0);

      if (type === 'percent' && (!Number.isFinite(percent) || percent < 0)) {
        throw new Error(`${category} percent must be a non-negative number.`);
      }

      if (type === 'fixed' && (!Number.isFinite(amount) || amount < 0)) {
        throw new Error(`${category} amount must be a non-negative number.`);
      }

      return {
        id: rule.id || `${category.toLowerCase().replace(/\s+/g, '-')}-${index}`,
        category,
        type,
        percent,
        amount,
        enabled: rule.enabled !== false,
      };
    })
    .filter((rule) => rule.enabled);

  const fixedRules = normalized.filter((rule) => rule.type === 'fixed');
  const percentRules = normalized.filter((rule) => rule.type === 'percent');

  const fixedTotal = fixedRules.reduce((sum, rule) => sum + rule.amount, 0);
  const percentTotal = percentRules.reduce((sum, rule) => sum + rule.percent, 0);

  if (percentTotal > 100) {
    throw new Error(`Percent-based rules add up to ${percentTotal}%, which exceeds the 100% monthly limit.`);
  }

  const allocatableIncome = Math.max(0, income - fixedTotal);
  const mappedRules = [
    ...fixedRules.map((rule) => ({
      ...rule,
      plannedAmount: rule.amount,
      source: 'fixed',
    })),
    ...percentRules.map((rule) => ({
      ...rule,
      plannedAmount: allocatableIncome * (rule.percent / 100),
      source: 'percent',
    })),
  ];

  const totalAllocated = mappedRules.reduce((sum, rule) => sum + rule.plannedAmount, 0);

  return {
    monthlyIncome: income,
    totalAllocated,
    fixedTotal,
    percentTotal,
    remaining: Math.max(0, income - totalAllocated),
    rules: mappedRules,
  };
}
