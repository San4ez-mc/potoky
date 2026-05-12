#!/bin/bash
# Fix nginx config for google.fineko.space
cat > /etc/nginx/sites-enabled/google.fineko.space << 'EOF'
server {
    listen 80;
    server_name google.fineko.space;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name google.fineko.space;
    ssl_certificate /etc/letsencrypt/live/google.fineko.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/google.fineko.space/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    add_header Strict-Transport-Security 'max-age=31536000' always;
    add_header X-Content-Type-Options nosniff;
    root /srv/driveai/web;
    index index.html;
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /mcp/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
    location /telegram/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /health { proxy_pass http://127.0.0.1:8000; }
    location / { try_files $uri $uri/ /index.html; }
}
EOF

# Write flows.fineko.space config
cat > /etc/nginx/sites-available/flows.fineko.space << 'EOF'
server {
    listen 80;
    server_name flows.fineko.space;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name flows.fineko.space;
    ssl_certificate /etc/letsencrypt/live/flows.fineko.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/flows.fineko.space/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    add_header Strict-Transport-Security 'max-age=31536000' always;
    root /var/www/flows.fineko.space/platform/public/admin;
    index index.html;
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
    location /mcp {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/flows.fineko.space /etc/nginx/sites-enabled/flows.fineko.space
nginx -t && systemctl reload nginx && echo NGINX_ALL_DONE
