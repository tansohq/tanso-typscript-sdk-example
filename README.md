# Tanso SDK Example App

A working reference app that demonstrates how to integrate the [`@tansohq/sdk`](https://www.npmjs.com/package/@tansohq/sdk) into a Node.js backend. Use this as a starting point for adding billing, entitlements, and usage metering to your own app.

## Prerequisites

- **Node.js** v18+
- A **Tanso account** with an API key (sandbox keys start with `sk_test_`)
- At least one **plan with features** configured in your [Tanso dashboard](https://app.tansoflow.com)

## Quick Start

```bash
git clone <repo-url> && cd tanso-typescript-sdk-example
cp .env.example .env    # then paste your Tanso API key
npm install
npm start               # http://localhost:3000
```

The app opens a tabbed UI where you can walk through the full integration flow interactively.

## Project Structure

```
server.js            Express backend — each route maps 1:1 to an SDK method
public/index.html    Single-page UI with tabs for each SDK feature
public/app.js        Vanilla JS frontend — calls the Express API routes
.env.example         Template for environment variables
```

## Architecture

```
Browser (public/app.js)  →  Express (server.js)  →  Tanso API (@tansohq/sdk)
```

The SDK runs **server-side only** so your API key is never exposed to the browser. The Express server is a thin pass-through — each route calls exactly one SDK method and returns the result.

## Integration Flow

This is the typical order of operations when integrating Tanso into your app:

### 1. List Plans — build your pricing page

```js
const plans = await tanso.plans.list();
// Returns: { items: [{ plan, features, creditAllocations }], pagination }
```

Each plan includes its base price, billing interval, linked features (with pricing rules), and credit allocations. Use this to render your pricing page dynamically.

**Feature pricing models:**
| Model | Description | Example |
|---|---|---|
| Included | Boolean on/off, no metering | Dashboard access |
| Usage-based | Priced per unit, optional hard cap (`maxUsage`) | $0.01 per API call, max 10,000/mo |
| Graduated | Tiered pricing at volume thresholds | First 1,000 at $0.10, next 4,000 at $0.08 |
| Credit-based | Consumes from a credit pool | 1 credit per AI generation |

### 2. Create Customer — when a user signs up

```js
const customer = await tanso.customers.create({
  customerReferenceId: "user_123",  // YOUR unique user ID
  email: "jane@example.com",
  firstName: "Jane",                // optional
  lastName: "Doe",                  // optional
});
```

The `customerReferenceId` is **your** identifier — use whatever ID your auth system or database already assigns to users. You'll reference this ID in every subsequent SDK call.

### 3. Create Subscription — when the user picks a plan

```js
const result = await tanso.subscriptions.create({
  customerReferenceId: "user_123",
  planId: "plan_abc123",
});
// Returns: { subscription, invoice }
```

This grants the customer entitlements to all features on the plan and allocates any credits.

**Billing behavior:**
- **`IN_ADVANCE`** — Invoice generated immediately; subscription starts as `draft` until payment is confirmed.
- **`IN_ARREARS`** — Subscription activates immediately; invoiced at period end.
- **Free plans** (priceAmount = 0) — Activate immediately, no invoice.

### 4. Check Entitlements — gate features in real-time

This is the core of feature gating. Call this **before** allowing access to any paid or limited feature.

```js
// Check a single feature
const check = await tanso.entitlements.check("user_123", "api_access");

if (!check.allowed) {
  return res.status(403).json({ error: "Upgrade required" });
}
```

The response always includes `referenceCustomerId`, `featureKey`, `allowed`, `flowId`, and `meta`. When allowed, `meta` is `null`. When denied, `meta` contains a reason (e.g. `{ reason: { description: "Entitlement is revoked" } }`). Additional fields vary by feature type:

```js
// Boolean feature
{
  referenceCustomerId: "user_123",
  featureKey: "file_storage",
  allowed: true,
  flowId: null,
  meta: null
}

// Usage-limited feature — includes usage stats
{
  referenceCustomerId: "user_123",
  featureKey: "api_access",
  allowed: true,
  flowId: null,
  meta: null,
  usage: { used: 0, limit: 10000, remaining: 10000 }
}

// Credit-gated feature — includes credit balance
{
  referenceCustomerId: "user_123",
  featureKey: "ai_messages",
  allowed: true,
  flowId: null,
  meta: null,
  credit: { balance: 5000, totalGranted: 10000, totalConsumed: 5000, hardLimit: true }
}
```

You can also **list all entitlements** for a customer (useful for dashboards):

```js
const all = await tanso.entitlements.list("user_123");
// Returns: { referenceCustomerId, subscriptions: [{ subscriptionId, entitlements: [{ featureKey, allowed }] }] }
```

Or **simulate usage** before committing it:

```js
const sim = await tanso.entitlements.evaluate({
  customerReferenceId: "user_123",
  featureKey: "ai_messages",
  usage: { usageUnits: 500, eventName: "token_consumption" },
});
// sim.simulation.wouldExceedLimit → true/false
```

### 5. Ingest Usage Events — track metered consumption

Send an event whenever a customer performs a billable action:

```js
const result = await tanso.events.ingest({
  customerReferenceId: "user_123",
  eventName: "api_call",
  featureKey: "api_access",           // links to feature for limit tracking
  usageUnits: 1,                      // quantity consumed (default: 1)
  eventIdempotencyKey: "req_abc123",  // unique key — safe to retry
});
// result.usageLimitExceeded → true if limit was just exceeded
```

**Important:** Always provide a unique `eventIdempotencyKey`. If your app retries a failed request with the same key, Tanso deduplicates it automatically — no double billing.

### 6. Check Credit Balances — show remaining credits

```js
const pools = await tanso.credits.listPools("user_123");
// Returns: { items: [{ denomination, balance, totalGranted, totalConsumed, hardLimit, status }] }
```

Credit pools are created automatically when a customer subscribes to a plan with credit allocations. Credits can come from multiple sources:

| Grant Type | Description | On Cancel |
|---|---|---|
| `PLAN_INCLUDED` | Auto-granted each billing cycle | Clawed back |
| `PURCHASED` | Bought by the customer | Kept |
| `PROMOTIONAL` | Given for free | Kept |
| `ROLLOVER` | Carried over from previous period | Kept |

## Additional SDK Methods

Beyond the core flow above, the SDK also supports:

| Method | Description |
|---|---|
| `subscriptions.cancel(id, mode)` | Cancel a subscription (`END_OF_PERIOD` or `IMMEDIATE`) |
| `subscriptions.changePlan(id, { changeToPlanId, changeType })` | Upgrade or downgrade a subscription |
| `subscriptions.revertCancellation(id)` | Revert an end-of-period cancellation before the period ends |
| `subscriptions.cancelScheduledChange(id)` | Cancel a pending plan change |
| `customers.get(referenceId)` | Retrieve a customer by your reference ID |
| `customers.update(referenceId, params)` | Update customer details (email, name, etc.) |
| `features.list()` | List all features defined in your account |
| `features.get(featureKey)` | Get a single feature by key |
| `billing.listInvoices(customerId)` | List invoices for a customer |
| `billing.markPaid(invoiceId)` | Manually mark an invoice as paid |
| `billing.createCheckoutSession(invoiceId)` | Get a Stripe checkout URL for an invoice |
| `credits.getPool(customerId, poolId)` | Get details of a single credit pool |
| `credits.listTransactions(customerId, poolId)` | View credit consumption and grant history |
| `credits.listGrants(customerId, poolId)` | View individual credit grants |

## Error Handling

The SDK throws typed errors with HTTP status codes:

| Error Class | Status | When |
|---|---|---|
| `TansoAuthenticationError` | 401 | Invalid or expired API key |
| `TansoNotFoundError` | 404 | Customer, plan, or feature not found |
| `TansoConflictError` | 409 | Duplicate `customerReferenceId`, already subscribed, etc. |
| `TansoApiError` | 4xx/5xx | General API error |
| `TansoNetworkError` | — | Connection or timeout failure |

API errors (`TansoApiError` and its subtypes) include `message`, `statusCode`, and an optional `detail` string. `TansoNetworkError` includes `message` and an optional `cause` error.

## Environment Configuration

| Variable | Description |
|---|---|
| `TANSO_API_KEY` | Your Tanso API key. `sk_test_` prefix uses sandbox; `sk_live_` uses production. |
| `PORT` | Server port (default: `3000`) |

The SDK auto-detects the environment from the API key prefix. You can also override the base URL:

```js
const tanso = new TansoClient(apiKey, { baseUrl: "https://custom.api.example.com" });
```

## Adapting This Example

1. **Replace the frontend** — swap the vanilla JS with React, Vue, Next.js, etc. The Express API routes stay the same.
2. **Add auth middleware** — protect the API routes so users can only access their own data.
3. **Map `customerReferenceId`** — use your existing user ID from your auth system or database.
4. **Gate features with `entitlements.check()`** — add this to your middleware or feature flags.
5. **Track usage with `events.ingest()`** — call this whenever a metered action occurs.
6. **Derive idempotency keys from your domain** — use request IDs, transaction IDs, or other natural keys instead of random strings.

## License

ISC
