import 'dotenv/config';
import express from 'express';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { computeAllocations } from './src/allocationEngine.js';
import { createToken, verifyToken, getCookieToken, setAuthCookie, clearAuthCookie } from './src/auth.js';
import {
  initializeDatabase,
  createUser,
  getUserByEmail,
  createSession,
  getSessionByToken,
  deleteSessionByToken,
  upsertUserProfile,
  saveRules,
  getRulesForUser,
  upsertBucketAccount,
  getBucketAccountsForUser,
  createPayout,
  getPayoutsForUser,
  getUserById,
  saveOnboardingState,
  getOnboardingState,
  linkBucketAccount,
} from './src/storage.js';
import { createScheduledPayoutForUser, runScheduledPayouts, getScheduledPayoutSummary } from './src/scheduler.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const COLUMN_API_KEY = process.env.COLUMN_API_KEY || '';
const COLUMN_API_URL = (process.env.COLUMN_API_URL || 'https://api.column.com').replace(/\/$/, '');
const requestMetrics = {
  totalRequests: 0,
  totalErrors: 0,
  byRoute: {},
  lastEvents: [],
};

app.use(express.json());
app.use((req, _res, next) => {
  requestMetrics.totalRequests += 1;
  const routeKey = `${req.method} ${req.path}`;
  requestMetrics.byRoute[routeKey] = (requestMetrics.byRoute[routeKey] || 0) + 1;
  next();
});
app.use(express.static('public'));

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const generated = pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return timingSafeEqual(Buffer.from(generated), Buffer.from(hash));
}

function getAuthHeader() {
  return `Basic ${Buffer.from(`:${COLUMN_API_KEY}`).toString('base64')}`;
}

async function requireAuth(req, res, next) {
  const token = getCookieToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }

  const userId = verifyToken(token);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Session expired or invalid.' });
  }

  const session = await getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Session expired or invalid.' });
  }

  req.userId = userId;
  next();
}

function buildDefaultRules() {
  return [
    { category: 'Emergency fund', type: 'percent', percent: 20, enabled: true },
    { category: 'Lifestyle', type: 'percent', percent: 15, enabled: true },
    { category: 'Bills', type: 'fixed', amount: 500, enabled: true },
  ];
}

async function ensureBucketAccounts(userId, rules, monthlyIncome) {
  const computed = computeAllocations({ monthlyIncome, rules });
  for (const rule of computed.rules) {
    await upsertBucketAccount(userId, {
      name: rule.category,
      balance: 0,
      target_amount: rule.plannedAmount,
      type: rule.type,
    });
  }
  return computed;
}

async function maybeCreateColumnTransfer({ bucketName, amount, userEmail, columnAccountId }) {
  if (!COLUMN_API_KEY) {
    return { mock: true, status: 'mocked', message: 'No Column key configured; transfer was queued in mock mode.' };
  }

  const payload = {
    account_number: '123456789',
    routing_number: '121000248',
    routing_number_type: 'aba',
    account_type: 'checking',
    name: `${userEmail || 'Personal Reserve'}-${bucketName}`,
    description: `Personal Reserve bucket allocation for ${bucketName}`,
    amount: Math.round(amount),
    type: 'CREDIT',
    entry_class_code: 'PPD',
    currency_code: 'USD',
    ...(columnAccountId ? { account_id: columnAccountId } : {}),
  };

  try {
    const response = await fetch(`${COLUMN_API_URL}/transfers/ach`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { mock: false, status: 'queued', error: text };
    }

    const body = await response.json();
    return { mock: false, status: 'transferred', transfer: body };
  } catch (error) {
    return { mock: false, status: 'queued', error: error.message };
  }
}

function normalizeOnboardingState(user, onboarding) {
  const name = onboarding?.name || user?.name || '';
  const email = onboarding?.email || user?.email || '';
  return {
    name,
    email,
    income: Number(onboarding?.income ?? user?.monthly_income ?? 0),
    riskProfile: onboarding?.risk_profile || onboarding?.riskProfile || 'moderate',
    kycVerified: Number(onboarding?.kyc_verified ?? onboarding?.kycVerified ?? 0) === 1,
    onboardingComplete: Number(onboarding?.onboarding_complete ?? onboarding?.onboardingComplete ?? 0) === 1,
  };
}

app.use((req, res, next) => {
  const routeKey = `${req.method} ${req.path}`;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400) {
      requestMetrics.totalErrors += 1;
    }
    requestMetrics.lastEvents = [
      {
        route: routeKey,
        statusCode: res.statusCode,
        at: new Date().toISOString(),
      },
      ...requestMetrics.lastEvents,
    ].slice(0, 50);
    return originalJson(body);
  };
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: COLUMN_API_KEY ? 'column-live' : 'mock',
    message: COLUMN_API_KEY
      ? 'Column sandbox credentials detected. Live APIs are enabled.'
      : 'No Column API key configured. Using mock mode for local development.',
    columnApiUrl: COLUMN_API_URL,
    metrics: {
      totalRequests: requestMetrics.totalRequests,
      totalErrors: requestMetrics.totalErrors,
    },
  });
});

