# Personal Reserve

Personal Reserve is a mobile-first fintech MVP for rule-driven allotment. Users can create an account, configure monthly income, define custom bucket rules, preview scheduled payouts, and trigger payout jobs with Column-ready orchestration hooks.

## Decisions made

- Built as a compact Node.js + Express service with SQLite persistence so the app remains easy to run locally while adding real user state.
- Added a lightweight auth flow using signed session cookies and PBKDF2 password hashing.
- Kept the rules engine separate from the HTTP layer so it remains testable and easy to extend.
- Integrated with Column at the API boundary using the platform's auth, entity, bank account, and ACH transfer patterns documented at docs.column.com.
- Defaulted to mock mode when no Column API key is configured so the app works without credentials and still demonstrates the orchestration path.
- Crafted the interface as mobile-first with a stacked layout and touch-friendly controls that scale up on larger screens.

## Included in this build

- Persistent SQLite storage for users, sessions, rules, bucket accounts, and payout records
- Register/login flow with secure password hashing and session cookies
- Monthly income profile management and rule validation
- Rule-based allocation preview for fixed and percentage-based buckets
- Scheduled payout execution that stores payout records and attempts Column ACH orchestration when a key is present
- Mobile-first responsive UI with auth screen + dashboard flow

## Column integration notes

The app follows the Column docs for:

- API auth via basic auth with the key in the password slot
- person entity creation at `/entities/person`
- bank account creation at `/bank-accounts`
- transfer orchestration for ACH queueing when a live key is configured

For a production-ready version, each allocation bucket would map to issuer-specific counterparty and transfer details, with bank account IDs and settlement metadata stored per customer.

## Run locally

1. Copy `.env.example` to `.env` and add your Column API key if you want live transfer orchestration.
2. Install dependencies:

```bash
npm install
```

3. Start the app:

```bash
npm start
```

Then open http://localhost:3000.

### Testing on a real mobile device

To preview the app on a phone, expose the local server through a tunnel:

```bash
npx localtunnel --port 3000 --subdomain personal-reserve-demo
```

Then open the generated URL on your phone. If the tunnel command is unavailable, install it once with:

```bash
npx --yes localtunnel --port 3000 --subdomain personal-reserve-demo
```

## Environment configuration

The app reads configuration from environment variables, including:

- `COLUMN_API_KEY` for live Column auth
- `COLUMN_API_URL` for overriding the Column base URL
- `PORT` for the local app port

A local `.env` file is supported and is intentionally excluded from version control via `.gitignore`.

## Test

```bash
npm test
```
