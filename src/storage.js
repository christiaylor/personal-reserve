import sqlite3 from 'sqlite3';
import { randomUUID } from 'node:crypto';

const db = new sqlite3.Database('./personal-reserve.db');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

export async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      monthly_income REAL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS onboarding_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      name TEXT,
      email TEXT,
      income REAL DEFAULT 0,
      risk_profile TEXT DEFAULT 'moderate',
      kyc_verified INTEGER DEFAULT 0,
      onboarding_complete INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL DEFAULT 0,
      percent REAL DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS bucket_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      balance REAL DEFAULT 0,
      target_amount REAL DEFAULT 0,
      type TEXT NOT NULL,
      column_account_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      rule_id TEXT,
      bucket_account_id TEXT,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      details TEXT,
      scheduled_for TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
}

export async function createUser({ email, passwordHash, name }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await run(
    `INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, email.toLowerCase(), passwordHash, name, createdAt],
  );

  return { id, email: email.toLowerCase(), name, createdAt };
}

export async function getUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', [String(email || '').toLowerCase()]);
}

export async function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

export async function upsertUserProfile(id, { monthlyIncome, name }) {
  const fields = [];
  const params = [];
  if (monthlyIncome !== undefined) {
    fields.push('monthly_income = ?');
    params.push(Number(monthlyIncome || 0));
  }
  if (name !== undefined) {
    fields.push('name = ?');
    params.push(String(name || '').trim());
  }
  if (fields.length) {
    await run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
  }
}

export async function saveOnboardingState(userId, state) {
  const existing = await getOnboardingState(userId);
  const payload = {
    name: state?.name || existing?.name || '',
    email: state?.email || existing?.email || '',
    income: Number(state?.income || existing?.income || 0),
    risk_profile: state?.riskProfile || existing?.risk_profile || 'moderate',
    kyc_verified: state?.kycVerified !== undefined ? (state.kycVerified ? 1 : 0) : Number(existing?.kyc_verified || 0),
    onboarding_complete: state?.onboardingComplete !== undefined ? (state.onboardingComplete ? 1 : 0) : Number(existing?.onboarding_complete || 0),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await run(
      `UPDATE onboarding_profiles SET name = ?, email = ?, income = ?, risk_profile = ?, kyc_verified = ?, onboarding_complete = ?, updated_at = ? WHERE user_id = ?`,
      [payload.name, payload.email, payload.income, payload.risk_profile, payload.kyc_verified, payload.onboarding_complete, payload.updated_at, userId],
    );
    return payload;
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await run(
    `INSERT INTO onboarding_profiles (id, user_id, name, email, income, risk_profile, kyc_verified, onboarding_complete, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, payload.name, payload.email, payload.income, payload.risk_profile, payload.kyc_verified, payload.onboarding_complete, createdAt, payload.updated_at],
  );

  return payload;
}

export async function getOnboardingState(userId) {
  return get('SELECT * FROM onboarding_profiles WHERE user_id = ?', [userId]);
}

export async function createSession(userId, token) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await run(
    `INSERT INTO sessions (id, user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), userId, token, now.toISOString(), expiresAt],
  );
  return { expiresAt };
}

export async function getSessionByToken(token) {
  return get('SELECT * FROM sessions WHERE token = ? AND expires_at > ?', [token, new Date().toISOString()]);
}

export async function deleteSessionByToken(token) {
  await run('DELETE FROM sessions WHERE token = ?', [token]);
}

export async function saveRules(userId, rules) {
  await run('DELETE FROM rules WHERE user_id = ?', [userId]);
  for (const rule of rules) {
    await run(
      `INSERT INTO rules (id, user_id, category, type, amount, percent, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule.id || randomUUID(),
        userId,
        rule.category || 'Bucket',
        rule.type === 'fixed' ? 'fixed' : 'percent',
        Number(rule.amount || 0),
        Number(rule.percent || 0),
        rule.enabled === false ? 0 : 1,
        new Date().toISOString(),
      ],
    );
  }
}

export async function getRulesForUser(userId) {
  return all(`SELECT * FROM rules WHERE user_id = ? ORDER BY created_at ASC`, [userId]);
}

export async function upsertBucketAccount(userId, bucket) {
  const existing = await get('SELECT * FROM bucket_accounts WHERE user_id = ? AND name = ?', [userId, bucket.name]);
  if (existing) {
    await run(
      `UPDATE bucket_accounts SET balance = ?, target_amount = ?, type = ?, column_account_id = ? WHERE id = ?`,
      [Number(bucket.balance || 0), Number(bucket.target_amount || 0), bucket.type || 'bucket', bucket.column_account_id || existing.column_account_id, existing.id],
    );
    return existing.id;
  }

  const id = randomUUID();
  await run(
    `INSERT INTO bucket_accounts (id, user_id, name, balance, target_amount, type, column_account_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, bucket.name, Number(bucket.balance || 0), Number(bucket.target_amount || 0), bucket.type || 'bucket', bucket.column_account_id || null, new Date().toISOString()],
  );
  return id;
}

export async function getBucketAccountsForUser(userId) {
  return all('SELECT * FROM bucket_accounts WHERE user_id = ? ORDER BY created_at ASC', [userId]);
}

export async function linkBucketAccount(userId, bucketName, columnAccountId) {
  if (!columnAccountId) return null;
  await run(
    `UPDATE bucket_accounts SET column_account_id = ? WHERE user_id = ? AND name = ?`,
    [columnAccountId, userId, bucketName],
  );
  return { userId, bucketName, columnAccountId };
}

export async function createPayout({ userId, ruleId, bucketAccountId, amount, status, details, scheduledFor }) {
  const id = randomUUID();
  await run(
    `INSERT INTO payouts (id, user_id, rule_id, bucket_account_id, amount, status, details, scheduled_for, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, ruleId || null, bucketAccountId || null, Number(amount || 0), status, details || '', scheduledFor || new Date().toISOString(), new Date().toISOString()],
  );
  return { id };
}

export async function updatePayoutStatus(id, status, details = '') {
  await run(
    `UPDATE payouts SET status = ?, details = ? WHERE id = ?`,
    [status, details || '', id],
  );
  return { id, status, details };
}

export async function getPendingScheduledPayouts(referenceTime = new Date().toISOString()) {
  return all(
    `SELECT * FROM payouts WHERE status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for ASC`,
    [referenceTime],
  );
}

export async function getPayoutsForUser(userId, limit = 20) {
  return all(
    `SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export async function getAllUsers() {
  return all('SELECT * FROM users ORDER BY created_at ASC');
}

export default db;
