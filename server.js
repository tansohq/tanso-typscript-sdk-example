/**
 * Tanso SDK Example — Express Backend
 *
 * This server acts as a thin proxy between the browser and the Tanso API.
 * The @tansohq/sdk is used SERVER-SIDE ONLY so the API key is never exposed
 * to the client. Each Express route maps 1:1 to a single SDK method call.
 *
 * ARCHITECTURE:
 *   Browser (public/app.js)  -->  Express (this file)  -->  Tanso API (@tansohq/sdk)
 *
 * TYPICAL INTEGRATION FLOW:
 *   1. List plans          → show your pricing page
 *   2. Create customer     → when a user signs up in your app
 *   3. Create subscription → when the user picks a plan
 *   4. Check entitlements  → gate features based on their plan
 *   5. Ingest events       → track metered usage (API calls, tokens, etc.)
 *   6. Check credits       → show remaining credit balance
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const { TansoClient } = require("@tansohq/sdk");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/**
 * Initialize the Tanso SDK client.
 *
 * The SDK auto-detects the environment from the API key prefix:
 *   - "sk_test_..." → uses sandbox API (sandbox.api.tansoflow.com)
 *   - "sk_live_..." → uses production API (api.tansoflow.com)
 *
 * You can also override the base URL:
 *   new TansoClient(key, { baseUrl: "https://custom.api.example.com" })
 */
const tanso = new TansoClient(process.env.TANSO_API_KEY);

// ── Plans ────────────────────────────────────────────────────────────
//
// Plans define your product tiers (e.g. Free, Pro, Enterprise).
// Each plan has a base price, billing interval, and a set of linked features.
// Features on a plan can have different pricing rules:
//   - Included (boolean): feature is simply on/off
//   - Usage-based: priced per unit with an optional cap (maxUsage)
//   - Graduated: tiered pricing that changes at volume thresholds
//   - Credit-based: consumes from a credit pool allocated by the plan
//
// The response shape from tanso.plans.list() is:
//   { items: [{ plan: PlanDetail, features: PlanFeature[], creditAllocations: CreditAllocation[] }], pagination }

