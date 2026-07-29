#!/usr/bin/env bash
# ============================================================
# EC2 Ubuntu 22.04/24.04 bootstrap for the Order/Payment app.
# Installs everything needed for ALL THREE deployment modes:
# systemd (Node + Postgres + nginx), PM2, and Docker.
#
# Usage: chmod +x setup-ec2.sh && sudo ./setup-ec2.sh
# ============================================================
set -euo pipefail

echo ">> Updating packages"
sudo apt-get update -y
sudo apt-get upgrade -y

echo ">> Installing base tools"
sudo apt-get install -y curl git ufw nginx

echo ">> Installing Node.js 20.x"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v

echo ">> Installing PM2 globally"
sudo npm install -g pm2

echo ">> Installing PostgreSQL (for systemd/PM2 modes, which run outside Docker)"
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

echo ">> Installing Docker Engine + Compose plugin"
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"

echo ">> Creating dedicated service user for systemd mode"
sudo useradd --system --no-create-home --shell /usr/sbin/nologin appsvc || true

echo ">> Configuring firewall (adjust as needed)"
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo ">> Done. Log out/in (or run 'newgrp docker') for the docker group to take effect."
echo ">> Next: create the appdb database and appuser role, then follow README.md for your chosen deployment mode."
