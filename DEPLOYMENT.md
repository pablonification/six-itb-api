# SIX API Deployment Guide

This guide covers deploying the SIX API to a VPS using Docker.

## Why VPS (Not Vercel)?

This API requires a VPS because of its architecture:

| Feature | Requirement | Vercel Support |
|---------|-------------|----------------|
| Playwright/Chromium | Browser automation | Not available on serverless |
| Browser Pool | Persistent browser instances | Not supported (stateless) |
| WebSocket | Long-lived connections | Limited support |
| SQLite | Persistent filesystem | Ephemeral (lost between requests) |
| Long execution | Login flow can take minutes | 10-60 second timeout limit |

## Prerequisites

- A VPS with at least:
  - 1 GB RAM (2 GB recommended)
  - 1 vCPU (2 vCPU recommended)
  - 10 GB storage
  - Ubuntu 20.04+ or similar Linux distro
- A domain name (optional, for SSL)
- SSH access to your VPS

## Quick Deployment

### 1. Initial VPS Setup

```bash
# SSH into your VPS
ssh root@your-vps-ip

# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Start Docker service
systemctl start docker
systemctl enable docker

# Install Docker Compose (if not included)
apt install docker compose -y
```

### 2. Clone and Deploy

```bash
# Clone the repository
git clone <your-repo-url>
cd six-api-claude-code

# Generate a secure master admin key
MASTER_ADMIN_KEY=$(openssl rand -hex 32)
echo "Your Master Admin Key: $MASTER_ADMIN_KEY"
# SAVE THIS KEY SECURELY!

# Run the deployment script
./deploy.sh
```

Or manually:

```bash
# Create data directory
mkdir -p data

# Set environment and start
export MASTER_ADMIN_KEY=$(openssl rand -hex 32)
docker compose up -d --build
```

### 3. Verify Deployment

```bash
# Check if container is running
docker ps

# Check health endpoint
curl http://localhost:3000/health

# View logs
docker compose logs -f
```

## Configuration

### Environment Variables

Create a `.env` file or set variables in `docker compose.yml`:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `NODE_ENV` | Environment | `production` |
| `LOG_LEVEL` | Logging level | `info` |
| `CORS_ORIGIN` | Allowed origins | `*` |
| `DB_PATH` | Session database path | `/app/data/sessions.db` |
| `API_KEY_DB_PATH` | API keys database path | `/app/data/api_keys.db` |
| `API_KEY_ENABLED` | Enable API key auth | `true` |
| `MASTER_ADMIN_KEY` | Admin key for API key creation | Required |
| `BROWSER_HEADLESS` | Run browser headless | `true` |

### CORS Configuration

For production, restrict CORS to your domains:

```yaml
environment:
  - CORS_ORIGIN=https://yourdomain.com,https://app.yourdomain.com
```

## SSL/HTTPS Setup

### Using Nginx + Let's Encrypt

1. **Install Nginx and Certbot:**

```bash
apt install nginx certbot python3-certbot-nginx -y
```

2. **Copy the Nginx configuration:**

```bash
cp nginx.conf.example /etc/nginx/sites-available/six-api
```

3. **Edit the configuration:**

```bash
nano /etc/nginx/sites-available/six-api
```

Change `your-domain.com` to your actual domain.

4. **Enable the site:**

```bash
ln -s /etc/nginx/sites-available/six-api /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t  # Test configuration
systemctl restart nginx
```

5. **Get SSL certificate:**

```bash
certbot --nginx -d your-domain.com
```

6. **Auto-renewal:**

```bash
certbot renew --dry-run  # Test renewal
```

Certbot sets up automatic renewal via systemd timer.

## Useful Commands

### Docker Commands

```bash
# View running containers
docker ps

# View logs
docker compose logs -f

# View last 100 lines
docker compose logs --tail=100

# Restart service
docker compose restart

# Stop service
docker compose down

# Stop and remove volumes
docker compose down -v

# Rebuild and restart
docker compose up -d --build

# Execute command in container
docker exec -it six-api sh
```

### Monitoring

```bash
# Container resource usage
docker stats six-api

# Health check
curl http://localhost:3000/health | jq .

# Check API info
curl http://localhost:3000/ | jq .
```

### Database Management

```bash
# Backup databases
cp data/sessions.db data/sessions.db.backup
cp data/api_keys.db data/api_keys.db.backup

# Access SQLite
docker exec -it six-api sh
sqlite3 /app/data/api_keys.db
```

## Updating

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose up -d --build

# Check logs
docker compose logs -f
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs

# Check if port is in use
lsof -i :3000

# Check Docker status
systemctl status docker
```

### Browser/Playwright issues

```bash
# Check if Chromium installed
docker exec -it six-api sh
npx playwright --version

# Install dependencies manually
apt install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2
```

### Memory issues

```bash
# Check memory usage
free -h

# Increase Docker memory limit in docker compose.yml
deploy:
  resources:
    limits:
      memory: 2G
```

### Database locked

```bash
# Stop service
docker compose down

# Check for lock files
ls -la data/

# Remove lock files if any
rm data/*.db-wal data/*.db-shm 2>/dev/null

# Restart
docker compose up -d
```

## Scaling

For high traffic, consider:

1. **Vertical scaling**: Increase VPS resources
2. **Horizontal scaling**: Run multiple instances behind a load balancer
3. **External database**: Use PostgreSQL/MySQL instead of SQLite
4. **Redis cache**: Replace in-memory cache with Redis

## Security Recommendations

1. **Firewall:**
```bash
# Allow only SSH, HTTP, HTTPS
ufw allow ssh
ufw allow 80
ufw allow 443
ufw enable
```

2. **Change SSH port:**
```bash
nano /etc/ssh/sshd_config
# Change: Port 2222
systemctl restart sshd
```

3. **Disable root login:**
```bash
# Create user first!
adduser deployer
usermod -aG sudo deployer
usermod -aG docker deployer
```

4. **Keep system updated:**
```bash
apt update && apt upgrade -y
```

5. **Use strong MASTER_ADMIN_KEY:**
```bash
# Generate 64-character key
openssl rand -hex 32
```

## Support

For issues:
- Check logs: `docker compose logs -f`
- Health check: `curl http://localhost:3000/health`
- GitHub Issues: <your-repo-url>/issues