app.get("/api/plans", async (_req, res, next) => {
  try {
    const plans = await tanso.plans.list();
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

// ── Features ─────────────────────────────────────────────────────────
//
// Features are the individual capabilities you gate in your product
// (e.g. "api_access", "ai_generation", "export_csv").
// They exist independently of plans — you link them to plans via feature rules.
// Each feature has a unique `key` you reference when checking entitlements.
//
// Response shape: { items: Feature[], pagination }

app.get("/api/features", async (_req, res, next) => {
  try {
    const features = await tanso.features.list();
    res.json(features);
  } catch (err) {
    next(err);
  }
});

// ── Customer Onboarding ──────────────────────────────────────────────
//
// A "customer" in Tanso represents an end-user or account in YOUR system.
// The `customerReferenceId` is YOUR unique identifier for them (e.g. your
// database user ID, auth provider ID, etc.). This is the key you'll use
// for all subsequent SDK calls (subscriptions, entitlements, events).
//
// Required fields: customerReferenceId, email
// Optional fields: firstName, lastName, phoneNumber, address
//
// Response shape: Customer object with the fields you passed in, plus
//   createdAt, modifiedAt timestamps.

app.post("/api/customers", async (req, res, next) => {
  try {
    const customer = await tanso.customers.create(req.body);
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// Get a customer by their reference ID (the ID from your system).
// Returns the customer object including their active subscriptions
// and credit pools.

app.get("/api/customers/:id", async (req, res, next) => {
  try {
    const customer = await tanso.customers.get(req.params.id);
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

// ── Subscriptions ────────────────────────────────────────────────────
//
// A subscription links a customer to a plan. Once subscribed, the customer
// gains entitlements to all features on that plan.
//
// Required fields: customerReferenceId, planId
// Optional: gracePeriod (days of access after failed payment, default 3)
//
// Billing behavior depends on the plan's billingTiming:
//   - IN_ADVANCE: invoice generated immediately, subscription starts as "draft"
//                 until payment confirmed, then becomes active.
//   - IN_ARREARS: subscription activates immediately, invoiced at period end.
//   - Free plans (priceAmount=0): activate immediately, no invoice.
//
// Response shape: { subscription: SubscriptionDetail, invoice: Invoice }

app.post("/api/subscriptions", async (req, res, next) => {
  try {
    const result = await tanso.subscriptions.create(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Cancel a subscription.
//
// cancelMode options:
//   - "END_OF_PERIOD": access continues until current billing period ends (default, recommended)
//   - "IMMEDIATE": access revoked right away
//
// End-of-period cancellations can be reverted with subscriptions.revertCancellation()
// before the period ends.

app.post("/api/subscriptions/:id/cancel", async (req, res, next) => {
  try {
    await tanso.subscriptions.cancel(req.params.id, req.body.cancelMode);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Change a subscription's plan (upgrade or downgrade).
//
// Required fields in body:
//   - changeToPlanId: the plan ID to switch to
//   - changeType: "UPGRADE" or "DOWNGRADE"
//
// Behavior:
//   - UPGRADE: takes effect immediately with prorated billing
//   - DOWNGRADE: scheduled for the end of the current billing period

app.post("/api/subscriptions/:id/change-plan", async (req, res, next) => {
  try {
    await tanso.subscriptions.changePlan(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Entitlements ─────────────────────────────────────────────────────
//
// Entitlements answer the question: "Can this customer use this feature?"
// This is the core of feature gating. Use this in your app before allowing
// access to any paid or limited feature.
//
// There are three ways to check entitlements:
//
// 1. list()  — Get ALL entitlements for a customer across all subscriptions.
//    Returns: { items: [{ subscriptionId, entitlements: [{ featureKey, allowed }] }] }
//    Use case: Rendering a dashboard showing what the user has access to.
//
// 2. check() — Check a SINGLE feature for a customer.
//    Returns: { allowed, featureKey, usage?, credit?, meta? }
//    Use case: Gate a specific action ("can this user export CSV?")
//    The `usage` field (if present) shows: { used, limit, remaining }
//    The `credit` field (if present) shows: { balance, totalGranted, totalConsumed, hardLimit }
//
// 3. evaluate() — Like check() but can also SIMULATE usage before committing.
//    Accepts a `usage` param: { usageUnits, eventName }
//    Returns additional `simulation` field: { requestedUsage, projectedUsage, wouldExceedLimit }
//    Use case: "If the user sends 500 more tokens, would they exceed their limit?"

// List all entitlements for a customer (across all their subscriptions)
app.get("/api/entitlements/:customerId", async (req, res, next) => {
  try {
    const entitlements = await tanso.entitlements.list(req.params.customerId);
    res.json(entitlements);
  } catch (err) {
    next(err);
  }
});

// Check a single feature entitlement for a customer.
// This is the most common entitlement call — use it to gate features.
//
// Example response when feature has a usage limit:
//   {
//     "allowed": true,
//     "featureKey": "api_calls",
//     "usage": { "used": 450, "limit": 1000, "remaining": 550 }
//   }
//
// Example response for a boolean (included) feature:
//   { "allowed": true, "featureKey": "export_csv" }
//
// Example response for a credit-gated feature:
//   {
//     "allowed": true,
//     "featureKey": "ai_generation",
//     "credit": { "balance": 5000, "totalGranted": 10000, "totalConsumed": 5000, "hardLimit": true }
//   }

app.get("/api/entitlements/:customerId/:featureKey", async (req, res, next) => {
  try {
    const result = await tanso.entitlements.check(
      req.params.customerId,
      req.params.featureKey
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Evaluate an entitlement with optional usage simulation.
// Use this to check "would this usage be allowed?" BEFORE actually recording it.
//
// Example request body:
//   {
//     "customerReferenceId": "user_123",
//     "featureKey": "ai_tokens",
//     "usage": { "usageUnits": 500, "eventName": "token_consumption" }
//   }
//
// The response includes a `simulation` field:
//   {
//     "allowed": true,
//     "simulation": {
//       "requestedUsage": 500,
//       "projectedUsage": 950,
//       "projectedRemaining": 50,
//       "wouldExceedLimit": false
//     }
//   }

app.post("/api/entitlements/evaluate", async (req, res, next) => {
  try {
    const result = await tanso.entitlements.evaluate(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Usage Events ─────────────────────────────────────────────────────
//
// Usage events record metered consumption. Send these whenever a customer
// performs a billable action (API call, AI token used, file processed, etc.).
//
// Required fields:
//   - customerReferenceId: identifies the customer
//   - eventName: a label for the event type (e.g. "api_call", "token_used")
//   - eventIdempotencyKey: a unique key to prevent double-counting on retries
//
// Optional fields:
//   - usageUnits: quantity consumed (default 1)
//   - featureKey: links the event to a specific feature for billing/limits
//   - occurredAt: ISO-8601 timestamp (defaults to now)
//   - costAmount/costInput: track your COGS per event
//   - flowId: correlate multiple events in a single user action
//   - meta: arbitrary JSON metadata
//
// IMPORTANT: Always provide a unique eventIdempotencyKey. If your app retries
// a failed request with the same key, Tanso will deduplicate it automatically.
//
// Response shape: { usageLimitExceeded?: boolean, message?: string }
// If usageLimitExceeded is true, the event was recorded but the customer
// has now exceeded their usage limit for this feature.

app.post("/api/events", async (req, res, next) => {
  try {
    const result = await tanso.events.ingest(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Credits ──────────────────────────────────────────────────────────
//
// Credits are a flexible currency system. Plans can allocate credits to
// customers (e.g. "10,000 AI tokens per month"). Credits are consumed
// when usage events are recorded against credit-gated features.
//
// Credit pools track:
//   - balance: currently available credits
//   - totalGranted: lifetime credits received
//   - totalConsumed: lifetime credits spent
//   - totalExpired: credits that expired unused
//   - hardLimit: if true, access is denied when balance reaches 0
//   - denomination: the credit type (e.g. "AI_TOKENS", "MESSAGES")
//
// Credits can come from multiple sources (grant types):
//   - PLAN_INCLUDED: auto-granted each billing cycle (clawed back on cancel)
//   - PURCHASED: bought by the customer (kept on cancel)
//   - PROMOTIONAL: given for free (kept on cancel)
//   - ROLLOVER: carried over from a previous period

app.get("/api/credits/:customerId", async (req, res, next) => {
  try {
    const pools = await tanso.credits.listPools(req.params.customerId);
    res.json(pools);
  } catch (err) {
    next(err);
  }
});

// ── Billing ──────────────────────────────────────────────────────────
//
// Invoices are automatically generated by Tanso when subscriptions are
// created (IN_ADVANCE) or at the end of billing periods (IN_ARREARS).
// Usage-based charges are itemized on the invoice.
//
// Each invoice has: id, amount, currency, dueDate, status, items[]
// Invoice items break down charges (base plan price + usage charges).
//
// Additional billing methods available on the SDK:
//   - tanso.billing.markPaid(invoiceId) — mark an invoice as paid manually
//   - tanso.billing.createCheckoutSession(invoiceId) — get a Stripe checkout URL

app.get("/api/billing/:customerId/invoices", async (req, res, next) => {
  try {
    const invoices = await tanso.billing.listInvoices(req.params.customerId);
    res.json(invoices);
  } catch (err) {
    next(err);
  }
});

// ── Error Handler ────────────────────────────────────────────────────
//
// The Tanso SDK throws typed errors that include HTTP status codes:
//   - TansoAuthenticationError (401): invalid or expired API key
//   - TansoNotFoundError (404): customer/plan/feature not found
//   - TansoConflictError (409): duplicate customerReferenceId, etc.
//   - TansoApiError (other 4xx/5xx): general API error
//   - TansoNetworkError: connection or timeout failure
//
// Each error has: message, statusCode, and optional detail string.
// This handler forwards them as JSON so the frontend can display them.

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  res.status(status).json({ error: err.message, detail: err.detail });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
