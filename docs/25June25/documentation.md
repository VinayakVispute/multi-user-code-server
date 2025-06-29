## Internal Code-Server Platform – Technical Documentation

---

### 0 · Scope & Audience

This document captures the **current state** of your single-router / Auto Scaling Group design for per-user VS Code-in-the-browser workspaces, plus the **open engineering tasks** you called out. It is meant for developers and ops engineers who will extend or maintain the system.

---

### 1 · High-Level Architecture

```
┌──────────────┐  HTTPS  ┌───────────────────────────┐  HTTP:3000/8080  ┌──────────────┐
│   Browser    ├────────►│  Router (Express EC2)    ├──────────────────►│  ASG EC2 box │
└──────────────┘         │  - /login  /dispatch     │                  │  code-server │
                         │  - /ping  (heartbeat)    │                  └──────────────┘
                         └─────────▲───────┬────────┘
                                   │Redis  │AWS SDK
                                   ▼       ▼
                          ElastiCache   Auto Scaling Group
```

- **Router EC2** – single small instance (t4g.micro ok for PoC)
- **ASG** – LaunchTemplate = **code-AMI**; `desired = activeUsers + 1`
- **Redis** – stores `{ user → { instanceId, publicIp, lastSeen } }`
- **Nginx inside each workspace** – terminates TLS, injects heartbeat, proxies to `localhost:8080`.

---

### 2 · Compute Pool (ASG)

| Setting        | Value / Rule                                                           |
| -------------- | ---------------------------------------------------------------------- |
| **minSize**    | 0                                                                      |
| **desiredCap** | `activeUsers + 1 warmSpare`                                            |
| **maxSize**    | Safety cap (e.g. 20)                                                   |
| **AMI**        | baked with code-server + nginx; tags itself `Owner=UNASSIGNED` at boot |
| **Shutdown**   | Router stops a box after 5 min of idle (see §4)                        |

---

### 3 · Request & Lifecycle Flows

| #                      | Flow                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1 Login / dispatch** | Browser ➜ `/login` (to-be-added auth). Router looks up user in Redis.<br> • **Running** ➜ `302` to `http(s)://<publicIp>:8080`.<br> • **Stopped / None** ➜ allocate warm spare **or** `desiredCap++`, wait until “ok”, tag `Owner=username`, save Redis, redirect. |
| **2 Heartbeat**        | Every page load injects `heartbeat.js`, which `fetch(BASE_URL/ping, { method:'POST' })` once per second when the tab is visible . The router’s `/ping` endpoint logs the hit and **updates `lastSeen` in Redis** (task #1).                                        |
| **3 Idle reaper**      | A `setInterval()` loop (60 s) scans Redis. If `Date.now() - lastSeen > 300 000`, the router:<br> a. `StopInstances(instanceId)`<br> b. Tag `Owner=UNASSIGNED`<br> c. Decrements `desiredCap` (but never below 1).                                                  |
| **4 Scale up / down**  | After each assignment or cleanup the router recalculates `desired = activeUsers + 1`, clamps to **MaxSize**, and updates the ASG via AWS SDK.                                                                                                                      |

---

### 4 · Heartbeat Implementation Details

**Injected script** (`/assets/heartbeat.js`):

```ts
// snippet
fetch(`${BASE_URL}/ping`, { method: "POST", credentials: "include" });
```

- Runs **every 1 s** while the tab is visible .
- Recommend bumping to **30 s** to reduce traffic.
- Include `{ user, instanceId }` in POST body so the router can write a single Redis key per workspace.

---

### 5 · Router Responsibilities (Express)

| Concern           | Implementation pointers                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| **Static assets** | `app.use(express.static('public'))` (already present).                                                       |
| **Auth (future)** | Passport-JWT or Cognito-backed authoriser; populate `req.user`.                                              |
| **/ping**         | Parse JSON `{ user, instanceId }`, `redis.hset("workspace:"+user, { lastSeen:Date.now(), instanceId, ip })`. |
| **Idle-reaper**   | `setInterval(cleanupIdle, 60_000)`; stop & retag as in §3.                                                   |
| **Scale logic**   | `aws.autoscaling.updateAutoScalingGroup({ DesiredCapacity })`.                                               |
| **Health**        | GET `/health` returns `{status:'ok'}` – already coded.                                                       |

---

### 6 · Nginx on Workspace EC2

```nginx
sub_filter '</head>' '<head><script defer src="/assets/heartbeat.js?v=1"></script></head>';
proxy_pass http://127.0.0.1:8080;
add_header X-Debug-Injected "yes";
```

- `proxy_set_header Accept-Encoding ""` makes HTML mutable for `sub_filter`.
- TLS & cert management may stay on the instance or move to an ALB later.

---

### 7 · Security & Cost Guardrails

- **Security groups** – only router SG can reach port 8080 on workspaces.
- **IAM** – router instance role limited to `ec2:Start/StopInstances`, `autoscaling:UpdateAutoScalingGroup`, `elasticache:*` on the Redis cluster.
- **CloudWatch Alarms** – notify when `Desired ≥ 90 % MaxSize` or when `GroupDesiredCapacity - InService ≥ 1`.
- **Budget** – optional alert on daily EC2 cost.

---

### 8 · File / Data Layout

| Key                    | Redis structure                                        |
| ---------------------- | ------------------------------------------------------ |
| `workspace:<username>` | Hash → `{ instanceId, publicIp, lastSeen }`            |
| `unassignedPool`       | Set of instanceIds currently tagged `Owner=UNASSIGNED` |

---

### 9 · Status & Next Tasks

| Area                     | Status                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Heartbeat injection**  | ✔ Done – script successfully embedded via `sub_filter`.                                                  |
| **TODO 1: Store pings**  | Extend `heartbeat.js` to send `{ user, instanceId }`. Implement Redis write in `/ping`.                  |
| **TODO 2: Idle cleanup** | Finish `cleanupIdle()` in `router.ts`: read Redis, stop & retag EC2, shrink ASG.                         |
| **(Optional) Auth**      | Add JWT / Cognito layer on `/login` and protect other routes.                                            |
| **(Optional) ALB & TLS** | Introduce Application Load Balancer in front of router for HTTPS off-load and future horizontal scaling. |

---

### 10 · Reference Code Snippets

- **heartbeat.ts** – full script logic&#x20;
- **router.ts** – baseline Express server with `/ping` endpoint&#x20;

---

> **Keep this doc handy:** it reflects the minimal but production-oriented path you’re on. Once TODO 1 and TODO 2 are finished, the system will self-heal and auto-scale end-to-end; future additions (auth, ALB, persistence) can be layered in without redesign.
