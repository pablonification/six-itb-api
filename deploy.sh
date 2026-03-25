#!/bin/bash
# SIX API Deployment Script for VPS

set -e

echo "🚀 SIX API Deployment Script"
echo "=============================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    echo "Run: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# Check if Docker Compose is installed
if ! docker compose version &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed.${NC}"
    exit 1
fi

# Generate master admin key if not set
if [ -z "$MASTER_ADMIN_KEY" ]; then
    echo -e "${YELLOW}MASTER_ADMIN_KEY not set. Generating a secure key...${NC}"
    export MASTER_ADMIN_KEY=$(openssl rand -hex 32)
    echo -e "${GREEN}Generated MASTER_ADMIN_KEY: $MASTER_ADMIN_KEY${NC}"
    echo -e "${YELLOW}Save this key securely!${NC}"
fi

# Create data directory
mkdir -p data

# Build and start
echo ""
echo "📦 Building Docker image..."
docker compose build

echo ""
echo "🚀 Starting services..."
docker compose up -d

echo ""
echo "⏳ Waiting for service to be ready..."
sleep 5

# Health check
echo ""
echo "🔍 Checking health..."
HEALTH=$(curl -s http://localhost:3000/health | head -c 100)

if [ -n "$HEALTH" ]; then
    echo -e "${GREEN}✅ Service is running!${NC}"
    echo ""
    echo "📊 Service Info:"
    echo "   URL: http://localhost:3000"
    echo "   Health: http://localhost:3000/health"
    echo "   Dashboard: http://localhost:3000/ui"
    echo "   Docs: http://localhost:3000/docs"
    echo ""
    echo "🔑 Master Admin Key: $MASTER_ADMIN_KEY"
    echo ""
    echo "📝 Useful commands:"
    echo "   View logs: docker compose logs -f"
    echo "   Stop: docker compose down"
    echo "   Restart: docker compose restart"
else
    echo -e "${RED}❌ Service failed to start. Check logs:${NC}"
    docker compose logs
    exit 1
fi