const splashScreen = document.getElementById('splashScreen');
const enterAppBtn = document.getElementById('enterAppBtn');
const authScreen = document.getElementById('authScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const ruleList = document.getElementById('ruleList');
const summaryEl = document.getElementById('summary');
const payoutListEl = document.getElementById('payoutList');
const walletCardsEl = document.getElementById('walletCards');
const bucketAccountListEl = document.getElementById('bucketAccountList');
const modeBadge = document.getElementById('modeBadge');
const userGreeting = document.getElementById('userGreeting');
const monthlyIncomeInput = document.getElementById('monthlyIncomeInput');
const monthlyIncomeDisplay = document.getElementById('monthlyIncomeDisplay');

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(value || 0));
}

function defaultRules() {
  return [
    { category: 'Emergency fund', type: 'percent', percent: 20, enabled: true },
    { category: 'Lifestyle', type: 'percent', percent: 15, enabled: true },
    { category: 'Bills', type: 'fixed', amount: 500, enabled: true },
  ];
}

function makeRuleItem(rule = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'rule-item';

  const categoryInput = document.createElement('input');
  categoryInput.type = 'text';
  categoryInput.value = rule.category || '';
  categoryInput.placeholder = 'Bucket name';

  const typeSelect = document.createElement('select');
  typeSelect.innerHTML = `
    <option value="percent" ${rule.type === 'fixed' ? '' : 'selected'}>% of income</option>
    <option value="fixed" ${rule.type === 'fixed' ? 'selected' : ''}>Fixed amount</option>
  `;

  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.step = '0.01';
  amountInput.min = '0';
  amountInput.value = rule.type === 'fixed' ? (rule.amount ?? 0) : (rule.percent ?? 0);

  const enabledCheckbox = document.createElement('input');
  enabledCheckbox.type = 'checkbox';
  enabledCheckbox.checked = rule.enabled !== false;

  wrapper.append(categoryInput, typeSelect, amountInput, enabledCheckbox);
  return wrapper;
}

function renderRules(rules = defaultRules()) {
  ruleList.innerHTML = '';
  rules.forEach((rule) => ruleList.appendChild(makeRuleItem(rule)));
}

function getRulesFromDom() {
  return Array.from(ruleList.children).map((row, index) => {
    const [categoryInput, typeSelect, amountInput, enabledCheckbox] = row.children;
    const type = typeSelect.value;
    return {
      id: `rule-${index}`,
      category: categoryInput.value || `Rule ${index + 1}`,
      type,
      enabled: enabledCheckbox.checked,
      ...(type === 'fixed' ? { amount: Number(amountInput.value || 0) } : { percent: Number(amountInput.value || 0) }),
    };
  });
}

function renderSummary(summary) {
  if (!summary || !summary.rules) {
    summaryEl.innerHTML = 'Save profile and set rules to preview allotments.';
    return;
  }

  const total = summary.totalAllocated || 0;
  const rows = summary.rules
    .filter((rule) => rule.plannedAmount > 0)
    .map((rule) => `
      <div class="rule-result">
        <span>${rule.category}</span>
        <strong>${formatMoney(rule.plannedAmount)}</strong>
      </div>
    `)
    .join('');

  summaryEl.innerHTML = `
    <div class="rule-result"><span>Monthly income</span><strong>${formatMoney(summary.monthlyIncome)}</strong></div>
    <div class="rule-result"><span>Total allotted</span><strong>${formatMoney(total)}</strong></div>
    <div class="rule-result"><span>Remaining</span><strong>${formatMoney(summary.remaining)}</strong></div>
    ${rows}
  `;
}

function renderPayouts(payouts = []) {
  if (!payouts.length) {
    payoutListEl.innerHTML = '<div class="empty-state">No scheduled payouts yet.</div>';
    return;
  }

  payoutListEl.innerHTML = payouts
    .slice(0, 5)
    .map((payout) => `
      <div class="payout-item">
        <div>
          <strong>${formatMoney(payout.amount)}</strong>
          <small>${new Date(payout.createdAt || payout.scheduledFor).toLocaleDateString()}</small>
        </div>
        <span class="pill ${payout.status}">${payout.status}</span>
      </div>
    `)
    .join('');
}

function renderWallet(bucketAccounts = []) {
  if (!bucketAccounts.length) {
    walletCardsEl.innerHTML = '<div class="wallet-card empty">No linked buckets yet.</div>';
    bucketAccountListEl.innerHTML = '<div class="empty-state">No bank links configured.</div>';
    return;
  }

  const totalBalance = bucketAccounts.reduce((sum, bucket) => sum + Number(bucket.balance || 0), 0);
  const totalTarget = bucketAccounts.reduce((sum, bucket) => sum + Number(bucket.targetAmount || 0), 0);

  walletCardsEl.innerHTML = `
    <div class="wallet-card primary">
      <span>Available</span>
      <strong>${formatMoney(totalBalance)}</strong>
    </div>
    <div class="wallet-card">
      <span>Targets</span>
      <strong>${formatMoney(totalTarget)}</strong>
    </div>
  `;

  bucketAccountListEl.innerHTML = bucketAccounts
    .map((bucket) => `
      <div class="bucket-item">
        <div>
          <strong>${bucket.name}</strong>
          <small>${bucket.columnAccountId ? `Linked: ${bucket.columnAccountId}` : 'Not linked yet'}</small>
        </div>
        <span>${formatMoney(bucket.targetAmount || 0)}</span>
      </div>
    `)
    .join('');
}

function showDashboard(user, rules = defaultRules()) {
  authScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  userGreeting.textContent = `Hi, ${user.name.split(' ')[0]}`;
  monthlyIncomeInput.value = user.monthlyIncome || 0;
  monthlyIncomeDisplay.textContent = formatMoney(user.monthlyIncome || 0);
  renderRules(rules);
}

