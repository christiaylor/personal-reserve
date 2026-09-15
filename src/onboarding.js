export function buildOnboardingState({ name, email, monthlyIncome = 0, riskProfile = 'moderate' }) {
  return {
    onboardingComplete: Boolean(name && email),
    name,
    email,
    monthlyIncome: Number(monthlyIncome || 0),
    riskProfile,
    status: 'ready',
    steps: [
      { id: 'identity', label: 'Identity', complete: Boolean(name && email) },
      { id: 'income', label: 'Income', complete: Number(monthlyIncome || 0) > 0 },
      { id: 'risk', label: 'Risk profile', complete: Boolean(riskProfile) },
    ],
  };
}
