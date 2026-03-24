/**
 * Tanso SDK Example — Frontend (Vanilla JS)
 *
 * This file handles all browser-side logic. It calls the Express backend
 * (server.js), which in turn calls the Tanso SDK. The SDK is never used
 * directly in the browser — API keys must stay server-side.
 *
 * The UI has 6 tabs, each demonstrating a different part of the SDK:
 *   1. Plans         → tanso.plans.list()
 *   2. Onboard       → tanso.customers.create()
 *   3. Subscribe     → tanso.subscriptions.create()
 *   4. Entitlements  → tanso.entitlements.list() / .check()
 *   5. Usage Events  → tanso.events.ingest()
 *   6. Credits       → tanso.credits.listPools()
 */

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Generic fetch wrapper for calling our Express API routes.
 * All SDK calls go through server.js — this just handles the
 * browser-to-server hop with JSON serialization and error handling.
 */
async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/**
 * Display a JSON response in a <div class="result"> element.
 * Used to show raw SDK responses so users can see the exact data shape.
 */
function show(el, data) {
  el.hidden = false;
  el.textContent = JSON.stringify(data, null, 2);
}

// ── Tab Navigation ───────────────────────────────────────────────────
// Simple tab switcher: each nav button has a data-tab attribute matching
// a <section> id. Clicking a tab shows that section and hides the rest.

