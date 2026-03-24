# Tanso SDK Example App

Minimal example showing how to integrate `@tansohq/sdk` into a Node.js app with a vanilla JS frontend.

## Structure

```
server.js          Express backend — thin proxy to Tanso SDK
public/index.html  Single-page UI with tabs for each SDK feature
public/app.js      Vanilla JS — calls the Express API routes
.env               TANSO_API_KEY (copy from .env.example)
```

## Running

```bash
cp .env.example .env   # add your Tanso API key
npm install
npm start              # http://localhost:3000
```

## SDK Features Demonstrated

| Tab              | SDK Method(s)                                                  | What It Shows                                    |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| Plans            | `tanso.plans.list()`                                           | Fetching plan catalog with features and pricing  |
| Onboard Customer | `tanso.customers.create()`                                     | Creating a new customer                          |
| Subscribe        | `tanso.subscriptions.create()`                                 | Subscribing a customer to a plan                 |
| Entitlements     | `tanso.entitlements.list()`, `tanso.entitlements.check()`      | Checking feature access (boolean, limit, credit) |
| Usage Events     | `tanso.events.ingest()`                                        | Sending metered usage events with idempotency    |
| Credits          | `tanso.credits.listPools()`                                    | Viewing credit pool balances                     |

## Key Patterns

- **Server-side SDK only**: The API key never reaches the browser. The Express server acts as a thin pass-through.
- **Entitlement check before action**: Call `entitlements.check()` to gate features in real-time.
- **Idempotent events**: Every usage event gets a unique `eventIdempotencyKey` to prevent double-counting.
- **Plan feature rules**: Plans include features with pricing rules (flat, usage-based, graduated tiers, credit-based).

## Adapting This Example

1. Replace the vanilla frontend with your framework of choice (React, Vue, etc.)
2. Add authentication middleware to protect the API routes
3. Map your own `customerReferenceId` to your user system
4. Call `entitlements.check()` in your feature gates / middleware
5. Call `events.ingest()` whenever a metered action occurs