function hideSplash() {
  if (splashScreen) {
    splashScreen.classList.add('hidden');
  }
}

function showAuth() {
  dashboardScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
}

async function fetchMode() {
  const response = await fetch('/api/health');
  const data = await response.json();
  modeBadge.textContent = data.mode === 'column-live' ? 'Column' : 'Mock';
}

async function loadDashboard() {
  const response = await fetch('/api/session');
  const data = await response.json();
  if (!data.authenticated) {
    showAuth();
    return;
  }

  const dashboardResponse = await fetch('/api/dashboard');
  const dashboardData = await dashboardResponse.json();

  if (!dashboardResponse.ok || !dashboardData.ok) {
    showAuth();
    return;
  }

  showDashboard(dashboardData.user, dashboardData.rules || defaultRules());
  renderWallet(dashboardData.bucketAccounts || []);
  renderSummary(dashboardData.summary);
  renderPayouts(dashboardData.payouts || []);
}

async function saveProfile() {
  const monthlyIncome = Number(monthlyIncomeInput.value || 0);
  const rules = getRulesFromDom();

  const response = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthlyIncome, rules }),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    alert(data.error || 'Unable to save profile.');
    return;
  }

  monthlyIncomeDisplay.textContent = formatMoney(monthlyIncome);
  renderSummary(data.summary);
}

async function previewRules() {
  const monthlyIncome = Number(monthlyIncomeInput.value || 0);
  const response = await fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ monthlyIncome, rules: getRulesFromDom() }),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    alert(data.error || 'Unable to preview allocations.');
    return;
  }

  renderSummary(data);
}

async function runPayouts() {
  const response = await fetch('/api/payouts/run', { method: 'POST' });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    alert(data.error || 'Payouts could not be scheduled.');
    return;
  }

  renderSummary(data.summary);
  renderPayouts(
    data.payouts.map((payout) => ({
      ...payout,
      createdAt: new Date().toISOString(),
      scheduledFor: new Date().toISOString(),
    })),
  );
}

async function saveOnboarding(event) {
  event.preventDefault();
  const payload = {
    name: document.getElementById('onboardingName').value,
    email: document.getElementById('onboardingEmail').value,
    income: Number(document.getElementById('onboardingIncome').value || 0),
    riskProfile: document.getElementById('onboardingRisk').value,
    kycVerified: document.getElementById('onboardingKyc').checked,
    onboardingComplete: true,
  };

  const response = await fetch('/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    alert(data.error || 'Unable to save onboarding.');
    return;
  }

  renderOnboarding(data.onboarding || payload);
  userGreeting.textContent = `Hi, ${(payload.name || 'there').split(' ')[0]}`;
  monthlyIncomeInput.value = payload.income;
  monthlyIncomeDisplay.textContent = formatMoney(payload.income);
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    email: form.email.value,
    password: form.password.value,
  };

  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    alert(data.error || 'Unable to log in.');
    return;
  }

  showDashboard(data.user, data.rules || defaultRules());
  renderSummary({
    monthlyIncome: data.user.monthlyIncome || 0,
    rules: data.rules?.map((rule) => ({
      category: rule.category,
      plannedAmount: rule.type === 'fixed' ? Number(rule.amount || 0) : Number((data.user.monthlyIncome * (Number(rule.percent || 0) / 100)) || 0),
    })) || [],
    totalAllocated: 0,
    remaining: data.user.monthlyIncome || 0,
  });
}

async function register(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    name: form.name.value,
    email: form.email.value,
    password: form.password.value,
  };

  const response = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    alert(data.error || 'Unable to create account.');
    return;
  }

  showDashboard(data.user, data.rules || defaultRules());
  renderSummary({
    monthlyIncome: 0,
    rules: [],
    totalAllocated: 0,
    remaining: 0,
  });
}

async function linkAccount() {
  const bucketName = window.prompt('Which bucket should be linked to a Column account?');
  if (!bucketName) return;
  const columnAccountId = window.prompt('Enter the Column account ID to link.');
  if (!columnAccountId) return;

  const response = await fetch('/api/buckets/link-column', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketName, columnAccountId }),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    alert(data.error || 'Unable to link the bank account.');
    return;
  }

  await loadDashboard();
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  showAuth();
}

document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    document.querySelectorAll('.tab-button').forEach((item) => item.classList.toggle('active', item === button));
    document.getElementById('loginForm').classList.toggle('hidden', mode !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', mode !== 'register');
  });
});

document.getElementById('loginForm').addEventListener('submit', login);
document.getElementById('registerForm').addEventListener('submit', register);
document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
document.getElementById('previewBtn').addEventListener('click', previewRules);
document.getElementById('runPayoutBtn').addEventListener('click', runPayouts);
document.getElementById('linkAccountBtn').addEventListener('click', linkAccount);
document.getElementById('addRuleBtn').addEventListener('click', () => {
  ruleList.appendChild(makeRuleItem({ category: `Bucket ${ruleList.children.length + 1}`, type: 'percent', percent: 10, enabled: true }));
});

document.getElementById('logoutBtn').addEventListener('click', logout);

const onboardingBtnEl = document.getElementById('onboardingBtn');
if (onboardingBtnEl) {
  onboardingBtnEl.addEventListener('click', () => {
    window.location.href = '/onboarding.html';
  });
}

if (enterAppBtn) {
  enterAppBtn.addEventListener('click', hideSplash);
}

window.setTimeout(() => {
  if (dashboardScreen && !dashboardScreen.classList.contains('hidden')) {
    hideSplash();
    return;
  }

  if (authScreen && !authScreen.classList.contains('hidden')) {
    hideSplash();
  }
}, 1400);

fetchMode();
loadDashboard();
