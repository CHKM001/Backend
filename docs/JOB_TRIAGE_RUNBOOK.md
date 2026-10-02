# Background Job & DLQ Triage Runbook

## Overview

This runbook documents operator triage procedures for handling background job failures, repeated retries, and Dead Letter Queue (DLQ) volume buildup in the NeuroWealth Backend.

---

## 1. Operational Dashboard & Telemetry

Operators can inspect background job health and queue backlogs in real time via:

- **Admin Dashboard API**: `GET /api/admin/jobs/dashboard` (Header: `Authorization: Bearer <ADMIN_KEY>`)
- **Prometheus Telemetry Endpoint**: `GET /metrics`
  - `job_success_total{job_name}`: Cumulative successful job executions
  - `job_failure_total{job_name}`: Cumulative unhandled job failures
  - `job_retry_total{job_name}`: Total automatic retry attempts
  - `job_completion_status{job_name}`: 1 = healthy, 0 = exhausted retries
  - `dlq_size`: Current queued dead-letter items
  - `dlq_alert_active`: 1 = alert threshold exceeded (> 50 items)

---

## 2. Job Failure & Retry Triage Workflow

### Step 1: Identify Failing Jobs

Query `/api/admin/jobs/dashboard` or filter logs by `[JobScheduler]`.

If `job_completion_status == 0` for any job:
1. Note the specific `job_name` (e.g., `retention_all_jobs`, `recurring_deposits`, `protocol_risk_scoring`).
2. Inspect application error logs:
   ```bash
   grep "[JobScheduler] <job_name> exhausted retries" /var/log/neurowealth/app.log
   ```

### Step 2: Diagnostic Matrix

| Failure Mode | Root Cause | Operator Triage Steps |
|---|---|---|
| Database Connection Timeout | DB pool exhaustion or lock contention | 1. Inspect DB connection pool metrics.<br>2. Check for long-running transactions.<br>3. Verify database instance health. |
| Third-Party API Failure | Rate limiting or downstream outage | 1. Check external provider status.<br>2. Verify API key validity and quota.<br>3. Rely on resilient scheduler automatic backoff. |
| Data Corruption / Schema Drift | Invalid data model or unexpected payload | 1. Inspect failed payload in logs.<br>2. Run `npm run env:parity` or contract drift checks.<br>3. Apply patch or data fix script. |

### Step 3: Manual Execution & Recovery

Once the root cause is resolved, force an immediate retry run of the job or wait for the next scheduled tick. Scheduled jobs automatically resume on the next tick or process restart.

---

## 3. Dead Letter Queue (DLQ) Triage Workflow

### Step 1: DLQ Alert Triggered (`dlq_size > 50`)

When a DLQ alert is emitted:
1. Inspect DLQ status breakdown via `/api/admin/jobs/dashboard`.
2. Inspect queued events:
   ```bash
   # Read DLQ status breakdown and pending count
   curl -H "Authorization: Bearer $ADMIN_TOKEN" https://api.neurowealth.io/api/admin/jobs/dashboard
   ```

### Step 2: DLQ Replay Procedure

To safely replay failed events from the DLQ:

1. **Dry-Run Mode** (Inspect impact before replaying):
   ```bash
   curl -X POST https://api.neurowealth.io/api/admin/dlq/replay \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"dryRun": true, "limit": 100}'
   ```

2. **Execute Selective Replay**:
   ```bash
   curl -X POST https://api.neurowealth.io/api/admin/dlq/replay \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"dryRun": false, "limit": 100}'
   ```

3. **Verify DLQ Normalization**:
   Confirm `dlq_size` drops back below threshold and `dlq_alert_active` resets to `0`.
