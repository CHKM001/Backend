# Idempotency-Key Contract (#375, #483)

Client-supplied idempotency keys protect high-risk and mutating REST API endpoints from duplicate side effects caused by network timeouts, automatic client retries, UI double-submissions, or mobile reconnection.

## Header Specification

Clients initiate mutating actions with an opaque `Idempotency-Key` header:

```http
Idempotency-Key: <client-generated UUIDv4 or opaque token, <= 255 ASCII characters>
```

### Constraints & Validation
- **Length:** Must not exceed 255 characters. Exceeding this limit returns `400 Bad Request` with `{ "error": "idempotency_key_too_long" }`.
- **Character Set:** Printable ASCII strings without leading/trailing whitespace.
- **Scope:** Idempotency records are scoped to `(userId, idempotencyKey)`. Different authenticated users may independently use identical keys without collision.

---

## State Machine & Response Behavior

| Case | HTTP Status | Response Header | Body / Error Code | Description |
|------|-------------|-----------------|-------------------|-------------|
| **First Request (Cache Miss)** | `2xx` / `4xx` / `5xx` | None | Original handler response | Request is processed normally; result status and serialized body are persisted to Redis and `IdempotencyRecord` table. |
| **Duplicate Submission (Replay)** | Original status code (e.g. `200`, `201`) | `Idempotency-Replayed: true` | Original response body | The request matches the exact key and payload fingerprint. The cached response is returned immediately without executing the downstream business logic or on-chain transaction. |
| **Payload Mismatch (Key Reuse)** | `422 Unprocessable Entity` | None | `{ "error": "idempotency_key_reuse" }` | The same `Idempotency-Key` was re-submitted with a different payload body, method, or path. Reusing keys across different operations is forbidden. |
| **Concurrent Request In-Flight** | `409 Conflict` | None | `{ "error": "idempotency_request_in_flight" }` | An earlier request with the identical key is currently executing. Clients should back off with exponential jitter before retrying. |
| **Missing Header on Required Route** | `400 Bad Request` | None | `{ "error": "idempotency_key_required" }` | Financial money routes require `Idempotency-Key`. The request is rejected before any fund movement. |
| **Store Outage (Fail Closed)** | `503 Service Unavailable` | None | `{ "error": "Idempotency store unavailable" }` | Returned on critical financial routes when both Redis and Postgres database stores are inaccessible. |

---

## Fingerprint Algorithm

To detect key reuse with modified parameters, the middleware computes a SHA-256 fingerprint:

$$\text{fingerprint} = \text{SHA256}(\text{method} \parallel \text{path} \parallel \text{userId} \parallel \text{canonicalJSON}(\text{body}))$$

- **Canonical JSON:** Object keys are sorted lexicographically at all nested depths. Arrays preserve their operational order.
- **Empty / Null Bodies:** Normalized to an empty string.

---

## Protected Endpoints & Route Policy

| Route | Method | Idempotency Key | Fail Mode | Default TTL | Category |
|-------|--------|-----------------|-----------|-------------|----------|
| `/api/deposit` | `POST` | **Required** | Fail closed (`503`) | 24 hours | Financial (Deposit) |
| `/api/withdraw` | `POST` | **Required** | Fail closed (`503`) | 24 hours | Financial (Withdrawal) |
| `/api/fiat/orders` | `POST` | **Required** | Fail closed (`503`) | 24 hours | Financial (Fiat on/off-ramp) |
| `/api/deposit/recurring` | `POST` | **Required** | Fail closed (`503`) | 24 hours | Financial (Recurring plan) |
| `/api/approvals/:id/approve` | `POST` | Optional (Supported) | Fail open | 24 hours | Operational (Multi-sig/governance) |
| `/api/approvals/:id/reject` | `POST` | Optional (Supported) | Fail open | 24 hours | Operational (Multi-sig/governance) |
| `/api/approvals/:id/cancel` | `POST` | Optional (Supported) | Fail open | 24 hours | Operational (Multi-sig/governance) |
| `/api/portfolio/goals` | `POST` | Optional (Supported) | Fail open | 24 hours | Operational (Savings goal creation) |

---

## Two-Tier Storage Architecture

1. **Fast Tier (Redis):**
   - Key format: `idem:<userId>:<idempotencyKey>`
   - Distributed lock via `SET ... PX 30000 NX` guarantees atomic single-execution under concurrent race conditions.
   - Completed responses cached with TTL (default 86,400s / 24h).
2. **Durable Tier (PostgreSQL `IdempotencyRecord`):**
   - Backing table defined in `prisma/schema.prisma` with `@@unique([userId, idempotencyKey])`.
   - Survives Redis eviction, flush, or restart for all financial transactions.
   - Automatic expiration index on `expiresAt`.

---

## Relationship to Outbox & Ledger Idempotency

The HTTP `Idempotency-Key` serves as the **outer perimeter** defense at the client boundary:
1. **Perimeter (HTTP Idempotency):** Catches duplicate client requests before running business logic, controllers, or database locks. Replays return the original response with `Idempotency-Replayed: true`.
2. **Outbox Core (`OutboxOp`):** Generates deterministic `idempotencyKey = "<kind>:<userId>:<businessRecordId>"` ensuring asynchronous queue workers never submit duplicate transactions to Stellar/Soroban.
3. **Ledger Boundary (`ProcessedEvent`):** Stellar transaction hashes and event sequences are recorded in the database to prevent duplicate ingestion of on-chain events.

---

## Client Integration Guide & Best Practices

```typescript
import { v4 as uuidv4 } from 'uuid';

async function executeDeposit(amount: number, asset: string) {
  const idempotencyKey = uuidv4();

  const response = await fetch('/api/deposit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ amount, assetSymbol: asset }),
  });

  if (response.status === 409) {
    // Request is in-flight: wait and retry with the SAME key
    await sleep(2000);
    return retryWithSameKey(idempotencyKey);
  }

  const isReplay = response.headers.get('Idempotency-Replayed') === 'true';
  const data = await response.json();
  return { data, isReplay };
}
```
