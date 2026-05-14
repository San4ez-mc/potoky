#!/bin/bash
cd /var/www/flows.fineko.space/platform
echo "=== Building admin app..."
npm run build:admin
echo "=== Build completed. Restarting processes..."
pm2 restart all
echo "=== Done."
