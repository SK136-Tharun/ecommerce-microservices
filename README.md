# Order & Payment Microservices — Sample App

A small, production-grade-ish reference system: **3 services + a database**,
wired together over HTTP, deployable **three different ways** — and this
version is built so all three can run **at the same time, side by side, on
the same EC2 box**, each on its own ports and its own database, so you can
compare them directly instead of stopping one to try the next.

| Mode | Frontend | Order Service | Payment Service | Database | URL via nginx |
|---|---|---|---|---|---|
| **systemd** | `:3001` | `:4011` | `:4021` | `appdb_systemd` | `http://<host>/systemd/` |
| **PM2** | `:3002` | `:4012` | `:4022` | `appdb_pm2` | `http://<host>/pm2/` |
| **Docker** | `:3003` | `:4013` | `:4023` | `appdb_docker` (own container) | `http://<host>/docker/` |

Every service exposes `GET /health`, which now returns a `mode` field
(`systemd` / `pm2` / `docker`) and the port it's running on — so you can
`curl` any of the nine running processes and immediately see which
deployment produced the response. The dashboard also shows a colored
**mode badge** in its header for the same reason.

## Architecture (per mode)

```
                        ┌────────────────────┐
   Browser  ───────────▶│   nginx :80         │  routes by path prefix
                        └─────────┬───────────┘
              /systemd/ │  /pm2/  │  /docker/
                 ┌───────┘         └───────┐
                 ▼                         ▼
        frontend :300X                (same pattern
        (Express + proxy)               per mode)
                 │  api/orders  │  api/payments
           ┌─────▼──────┐  ┌────▼───────┐
           │ order       │  │ payment    │
           │ service     │◀▶│ service    │
           │ :401X       │  │ :402X      │
           └──────┬──────┘  └─────┬──────┘
                  │  SQL           │ SQL
                  └───────┬────────┘
                    ┌──────▼──────┐
                    │ PostgreSQL   │  (own DB per mode)
                    └──────────────┘
```

**Flow:** the dashboard posts a new order → `order-service` inserts a
`PENDING` row and calls `payment-service` → `payment-service` simulates a
charge (90% success / 10% failure, by design — not a bug), writes a
`payments` row, then calls back into `order-service` to flip the order to
`PAID` or `PAYMENT_FAILED`. `order-service` re-fetches the row after that
callback so its response always reflects the real persisted status.

## Repository layout

```
ecommerce-microservices/
├── services/
│   ├── order-service/       # Express API -- owns "orders" table
│   └── payment-service/     # Express API -- owns "payments" table
├── frontend/                # Dashboard UI + tiny Express gateway
├── db/init.sql              # Schema, applied once per database
├── docker/docker-compose.yml  # mode: docker  (ports 3003/4013/4023)
├── systemd/*.service          # mode: systemd (ports 3001/4011/4021, via .env)
├── pm2/ecosystem.config.js    # mode: pm2     (ports 3002/4012/4022, env inline)
├── nginx/app.conf           # Path-based router in front of all three modes
├── scripts/setup-ec2.sh     # One-shot EC2 bootstrap (Node, PM2, Docker, Postgres, nginx)
├── scripts/create-db.sh     # Creates + grants a named DB (run once per mode)
└── .github/workflows/ci.yml # Builds images and smoke-tests the Docker mode
```

---

## 0. Provision the EC2 instance

- Ubuntu 22.04/24.04 LTS, t3.small+
- Security group: inbound **22** (your IP), **80** (HTTP). Don't open
  3001-3003, 4011-4023, or 5432 to the internet — those stay behind nginx
  or on `localhost`/the Docker network only.

```bash
git clone https://github.com/<your-username>/ecommerce-microservices.git
cd ecommerce-microservices
chmod +x scripts/*.sh
sudo ./scripts/setup-ec2.sh
```

Installs Node 20, PM2, Docker + Compose plugin, PostgreSQL, nginx, and a
dedicated `appsvc` system user **with a real home directory** (npm needs
`$HOME` for its cache — a homeless system user makes every `npm install`
fail with `EACCES`).

---

## Mode 1 — systemd (ports 3001 / 4011 / 4021, db `appdb_systemd`)

**1. Create the database**
```bash
DB_USER=appuser DB_PASSWORD='change_me_strong_password' DB_NAME=appdb_systemd \
  sudo -E ./scripts/create-db.sh
```
This both creates the schema *and* grants `appuser` ownership/privileges on
it — `init.sql` runs as the `postgres` superuser, so without an explicit
grant step the app would connect fine but every query would fail with
`permission denied for table orders` (error `42501`).