app.get('/api/metrics', requireAuth, async (_req, res) => {
  const schedulerSummary = await getScheduledPayoutSummary();
  res.json({
    ok: true,
    metrics: {
      totalRequests: requestMetrics.totalRequests,
      totalErrors: requestMetrics.totalErrors,
      byRoute: requestMetrics.byRoute,
      recentEvents: requestMetrics.lastEvents,
      schedulerSummary,
    },
  });
});

app.get('/api/session', async (req, res) => {
  const token = getCookieToken(req);
  if (!token) {
    return res.json({ ok: true, authenticated: false });
  }

  const userId = verifyToken(token);
  if (!userId) {
    return res.json({ ok: true, authenticated: false });
  }

  const session = await getSessionByToken(token);
  if (!session) {
    return res.json({ ok: true, authenticated: false });
  }

  const user = await getUserById(userId);
  const onboarding = await getOnboardingState(userId);
  return res.json({
    ok: true,
    authenticated: !!user,
    user: user ? { id: user.id, email: user.email, name: user.name, monthlyIncome: Number(user.monthly_income || 0) } : null,
    onboarding: user ? normalizeOnboardingState(user, onboarding) : null,
  });
});

app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ ok: false, error: 'Name, email, and password are required.' });
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ ok: false, error: 'An account already exists for that email.' });
  }

  const user = await createUser({ email, passwordHash: hashPassword(password), name });
  await saveRules(user.id, buildDefaultRules());
  await upsertUserProfile(user.id, { monthlyIncome: 0 });
  const onboarding = await saveOnboardingState(user.id, {
    name,
    email,
    income: 0,
    riskProfile: 'moderate',
    kycVerified: false,
    onboardingComplete: false,
  });

  const token = createToken(user.id);
  await createSession(user.id, token);
  setAuthCookie(res, token);

  return res.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, monthlyIncome: 0 },
    rules: buildDefaultRules(),
    onboarding: normalizeOnboardingState(user, onboarding),
  });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password are required.' });
  }

  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials.' });
  }

  const token = createToken(user.id);
  await createSession(user.id, token);
  setAuthCookie(res, token);

  const rules = await getRulesForUser(user.id);
  const onboarding = await getOnboardingState(user.id);
  return res.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, monthlyIncome: Number(user.monthly_income || 0) },
    rules: rules.map((rule) => ({
      id: rule.id,
      category: rule.category,
      type: rule.type,
      amount: Number(rule.amount || 0),
      percent: Number(rule.percent || 0),
      enabled: Number(rule.enabled) === 1,
    })),
    onboarding: normalizeOnboardingState(user, onboarding),
  });
});

app.post('/api/logout', async (req, res) => {
  const token = getCookieToken(req);
  if (token) {
    await deleteSessionByToken(token);
  }
  clearAuthCookie(res);
  return res.json({ ok: true });
});

app.post('/api/preview', requireAuth, async (req, res) => {
  try {
    const { monthlyIncome, rules = [] } = req.body || {};
    const result = computeAllocations({ monthlyIncome, rules });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ ok: false, error: 'User not found.' });
  }

  const rules = await getRulesForUser(req.userId);
  const bucketAccounts = await getBucketAccountsForUser(req.userId);
  const payouts = await getPayoutsForUser(req.userId, 10);
  const onboarding = await getOnboardingState(req.userId);
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

  return res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      monthlyIncome: Number(user.monthly_income || 0),
    },
    rules: rules.map((rule) => ({
      id: rule.id,
      category: rule.category,
      type: rule.type,
      amount: Number(rule.amount || 0),
      percent: Number(rule.percent || 0),
      enabled: Number(rule.enabled) === 1,
    })),
    bucketAccounts: bucketAccounts.map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      balance: Number(bucket.balance || 0),
      targetAmount: Number(bucket.target_amount || 0),
      type: bucket.type,
      columnAccountId: bucket.column_account_id,
    })),
    payouts: payouts.map((payout) => ({
      id: payout.id,
      amount: Number(payout.amount || 0),
      status: payout.status,
      details: payout.details,
      scheduledFor: payout.scheduled_for,
      createdAt: payout.created_at,
    })),
    onboarding: normalizeOnboardingState(user, onboarding),
    summary,
  });
});

app.post('/api/profile', requireAuth, async (req, res) => {
  const { monthlyIncome = 0, rules = [] } = req.body || {};

  await upsertUserProfile(req.userId, { monthlyIncome });
  await saveRules(req.userId, rules);
  const summary = computeAllocations({ monthlyIncome, rules });

  for (const rule of summary.rules) {
    await upsertBucketAccount(req.userId, {
      name: rule.category,
      balance: 0,
      target_amount: rule.plannedAmount,
      type: rule.type,
    });
  }

  return res.json({ ok: true, summary });
});

app.get('/api/onboarding', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const onboarding = await getOnboardingState(req.userId);
  return res.json({ ok: true, onboarding: normalizeOnboardingState(user, onboarding) });
});

