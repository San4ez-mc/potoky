#!/bin/bash
set -e

DEPLOY_DIR="/var/www/flows.fineko.space"
REPO="https://github.com/San4ez-mc/potoky.git"
NODE_VERSION="20"

echo "=== Platform Deploy Script ==="

# Install Node.js if missing
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi

# Install yarn, pm2 if missing
npm install -g yarn pm2 2>/dev/null || true

# Install PostgreSQL if missing
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
fi

# Install Redis if missing
if ! command -v redis-cli &>/dev/null; then
  apt-get install -y redis-server
  systemctl enable redis-server
  systemctl start redis-server
fi

# Create deploy dir
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

# Clone or pull
if [ -d ".git" ]; then
  git pull origin main
else
  git clone "$REPO" . 
fi

cd platform

# Create .env if not exists
if [ ! -f ".env" ]; then
  cat > .env << 'ENVEOF'
DATABASE_URL=postgresql://platform:platform_pass_CHANGE_ME@localhost:5432/platform
REDIS_URL=redis://localhost:6379
PORT=3000
NODE_ENV=production
SESSION_SECRET=GENERATE_RANDOM_32_CHARS_HERE
API_SECRET=GENERATE_RANDOM_32_CHARS_HERE
ADMIN_PASSWORD_HASH=$2b$12$FL.uZELG.26LIlGhW5er0.w6G.0DNhdSzaU8rSRh0MQNJbPAc6ND2
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_KEY
CLAUDE_MODEL=claude-haiku-4-5
FILES_BASE_PATH=/var/www/flows.fineko.space/files
LOG_LEVEL=info
ENVEOF
  echo "!!! Created .env — EDIT IT with real values before starting !!!"
fi

# Create DB user and DB if not exists
sudo -u postgres psql -tc "SELECT 1 FROM pg_user WHERE usename='platform'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER platform WITH PASSWORD 'platform_pass_CHANGE_ME';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='platform'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE platform OWNER platform;"

# Install deps
yarn install --frozen-lockfile

# Generate Prisma client
yarn workspace @platform/db exec prisma generate

# Run migrations
yarn workspace @platform/db exec prisma migrate deploy

# Build admin UI
yarn workspace @platform/admin build

# Create files dir
mkdir -p /var/www/flows.fineko.space/files

# Start/restart with PM2
pm2 delete platform-api platform-worker 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup systemd -u root --hp /root

echo "=== Deploy complete! API running on port 3000 ==="
echo "=== Admin UI: http://$(hostname -I | awk '{print $1}'):3000/admin ==="
echo "=== Login password: Platform2026! ==="