**2. Deploy the code to `/opt/app`**
```bash
sudo mkdir -p /opt/app
sudo cp -r services frontend /opt/app/
sudo chown -R appsvc:appsvc /opt/app
```

**3. Install dependencies as `appsvc`**
```bash
cd /opt/app/services/order-service   && sudo -u appsvc HOME=/home/appsvc npm install --omit=dev
cd /opt/app/services/payment-service && sudo -u appsvc HOME=/home/appsvc npm install --omit=dev
cd /opt/app/frontend                 && sudo -u appsvc HOME=/home/appsvc npm install --omit=dev
```
Verify every install actually completed (npm's tmp-dir cleanup can
occasionally race and silently drop files):
```bash
ls /opt/app/services/order-service/node_modules   | grep -E '^(dotenv|express|pg|axios|helmet|pino)$'
ls /opt/app/services/payment-service/node_modules | grep -E '^(dotenv|express|pg|axios|helmet|pino)$'
ls /opt/app/frontend/node_modules                 | grep -E '^(dotenv|express|helmet|http-proxy-middleware)$'
```
Each command should print back every name listed. If any are missing,
`rm -rf node_modules package-lock.json` and re-run that install.

**4. Env files (systemd mode ports/DB)**
```bash
sudo tee /opt/app/services/order-service/.env > /dev/null << 'EOF'
PORT=4011
DB_HOST=localhost
DB_PORT=5432
DB_USER=appuser
DB_PASSWORD=change_me_strong_password
DB_NAME=appdb_systemd
PAYMENT_SERVICE_URL=http://localhost:4021
DEPLOY_MODE=systemd
LOG_LEVEL=info
EOF

sudo tee /opt/app/services/payment-service/.env > /dev/null << 'EOF'
PORT=4021
DB_HOST=localhost
DB_PORT=5432
DB_USER=appuser
DB_PASSWORD=change_me_strong_password
DB_NAME=appdb_systemd
ORDER_SERVICE_URL=http://localhost:4011
DEPLOY_MODE=systemd
LOG_LEVEL=info
EOF

sudo tee /opt/app/frontend/.env > /dev/null << 'EOF'
PORT=3001
ORDER_SERVICE_URL=http://localhost:4011
PAYMENT_SERVICE_URL=http://localhost:4021
DEPLOY_MODE=systemd
EOF
```

**5. Install and start the unit files**
```bash
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now order-service payment-service frontend
systemctl status order-service payment-service frontend
```

**6. Test it directly (before nginx)**
```bash
curl -s http://localhost:4011/health   # -> {"status":"ok","service":"order-service","mode":"systemd","port":"4011",...}
curl -s http://localhost:3001/health   # -> {"status":"ok","service":"frontend","mode":"systemd","port":"3001"}
```

---

## Mode 2 — PM2 (ports 3002 / 4012 / 4022, db `appdb_pm2`)

Run from a **separate checkout**, `~/app`, so it never touches the same
files as the systemd deployment in `/opt/app`.

**1. Database**
```bash
DB_USER=appuser DB_PASSWORD='change_me_strong_password' DB_NAME=appdb_pm2 \
  sudo -E ./scripts/create-db.sh
```

**2. Clone and install**
```bash
git clone https://github.com/<your-username>/ecommerce-microservices.git ~/app
cd ~/app
(cd services/order-service && npm install --omit=dev)
(cd services/payment-service && npm install --omit=dev)
(cd frontend && npm install --omit=dev)
```

**3. Start with PM2** — ports, DB name, and `DEPLOY_MODE=pm2` are already
set inline in `pm2/ecosystem.config.js`, so no `.env` editing is needed:
```bash
sudo mkdir -p /var/log/pm2 && sudo chown $USER /var/log/pm2
DB_PASSWORD='change_me_strong_password' pm2 start pm2/ecosystem.config.js
pm2 status
pm2 save
pm2 startup systemd   # run the printed sudo command it outputs
```

**4. Test it directly**
```bash
curl -s http://localhost:4012/health   # mode: pm2
curl -s http://localhost:3002/health   # mode: pm2
```

**Useful PM2 commands:** `pm2 logs order-service-pm2`, `pm2 restart frontend-pm2`, `pm2 monit`.

---

## Mode 3 — Docker Compose (ports 3003 / 4013 / 4023, own containerized DB)

Fully isolated — its own Postgres **container**, so there's no dependency
on (or conflict with) the host Postgres used by the other two modes.

```bash
cd ~/app/docker   # or wherever you cloned it
cp .env.example .env
# edit DB_PASSWORD in .env if you want it to differ from the other modes
docker compose up -d --build
docker compose ps
```