document.querySelectorAll("#nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#nav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("main > section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ── Plans Tab ────────────────────────────────────────────────────────
//
// Demonstrates: tanso.plans.list()
//
// Plans are the core of your pricing model. Each plan returned includes:
//   - plan: { id, key, name, description, priceAmount, currency, intervalMonths, billingTiming }
//   - features: array of features linked to this plan, each with pricing rules
//   - creditAllocations: credits granted per billing period (if any)
//
// Feature pricing models shown in the "Rule" column:
//   - "Included" → boolean feature, no metering (e.g. "dashboard_access")
//   - "Usage: 0.01/api_call" → usage-based pricing per unit
//   - "Usage: 0.01/api_call (limit: 1000)" → usage-based with a hard cap
//   - "Graduated tiers (3 tiers)" → volume pricing with breakpoints

let plansCache = [];

async function loadPlans() {
  try {
    // GET /api/plans → server calls tanso.plans.list()
    // Response: { items: Plan[], pagination: { total, limit, offset, hasMore } }
    const data = await api("GET", "/api/plans");
    plansCache = data.items || [];
    renderPlans(plansCache);
    populatePlanSelect(plansCache); // Also populate the <select> on the Subscribe tab
  } catch (err) {
    document.getElementById("plans-list").innerHTML =
      `<p style="color:red">${err.message}</p>`;
  }
}

/**
 * Render plan cards showing name, price, billing timing, features, and credits.
 *
 * Each plan item has the shape:
 *   {
 *     plan: { id, key, name, description, priceAmount, currency, intervalMonths, billingTiming },
 *     features: [{ id, name, key, pricingType, pricing?: { model, pricePerUnit, maxUsage, tiers } }],
 *     creditAllocations: [{ creditModelName, creditAmount, denomination }]
 *   }
 */
function renderPlans(plans) {
  const container = document.getElementById("plans-list");
  if (!plans.length) {
    container.innerHTML = "<p>No plans found. Create plans in the Tanso dashboard first.</p>";
    return;
  }
  container.innerHTML = plans
    .map((p) => {
      const plan = p.plan;
      const features = p.features || [];
      const credits = p.creditAllocations || [];

      // Format billing interval for display (1 → "mo", 12 → "12mo")
      const interval = plan.intervalMonths === 1 ? "mo" : `${plan.intervalMonths}mo`;

      // Build feature rows — show the pricing rule type for each feature
      const featRows = features
        .map((f) => {
          const pricing = f.pricing;
          let ruleDesc = "Included"; // Default: boolean feature, no pricing attached

          if (pricing) {
            if (pricing.model === "usage") {
              // Usage-based: price per unit, optional hard cap
              // e.g. "$0.01 per api_call, max 10,000/month"
              ruleDesc = `Usage: ${pricing.pricePerUnit}/${pricing.unitLabel || "unit"}`;
              if (pricing.maxUsage) ruleDesc += ` (limit: ${pricing.maxUsage})`;
            } else if (pricing.model === "graduated") {
              // Graduated/tiered pricing: different price at different volume thresholds
              // e.g. first 1000 at $0.10, next 4000 at $0.08, then $0.05
              ruleDesc = `Graduated tiers (${(pricing.tiers || []).length} tiers)`;
            }
          }
          return `<tr><td>${f.name}</td><td><code>${f.key}</code></td><td>${ruleDesc}</td></tr>`;
        })
        .join("");

      // Build credit allocation rows — credits granted per billing period
      const creditRows = credits
        .map(
          (c) =>
            `<tr><td colspan="2">${c.creditModelName}</td><td>${c.creditAmount} ${c.denomination || ""}</td></tr>`
        )
        .join("");

      return `
        <div class="card">
          <h3>${plan.name}</h3>
          <p>${plan.description || ""}</p>
          <p><span class="price">${plan.currency} ${plan.priceAmount}</span> <span class="interval">/ ${interval}</span></p>
          <p style="margin-top:4px">
            <!-- billingTiming: IN_ADVANCE means pay first then access; IN_ARREARS means use then pay -->
            <span class="badge badge-blue">${plan.billingTiming || "IN_ADVANCE"}</span>
            <code style="font-size:11px;color:#888">ID: ${plan.id}</code>
          </p>
          ${
            features.length
              ? `<table class="feat-table"><tr><th>Feature</th><th>Key</th><th>Rule</th></tr>${featRows}</table>`
              : ""
          }
          ${
            credits.length
              ? `<table class="feat-table"><tr><th colspan="2">Credit Model</th><th>Amount</th></tr>${creditRows}</table>`
              : ""
          }
        </div>`;
    })
    .join("");
}

/**
 * Populate the plan <select> dropdown on the Subscribe tab
 * so users can pick which plan to subscribe a customer to.
 */
function populatePlanSelect(plans) {
  const sel = document.getElementById("plan-select");
  sel.innerHTML = plans
    .map(
      (p) =>
        `<option value="${p.plan.id}">${p.plan.name} — ${p.plan.currency} ${p.plan.priceAmount}</option>`
    )
    .join("");
}

// Fetch plans on page load — this populates both the Plans tab and the Subscribe dropdown
loadPlans();

// ── Onboard Customer Tab ─────────────────────────────────────────────
//
// Demonstrates: tanso.customers.create()
//
// This is typically the first SDK call in your integration. When a user
// signs up in your app, create a corresponding Tanso customer.
//
// The `customerReferenceId` is YOUR identifier for the user — it could be
// a database ID, auth provider ID, or any unique string. You'll use this
// same ID for all future SDK calls (subscribe, check entitlements, etc.).
//
// Request body shape:
//   {
//     customerReferenceId: "user_123",  // required — your unique user ID
//     email: "jane@example.com",        // required
//     firstName: "Jane",                // optional
//     lastName: "Doe"                   // optional
//   }
//
// Response: the created Customer object

document.getElementById("onboard-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  try {
    // POST /api/customers → server calls tanso.customers.create(body)
    const data = await api("POST", "/api/customers", body);
    show(document.getElementById("onboard-result"), data);
  } catch (err) {
    // Common error: 409 Conflict if customerReferenceId already exists
    show(document.getElementById("onboard-result"), { error: err.message });
  }
});

// ── Subscribe Tab ────────────────────────────────────────────────────
//
// Demonstrates: tanso.subscriptions.create()
//
// After creating a customer, subscribe them to a plan. This grants them
// entitlements to all features on that plan and (if applicable) allocates
// credits to their account.
//
// Request body shape:
//   {
//     customerReferenceId: "user_123",  // must match a created customer
//     planId: "plan_abc123"             // ID of the plan to subscribe to
//   }
//
// Response shape:
//   {
//     subscription: {
//       id, isActive, currentPeriodStart, currentPeriodEnd,
//       intervalMonths, billingAnchorDay, ...
//     },
//     invoice: { id, amount, currency, status, dueDate, items[] }
//   }
//
// The invoice is generated immediately for IN_ADVANCE plans.
// For free plans or IN_ARREARS, there may be no invoice.

