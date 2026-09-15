import { createPayout, getUserById, getRulesForUser, getBucketAccountsForUser, getPendingScheduledPayouts, updatePayoutStatus, getAllUsers } from './storage.js';
import { computeAllocations } from './allocationEngine.js';

export async function runScheduledPayouts({ transferExecutor } = {}) {
  const pendingPayouts = await getPendingScheduledPayouts();
  const processed = [];

  for (const payout of pendingPayouts) {
    const user = await getUserById(payout.user_id);
    if (!user) {
      await updatePayoutStatus(payout.id, 'cancelled', 'User no longer exists.');
      processed.push({ id: payout.id, status: 'cancelled' });
      continue;
    }

    let transferResult = { mock: true, status: 'mocked', message: 'No transfer execution callback configured.' };
    if (typeof transferExecutor === 'function') {
      transferResult = await transferExecutor({
        bucketName: payout.bucket_account_id ? 'Scheduled bucket' : 'Recurring transfer',
        amount: Number(payout.amount || 0),
        userEmail: user.email,
        ruleId: payout.rule_id,
        bucketAccountId: payout.bucket_account_id,
      });
    }

    const status = transferResult?.status || 'scheduled';
    await updatePayoutStatus(payout.id, status, JSON.stringify(transferResult));
    processed.push({
      id: payout.id,
      userId: payout.user_id,
      amount: Number(payout.amount || 0),
      status,
    });
  }

  return {
    ok: true,
    processed: processed.length,
    payouts: processed,
    message: processed.length ? 'Scheduled payouts processed.' : 'No scheduled payouts ready to process.',
  };
}

export async function createScheduledPayoutForUser(userId) {
  const user = await getUserById(userId);
  const rules = await getRulesForUser(userId);
  const buckets = await getBucketAccountsForUser(userId);

  if (!user || !rules.length) {
    return { ok: false, message: 'No user or rules available for payouts.' };
  }

  const summary = computeAllocations({
    monthlyIncome: Number(user.monthly_income || 0),
    rules: rules.map((rule) => ({
      id: rule.id,
      category: rule.category,
      type: rule.type,
      amount: Number(rule.amount || 0),
      percent: Number(rule.percent || 0),
      enabled: Number(rule.enabled) === 1,
    })),
  });

  const payoutEntries = [];
  for (const rule of summary.rules) {
    const bucket = buckets.find((entry) => entry.name === rule.category) || { id: null, name: rule.category };
    const payout = await createPayout({
      userId,
      ruleId: rule.id,
      bucketAccountId: bucket.id,
      amount: rule.plannedAmount,
      status: 'scheduled',
      details: `Recurring payout scheduled for ${rule.category}`,
      scheduledFor: new Date().toISOString(),
    });

    payoutEntries.push({ id: payout.id, bucket: bucket.name, amount: rule.plannedAmount, status: 'scheduled' });
  }

  return { ok: true, payouts: payoutEntries };
}

export async function getScheduledPayoutSummary() {
  const users = await getAllUsers();
  const entries = [];
  for (const user of users) {
    const rules = await getRulesForUser(user.id);
    const summary = computeAllocations({
      monthlyIncome: Number(user.monthly_income || 0),
      rules: rules.map((rule) => ({
        id: rule.id,
        category: rule.category,
        type: rule.type,
        amount: Number(rule.amount || 0),
        percent: Number(rule.percent || 0),
        enabled: Number(rule.enabled) === 1,
      })),
    });
    entries.push({ userId: user.id, email: user.email, totalAllocated: summary.totalAllocated, ruleCount: summary.rules.length });
  }
  return entries;
}