**Test it directly**
```bash
curl -s http://localhost:4013/health   # mode: docker
curl -s http://localhost:3003/health   # mode: docker
```

`docker compose logs -f order-service`, `docker compose restart payment-service`,
`docker compose down` (keeps the DB volume) / `docker compose down -v` (wipes it).

---

## Running all three modes simultaneously + nginx

Once all three are up, wire nginx in front so every mode is reachable over
plain HTTP on port 80, distinguished by path:

```bash
cd ~/app   # (or wherever the repo is checked out)
sudo cp nginx/app.conf /etc/nginx/sites-available/app.conf
sudo ln -sf /etc/nginx/sites-available/app.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Now visit:
- `http://<ec2-public-ip>/` — a landing page linking to all three
- `http://<ec2-public-ip>/systemd/` — the systemd-mode dashboard (blue badge)
- `http://<ec2-public-ip>/pm2/` — the PM2-mode dashboard (green badge)
- `http://<ec2-public-ip>/docker/` — the Docker-mode dashboard (purple badge)

Each is a completely independent stack with its own database — placing an
order on `/pm2/` does not affect `/systemd/` or `/docker/`, which is the
easiest way to prove all three are genuinely running side by side rather
than one process serving all three paths.

### End-to-end verification of all three at once
```bash
for mode in "systemd:4011" "pm2:4012" "docker:4013"; do
  name="${mode%%:*}"; port="${mode##*:}"
  echo "== $name (order-service :$port) =="
  curl -s -X POST "http://localhost:${port}/api/orders" \
    -H 'Content-Type: application/json' \
    -d '{"customerName":"Test","productName":"Widget","quantity":1,"amount":10.00}' \
    | python3 -m json.tool
done
```
Each response's `servedByMode` field should match the mode you queried.

---

## Production-hardening notes

- **Secrets:** never commit real `.env` files. Consider AWS Secrets Manager
  / SSM Parameter Store instead of plaintext `.env` on the instance.
- **This demo publishes more ports than a real prod setup would** (each
  mode's order-service and payment-service are reachable directly, not
  just through the frontend/nginx) specifically so you can compare all
  three side by side. For an actual production deployment, pick **one**
  mode, don't publish the backend service ports at all, and put only the
  frontend behind nginx/TLS.
- **TLS:** `certbot --nginx` once you have a domain pointed at the box.
- **DB access:** never expose 5432 to the internet in any mode.
- **Rate limiting:** both Node services use `express-rate-limit`; nginx
  also rate-limits at the edge.
- **Health checks:** all apps expose `/health` with a `mode` field for
  exactly this kind of multi-deployment verification.
- **Least privilege:** systemd units run as `appsvc` with
  `ProtectSystem=strict`; Docker images run as non-root `appuser`.
- **CI:** `.github/workflows/ci.yml` builds and smoke-tests the Docker mode
  on every push.

## Common issues (from real deploys of this app)

| Symptom | Cause | Fix |
|---|---|---|
| `systemctl status` shows `activating (auto-restart)` looping | `.service` files not copied to `/etc/systemd/system/`, or app crash on start | `journalctl -u <service> -n 30` for the real error |
| `Cannot find module 'dotenv'` in journalctl | `npm install` didn't fully complete | `rm -rf node_modules` and reinstall; verify with `ls node_modules \| grep dotenv` |
| `npm error EACCES ... mkdir '/home/appsvc'` | `appsvc` created with `--no-create-home` | `sudo mkdir -p /home/appsvc && sudo chown appsvc:appsvc /home/appsvc && sudo usermod -d /home/appsvc appsvc` |
| `curl` returns `{"error":"not found"}` through nginx/frontend | Proxy mounted with `app.use('/api/orders', proxy)`, which strips the prefix before forwarding | Use `pathFilter` instead of the mount path (already fixed in this repo's `frontend/server.js`) |
| `permission denied for table orders` (`42501`) | `init.sql` runs as the `postgres` superuser, so tables are owned by `postgres`, not your app's DB role | `scripts/create-db.sh` now grants privileges automatically; for an existing DB run the `GRANT`/`ALTER DEFAULT PRIVILEGES` block manually |
| Order response's `status` and `paymentStatus` disagree | The old code returned the pre-payment row instead of re-fetching after the callback | Already fixed — `order-service` re-fetches the row before responding |

## Pushing this to your own GitHub repo

```bash
cd ecommerce-microservices
git init
git add .
git commit -m "Initial commit: order/payment microservices, 3 simultaneous deployment modes"
git branch -M main
git remote add origin https://github.com/<your-username>/ecommerce-microservices.git
git push -u origin main
```