document.getElementById("subscribe-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  try {
    // POST /api/subscriptions → server calls tanso.subscriptions.create(body)
    const data = await api("POST", "/api/subscriptions", body);
    show(document.getElementById("subscribe-result"), data);
  } catch (err) {
    // Common errors: 404 if customer/plan not found, 409 if already subscribed
    show(document.getElementById("subscribe-result"), { error: err.message });
  }
});

// ── Entitlements Tab ─────────────────────────────────────────────────
//
// Demonstrates: tanso.entitlements.list() and tanso.entitlements.check()
//
// Entitlements are the core of feature gating. They answer:
// "Does this customer have access to this feature?"
//
// The answer depends on:
//   - Does the customer have an active subscription?
//   - Is the feature included in their plan?
//   - Have they exceeded their usage limit (if the feature has one)?
//   - Have they run out of credits (if the feature is credit-gated with hardLimit)?
//
// Two modes shown here:
//
// A) Load All — calls entitlements.list(customerId)
//    Returns entitlements grouped by subscription:
//    { items: [{ subscriptionId, entitlements: [{ featureKey, allowed }] }] }
//    Good for: rendering a "what can I do?" dashboard.
//
// B) Check Single — calls entitlements.check(customerId, featureKey)
//    Returns detailed info for one feature:
//    { allowed, featureKey, usage?: { used, limit, remaining }, credit?: { balance, ... } }
//    Good for: gating a specific action in real-time.

/**
 * Load ALL entitlements for a customer across all their subscriptions.
 * Shows a card per subscription with allowed/denied badges per feature.
 */
