# Order & Payment Microservices — Sample App

A small, production-grade-ish reference system: **3 services + a database**, wired
together over HTTP, deployable **three different ways** on the same EC2 Ubuntu box:

1. **systemd** — each app runs as a native Linux service
2. **PM2** — each app runs as a managed Node process
3. **Docker Compose** — each app runs as a container

All three modes use the *same application code* — only how the process is
supervised changes.

## Architecture

```
                        ┌────────────────────┐
   Browser  ───────────▶│   nginx :80         │  (optional, recommended for prod)
                        └─────────┬───────────┘
                                  │ proxy_pass
                        ┌─────────▼───────────┐
                        │  frontend :3000       │  static dashboard + light API gateway
                        │  (Express + proxy)     │
                        └───────┬──────┬────────┘
                    /api/orders │      │ /api/payments
                        ┌───────▼──┐ ┌─▼─────────────┐
                        │  order    │ │  payment       │
                        │  service  │◀│  service       │
                        │  :4001    │─▶  :4002         │
                        └─────┬─────┘ └───────┬────────┘
                              │  SQL           │ SQL
                              └───────┬────────┘
                                ┌─────▼──────┐
                                │  PostgreSQL │
                                │  (orders,   │
                                │   payments) │
                                └─────────────┘
```

**Flow:** the dashboard posts a new order → `order-service` inserts a `PENDING`
row and calls `payment-service` → `payment-service` simulates a charge, writes
a `payments` row, then calls back into `order-service` to flip the order to
`PAID` or `PAYMENT_FAILED`. This request chain is the "communicating with each
other" part you asked for — two independent services, each with their own
code/deploy lifecycle, coordinating over plain HTTP with retriable, loosely
coupled calls.

## Repository layout

```
ecommerce-microservices/
├── services/
│   ├── order-service/       # Express API — owns "orders" table
│   └── payment-service/     # Express API — owns "payments" table, simulates a gateway
├── frontend/                # Dashboard UI (static HTML/CSS/JS) + tiny Express gateway
├── db/init.sql              # Schema, auto-applied by Docker, or run manually
├── docker/docker-compose.yml
├── systemd/*.service        # Unit files for the systemd deployment mode
├── pm2/ecosystem.config.js  # Process list for the PM2 deployment mode
├── nginx/app.conf           # Reverse proxy in front of whichever mode you run
├── scripts/setup-ec2.sh     # One-shot EC2 bootstrap (Node, PM2, Docker, Postgres, nginx)
├── scripts/create-db.sh     # DB + role creation for systemd/PM2 modes
└── .github/workflows/ci.yml # Builds images and smoke-tests the stack on every push
```

## Services at a glance

| Service | Port | Responsibility | Talks to |
|---|---|---|---|
| `frontend` | 3000 | Serves dashboard, proxies `/api/*` | order-service, payment-service |
| `order-service` | 4001 | Create/list orders, owns `orders` table | Postgres, payment-service |
| `payment-service` | 4002 | Simulates payment, owns `payments` table | Postgres, order-service |
| `postgres` | 5432 | Shared database (2 tables: `orders`, `payments`) | — |

Each service exposes `GET /health` for load balancers, Docker healthchecks,
and monitoring.

---

## 0. Provision the EC2 instance

- Ubuntu 22.04 or 24.04 LTS, t3.small or larger (t3.micro works for the demo)
- Security group: allow inbound **22** (SSH, your IP only), **80** (HTTP), and
  **443** if you add TLS later. Do **not** open 4001/4002/5432 to the internet.
- SSH in, clone the repo, then run the bootstrap script:

```bash
git clone https://github.com/<your-username>/ecommerce-microservices.git
cd ecommerce-microservices
chmod +x scripts/*.sh
sudo ./scripts/setup-ec2.sh
```

This installs Node 20, PM2, Docker + Compose plugin, PostgreSQL, nginx, and a
dedicated `appsvc` system user — everything needed for **all three** modes so
you can try each one on the same box (just stop one before starting another
on the same ports).

Pick **one** of the three sections below.

---

## Mode 1 — systemd (native Linux services)

Best for: a traditional, no-container VM deployment where you want the OS's
own process supervisor (auto-start on boot, `journalctl` logs, restart
policies) managing things directly.

**1. Create the database**
```bash
DB_USER=appuser DB_PASSWORD='change_me_strong_password' DB_NAME=appdb \
  sudo -E ./scripts/create-db.sh
```

**2. Deploy the code to `/opt/app`**
```bash
sudo mkdir -p /opt/app
sudo cp -r services frontend /opt/app/
sudo chown -R appsvc:appsvc /opt/app
```

**3. Install dependencies and configure env files**
```bash
cd /opt/app/services/order-service && sudo -u appsvc npm install --omit=dev
cp .env.example .env   # then edit DB_PASSWORD to match step 1
cd /opt/app/services/payment-service && sudo -u appsvc npm install --omit=dev
cp .env.example .env   # edit DB_PASSWORD

cd /opt/app/frontend && sudo -u appsvc npm install --omit=dev
cp .env.example .env   # defaults are fine (points at localhost:4001/4002)
```

