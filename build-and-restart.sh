#!/bin/bash
set -e

cd /var/www/flows.fineko.space/platform
if ! command -v yarn >/dev/null 2>&1; then
	npm install -g yarn
fi

echo "=== Installing dependencies..."
yarn install --frozen-lockfile

echo "=== Generating Prisma client..."
yarn workspace @platform/db exec prisma generate

echo "=== Building admin app..."
yarn build:admin
echo "=== Build completed. Restarting processes..."
pm2 start ecosystem.config.js --env production
pm2 save
echo "=== Done."
