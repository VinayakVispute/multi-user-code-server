Here’s a clean and compact documentation of your current Redis tables, designed for simplicity and reliability:

---

## 🗂 Redis Tables Reference – Code-Server Workspace Management

| Table Name      | Key Pattern | Type | Purpose                                  |
| --------------- | ----------- | ---- | ---------------------------------------- |
| Workspace Map   | ws:{user}   | Hash | Maps user → machine & session info       |
| Ping Tracker    | ws\:pings   | ZSet | Tracks last seen time of users           |
| Warm Spare Pool | ws\:pool    | Set  | Tracks unused machines tagged UNASSIGNED |

---

### 1. `ws:{user}` – Workspace Map (per user)

- 🧩 Type: `HASH`
- 📌 Key: `ws:alice`, `ws:bob`, etc.

| Field      | Example               | Description                       |
| ---------- | --------------------- | --------------------------------- |
| instanceId | `i-07f1abc12345def`   | EC2 instance assigned to the user |
| publicIp   | `13.234.55.10`        | Public IP of instance             |
| lastSeen   | `1729930637123`       | Last ping timestamp (ms)          |
| state      | `RUNNING` / `STOPPED` | Machine state                     |
| ts         | `1729930411222`       | Last allocation/change timestamp  |

- 🔧 Redis Commands:

  - `HGETALL ws:{user}` – fetch workspace info
  - `HMSET ws:{user} ...` – update workspace state
  - `HSET ws:{user} field value` – update single field
  - `HDEL ws:{user} field` – delete field (if needed)

---

### 2. `ws:pings` – Ping Time Tracker

- 🧩 Type: `ZSET`
- 📌 Key: `ws:pings`

| Member (ZSET) | Score (ZSET)    |
| ------------- | --------------- |
| `alice`       | `1729930410000` |
| `bob`         | `1729930401000` |

- Purpose:

  - Idle reaper checks last ping times
  - Triggers stop if `lastSeen < now - 300_000`

- 🔧 Redis Commands:

  - `ZADD ws:pings now user` – on every ping
  - `ZRANGEBYSCORE ws:pings -inf now-300000` – get idle users
  - `ZREM ws:pings user` – cleanup on shutdown
  - `ZCARD ws:pings` – count active users

---

### 3. `ws:pool` – Warm Machine Pool

- 🧩 Type: `SET`
- 📌 Key: `ws:pool`

| Member (Set)         |
| -------------------- |
| `i-07f1abc12345def`  |
| `i-0a1b2c3d4e5f6789` |

- Purpose:

  - Contains instanceIds of EC2 machines that are running but unassigned (warm spares)
  - Avoids need to boot new machine for every user

- 🔧 Redis Commands:

  - `SPOP ws:pool` – allocate a warm box
  - `SADD ws:pool instanceId` – return to pool
  - `SREM ws:pool instanceId` – remove if allocated or shut down
  - `SCARD ws:pool` – size of warm pool

---

## ✅ Common Use Cases & Redis Queries

| Action                  | Redis Logic                                               |
| ----------------------- | --------------------------------------------------------- |
| Get user workspace      | `HGETALL ws:{user}`                                       |
| Update ping timestamp   | `ZADD ws:pings now user`<br>`HSET ws:{user} lastSeen now` |
| Find idle users         | `ZRANGEBYSCORE ws:pings -inf now-300000`                  |
| Allocate warm spare     | `SPOP ws:pool`                                            |
| Return box to pool      | `SADD ws:pool instanceId`                                 |
| Count active users      | `ZCARD ws:pings`                                          |
| Check pool availability | `SCARD ws:pool`                                           |

---

Let me know if you want this exported as a PDF/Markdown/Notion copy, or a Redis CLI cheat sheet format.