**4. Install and start the unit files**
```bash
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now order-service payment-service frontend
```

**5. Check status / logs**
```bash
systemctl status order-service payment-service frontend
journalctl -u order-service -f
```

**6. Front it with nginx**
```bash
sudo cp nginx/app.conf /etc/nginx/sites-available/app.conf
sudo ln -s /etc/nginx/sites-available/app.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Visit `http://<ec2-public-ip>/`.

**Stopping this mode** (before trying another one on the same ports):
```bash
sudo systemctl disable --now order-service payment-service frontend
```

---

## Mode 2 — PM2 (managed Node processes)

Best for: Node-centric teams who want zero-downtime reloads, a process
dashboard (`pm2 monit`), and log management without full container overhead.

**1. Database** — same as systemd mode (`scripts/create-db.sh`), unless
already created.

**2. Clone / pull the repo somewhere PM2 can read it, e.g. `~/app`**
```bash
git clone https://github.com/<your-username>/ecommerce-microservices.git ~/app
cd ~/app
```

**3. Install deps and env files for each app**
```bash
(cd services/order-service && npm install --omit=dev && cp .env.example .env)
(cd services/payment-service && npm install --omit=dev && cp .env.example .env)
(cd frontend && npm install --omit=dev && cp .env.example .env)
# edit each .env, set DB_PASSWORD to match the DB you created
```

**4. Start everything with PM2**
```bash
sudo mkdir -p /var/log/pm2 && sudo chown $USER /var/log/pm2
pm2 start pm2/ecosystem.config.js
pm2 status
```

**5. Persist across reboots**
```bash
pm2 save
pm2 startup systemd   # run the printed sudo command it outputs
```

**6. Useful PM2 commands**
```bash
pm2 logs order-service       # tail logs for one app
pm2 restart payment-service  # zero-downtime-ish restart
pm2 monit                    # live CPU/memory dashboard
```

**7. Front it with nginx** — same `nginx/app.conf` as Mode 1.

**Stopping this mode:**
```bash
pm2 delete ecosystem.config.js
```

---

## Mode 3 — Docker Compose (containers)

Best for: reproducible builds, easy horizontal scaling, and matching your
local dev environment to prod exactly.

**1. Configure environment**
```bash
cd docker
cp .env.example .env
# edit DB_PASSWORD in .env
```

**2. Build and start**
```bash
docker compose up -d --build
docker compose ps
```

Postgres, order-service, and payment-service all sit on an isolated Docker
bridge network (`app-network`) and are **not** exposed to the host — only the
frontend's port 3000 is published. The DB schema in `db/init.sql` is applied
automatically on first boot via Postgres's `docker-entrypoint-initdb.d`
mechanism.

**3. Front it with nginx** (proxying to `127.0.0.1:3000`, same `nginx/app.conf`
as the other modes), or just open port 3000 directly for a quick demo.

**4. Logs / lifecycle**
```bash
docker compose logs -f order-service
docker compose restart payment-service
docker compose down          # stop, keep DB volume
docker compose down -v       # stop and wipe the DB volume
```

**Stopping this mode:**
```bash
cd docker && docker compose down
```

---

## Trying it out (any mode)

```bash
curl http://<host>/api/orders

curl -X POST http://<host>/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Ada Lovelace","productName":"Keyboard","quantity":1,"amount":49.00}'
```

Or just open `http://<host>/` in a browser and use the dashboard form.

---

## Production-hardening notes

- **Secrets:** never commit real `.env` files (see `.gitignore`). On EC2,
  consider AWS Secrets Manager or SSM Parameter Store instead of plain `.env`
  files for `DB_PASSWORD`.
- **TLS:** put `certbot --nginx` in front once you have a domain name pointed
  at the instance; the provided `nginx/app.conf` is HTTP-only by design so
  you can layer TLS on top for your specific domain.
- **DB access:** in every mode, Postgres is bound to `localhost`/an internal
  Docker network only — never expose 5432 to the internet.
- **Rate limiting:** both Node services use `express-rate-limit`; nginx also
  rate-limits at the edge (`limit_req_zone` in `nginx/app.conf`).
- **Health checks:** all three apps expose `/health`; Docker Compose uses
  this for `depends_on: condition: service_healthy`-style gating and you can
  wire the same endpoint into an EC2 target group if you later move to an ALB
  + Auto Scaling Group.
- **Least privilege:** systemd units run as a dedicated unprivileged
  `appsvc` user with `ProtectSystem=strict`; Docker images run as a
  non-root `appuser` inside the container.
- **CI:** `.github/workflows/ci.yml` builds all three images and runs a
  smoke test (`docker compose up` + health checks) on every push — extend
  this with your own deploy step (e.g. SSH + `git pull` + restart, or push to
  ECR and pull on the instance).

## Pushing this to your own GitHub repo

```bash
cd ecommerce-microservices
git init
git add .
git commit -m "Initial commit: order/payment microservices sample app"
git branch -M main
git remote add origin https://github.com/<your-username>/ecommerce-microservices.git
git push -u origin main
```

Then clone that repo on your EC2 instance and follow whichever mode section
above you want.