app.post('/api/onboarding', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const { name, email, income, riskProfile, kycVerified, onboardingComplete } = req.body || {};
  const normalized = {
    name: name || user?.name || '',
    email: email || user?.email || '',
    income: Number(income ?? user?.monthly_income ?? 0),
    riskProfile: riskProfile || 'moderate',
    kycVerified: Boolean(kycVerified),
    onboardingComplete: Boolean(onboardingComplete),
  };

  await upsertUserProfile(req.userId, { monthlyIncome: normalized.income, name: normalized.name });
  const saved = await saveOnboardingState(req.userId, normalized);
  return res.json({ ok: true, onboarding: normalizeOnboardingState({ ...user, name: normalized.name, email: normalized.email, monthly_income: normalized.income }, saved) });
});

app.post('/api/buckets/link-column', requireAuth, async (req, res) => {
  const { bucketName, columnAccountId } = req.body || {};
  if (!bucketName || !columnAccountId) {
    return res.status(400).json({ ok: false, error: 'Bucket name and Column account ID are required.' });
  }

  const result = await linkBucketAccount(req.userId, bucketName, columnAccountId);
  return res.json({ ok: true, link: result });
});

app.post('/api/payouts/schedule', requireAuth, async (req, res) => {
  const result = await createScheduledPayoutForUser(req.userId);
  return res.json(result);
});

app.post('/api/scheduler/run', requireAuth, async (req, res) => {
  const result = await runScheduledPayouts({ transferExecutor: maybeCreateColumnTransfer });
  return res.json(result);
});

app.post('/api/payouts/run', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const rules = await getRulesForUser(req.userId);
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

  const payoutResults = [];
  for (const rule of summary.rules) {
    const bucket = await getBucketAccountsForUser(req.userId).then((buckets) => buckets.find((entry) => entry.name === rule.category));
    const bucketId = await upsertBucketAccount(req.userId, {
      name: rule.category,
      balance: 0,
      target_amount: rule.plannedAmount,
      type: rule.type,
      column_account_id: bucket?.column_account_id || null,
    });

    const transferResult = await maybeCreateColumnTransfer({
      bucketName: rule.category,
      amount: rule.plannedAmount,
      userEmail: user.email,
      columnAccountId: bucket?.column_account_id || null,
    });

    const payout = await createPayout({
      userId: req.userId,
      ruleId: rule.id,
      bucketAccountId: bucketId,
      amount: rule.plannedAmount,
      status: transferResult.status || 'scheduled',
      details: JSON.stringify(transferResult),
      scheduledFor: new Date().toISOString(),
    });

    payoutResults.push({ payoutId: payout.id, rule: rule.category, amount: rule.plannedAmount, status: transferResult.status || 'scheduled' });
  }

  return res.json({ ok: true, summary, payouts: payoutResults });
});

app.post('/api/column/setup', requireAuth, async (req, res) => {
  const { firstName, lastName, email, income, address } = req.body || {};

  if (!COLUMN_API_KEY) {
    return res.json({
      ok: true,
      mock: true,
      message: 'No Column API key. This app is running in mock mode and hasn’t created a live entity yet.',
      summary: { firstName, lastName, email, income },
    });
  }

  try {
    const entityPayload = {
      first_name: String(firstName || 'Customer'),
      last_name: String(lastName || 'User'),
      email: String(email || 'user@example.com'),
      phone_number: '+15555555555',
      ssn: '565438976',
      date_of_birth: '1990-01-15',
      address: {
        line_1: address?.line1 || '101 Market St',
        city: address?.city || 'San Francisco',
        state: address?.state || 'CA',
        postal_code: address?.postalCode || '94105',
        country_code: address?.countryCode || 'US',
      },
      pep_status: 'not_checked',
    };

    const entityResponse = await fetch(`${COLUMN_API_URL}/entities/person`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify(entityPayload),
    });

    if (!entityResponse.ok) {
      const text = await entityResponse.text();
      throw new Error(`Entity creation failed: ${entityResponse.status} ${text}`);
    }

    const entity = await entityResponse.json();

    const bankPayload = {
      entity_id: entity.id,
      description: 'Personal Reserve spending account',
      display_name: 'Personal Reserve Main',
      currency_code: 'USD',
    };

    const bankResponse = await fetch(`${COLUMN_API_URL}/bank-accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify(bankPayload),
    });

    if (!bankResponse.ok) {
      const text = await bankResponse.text();
      throw new Error(`Bank account creation failed: ${bankResponse.status} ${text}`);
    }

    const account = await bankResponse.json();
    await upsertBucketAccount(req.userId, {
      name: 'Primary Reserve',
      balance: 0,
      target_amount: Number(income || 0),
      type: 'bucket',
      column_account_id: account.id,
    });

    res.json({
      ok: true,
      mock: false,
      entity,
      account,
      linkedBucket: 'Primary Reserve',
      message: 'User and account were created using the Column API.',
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.use((_req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Personal Reserve listening on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed', error);
    process.exit(1);
  });