async function loadEntitlements() {
  const customerId = document.getElementById("ent-customer").value;
  if (!customerId) return alert("Enter a customer ID");
  const container = document.getElementById("ent-list");
  try {
    // GET /api/entitlements/:customerId → server calls tanso.entitlements.list(customerId)
    const data = await api("GET", `/api/entitlements/${customerId}`);
    const subs = data.items || [];
    if (!subs.length) {
      container.innerHTML = "<p>No entitlements found.</p>";
      return;
    }
    // Render each subscription's entitlements as a card with feature badges
    container.innerHTML = subs
      .map(
        (s) => `
        <div class="card">
          <h3>Subscription ${s.subscriptionId}</h3>
          ${(s.entitlements || [])
            .map(
              (ent) => `
            <p>
              <code>${ent.featureKey}</code>
              <!-- Green badge = allowed, Red badge = denied (over limit, no credits, etc.) -->
              <span class="badge ${ent.allowed ? "badge-green" : "badge-red"}">
                ${ent.allowed ? "ALLOWED" : "DENIED"}
              </span>
            </p>`
            )
            .join("")}
        </div>`
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<p style="color:red">${err.message}</p>`;
  }
}

/**
 * Check a SINGLE feature entitlement for a customer.
 * This is the most common pattern — call this before allowing access
 * to any gated feature in your app.
 *
 * The raw JSON response is displayed so you can see all the fields:
 *   - allowed: boolean — the gate decision
 *   - featureKey: the feature checked
 *   - usage: { used, limit, remaining } — present if feature has a usage limit
 *   - credit: { balance, totalGranted, totalConsumed, hardLimit } — present if credit-gated
 *   - meta: { reason: { description } } — human-readable explanation of the decision
 */
async function checkEntitlement() {
  const customerId = document.getElementById("ent-check-customer").value;
  const featureKey = document.getElementById("ent-check-feature").value;
  if (!customerId || !featureKey) return alert("Fill in both fields");
  const el = document.getElementById("ent-check-result");
  try {
    // GET /api/entitlements/:customerId/:featureKey → server calls tanso.entitlements.check()
    const data = await api("GET", `/api/entitlements/${customerId}/${featureKey}`);
    show(el, data);
  } catch (err) {
    show(el, { error: err.message });
  }
}

// ── Usage Events Tab ─────────────────────────────────────────────────
//
// Demonstrates: tanso.events.ingest()
//
// Usage events record metered consumption. Send one every time a customer
// performs a billable or trackable action in your app. Examples:
//   - API call made → eventName: "api_call", usageUnits: 1
//   - AI tokens consumed → eventName: "token_usage", usageUnits: 1500
//   - File processed → eventName: "file_process", usageUnits: 1
//
// KEY CONCEPTS:
//
// eventIdempotencyKey: A unique string per event. If you retry a failed
//   request with the same key, Tanso deduplicates it (no double billing).
//   In this demo we auto-generate one from timestamp + random string.
//   In production, derive it from your domain (e.g. "req_abc123" for a request ID).
//
// featureKey (optional): Links the event to a specific feature. This is
//   how Tanso tracks usage against limits. If a feature has maxUsage: 1000
//   and you've sent 1000 events, the next entitlement check returns allowed: false.
//
// usageUnits: How much was consumed. Defaults to 1 if not provided.
//
// Response: { usageLimitExceeded?: boolean, message?: string }
//   If usageLimitExceeded is true, the customer has now exceeded the
//   feature's usage limit. You should check entitlements before the next action.

document.getElementById("usage-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);

  // Convert usageUnits from string (form input) to number
  body.usageUnits = Number(body.usageUnits);

  // Auto-generate an idempotency key for this demo.
  // In production, use a deterministic key from your domain (request ID, etc.)
  // so retries don't create duplicate events.
  body.eventIdempotencyKey = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Remove empty optional fields so the SDK doesn't send them
  if (!body.featureKey) delete body.featureKey;

  try {
    // POST /api/events → server calls tanso.events.ingest(body)
    const data = await api("POST", "/api/events", body);
    show(document.getElementById("usage-result"), data);
  } catch (err) {
    show(document.getElementById("usage-result"), { error: err.message });
  }
});

// ── Credits Tab ──────────────────────────────────────────────────────
//
// Demonstrates: tanso.credits.listPools()
//
// Credit pools are created automatically when a customer subscribes to a
// plan that includes credit allocations. Each pool has:
//
//   - denomination: the type of credit (e.g. "AI_TOKENS", "MESSAGES")
//   - balance: credits currently available
//   - totalGranted: lifetime credits received (from plan, purchases, promos)
//   - totalConsumed: lifetime credits spent via usage events
//   - totalExpired: credits that expired without being used
//   - hardLimit: if true, feature access is denied when balance hits 0
//   - status: "ACTIVE" or "INACTIVE"
//
// Credits are consumed when usage events are recorded against credit-gated features.
// The SDK also provides:
//   - tanso.credits.getPool(customerId, poolId) — single pool details
//   - tanso.credits.listTransactions(customerId, poolId) — consumption/grant history
//   - tanso.credits.listGrants(customerId, poolId) — individual credit grants

async function loadCredits() {
  const customerId = document.getElementById("credit-customer").value;
  if (!customerId) return alert("Enter a customer ID");
  const container = document.getElementById("credit-list");
  try {
    // GET /api/credits/:customerId → server calls tanso.credits.listPools(customerId)
    const data = await api("GET", `/api/credits/${customerId}`);
    const pools = data.items || [];
    if (!pools.length) {
      container.innerHTML = "<p>No credit pools found.</p>";
      return;
    }
    // Render each credit pool as a card showing balance and metadata
    container.innerHTML = pools
      .map(
        (pool) => `
        <div class="card">
          <h3>${pool.name || pool.denomination}</h3>
          <p>Denomination: <strong>${pool.denomination}</strong></p>
          <p>Balance: <strong>${pool.balance}</strong> / Granted: ${pool.totalGranted} / Consumed: ${pool.totalConsumed}</p>
          <p>Hard limit: ${pool.hardLimit ? "Yes" : "No"} &middot; Status: ${pool.status}</p>
        </div>`
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<p style="color:red">${err.message}</p>`;
  }
}
