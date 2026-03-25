# SIX API

Unofficial REST API for SIX ITB (Sistem Informasi Akademik - Institut Teknologi Bandung). This API provides programmatic access to student academic data through browser automation.

## Features

- **Authentication** - Browser-based login with session management
- **Profile** - Student profile information (name, NIM, faculty, GPA)
- **Courses** - Current semester course list
- **Schedule** - Class schedule by semester and today's schedule
- **Financial** - Payment and billing status
- **Study Plan (KRS)** - Course registration data

### Production Ready

- **API Key Authentication** - Secure access with API keys
- **Rate Limiting** - Configurable rate limits per key
- **Admin Dashboard** - Web UI for API key management at `/ui`
- **API Documentation** - Interactive docs at `/docs`
- **Data Caching** - TTL-based caching with `refresh=true` bypass

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Playwright (for browser automation)

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/six-api.git
cd six-api

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Build TypeScript
npm run build
```

### Configuration

Create a `.env` file:

```env
# Server
PORT=3000
NODE_ENV=development

# Authentication
API_KEY_ENABLED=true
MASTER_ADMIN_KEY=your-secure-admin-key

# CORS
CORS_ORIGIN=*

# Browser
BROWSER_HEADLESS=true
```

### Running

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## API Usage

### 1. Create API Key (Admin)

```bash
# Using master admin key
curl -X POST http://localhost:3000/admin/keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-master-admin-key" \
  -d '{
    "name": "My App",
    "userId": "user-123",
    "rateLimit": 60,
    "permissions": ["read", "auth"]
  }'
```

### 2. Authenticate

```bash
# Start browser login
curl -X POST http://localhost:3000/auth/browser \
  -H "X-API-Key: your-api-key"

# Response includes QR code (terminal) or login URL
# After successful login, you get a sessionId
```

### 3. Fetch Data

```bash
# Get profile
curl "http://localhost:3000/data/profile?sessionId=YOUR_SESSION_ID" \
  -H "X-API-Key: your-api-key"

# Get courses
curl "http://localhost:3000/data/courses?sessionId=YOUR_SESSION_ID" \
  -H "X-API-Key: your-api-key"

# Get schedule
curl "http://localhost:3000/data/schedule?sessionId=YOUR_SESSION_ID&semester=2024-1" \
  -H "X-API-Key: your-api-key"

# Force fresh data (bypass cache)
curl "http://localhost:3000/data/profile?sessionId=YOUR_SESSION_ID&refresh=true" \
  -H "X-API-Key: your-api-key"
```

## API Endpoints

### Authentication

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| POST | `/auth/browser` | `auth` | Start browser-based login |
| GET | `/auth/status/:sessionId` | - | Check login status |
| DELETE | `/auth/session/:sessionId` | `auth` | End session |

### Data Endpoints

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/data/profile` | `read` | Student profile |
| GET | `/data/courses` | `read` | Current courses |
| GET | `/data/courses/slots` | `read` | Course slot availability |
| GET | `/data/schedule` | `read` | Semester schedule |
| GET | `/data/schedule/today` | `read` | Today's classes |
| GET | `/data/financial` | `read` | Payment status |
| GET | `/data/study-plan` | `read` | KRS data |

### Admin Endpoints

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| POST | `/admin/keys` | `admin` | Create API key |
| GET | `/admin/keys` | `admin` | List all keys |
| GET | `/admin/keys/:id` | `admin` | Get key details |
| PUT | `/admin/keys/:id` | `admin` | Update key |
| DELETE | `/admin/keys/:id` | `admin` | Revoke key |
| GET | `/admin/keys/:id/usage` | `admin` | Get usage stats |
| GET | `/admin/me` | - | Self-service key info |

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API info |
| GET | `/health` | Health check |
| GET | `/ui` | Admin dashboard |
| GET | `/docs` | API documentation |

## Permissions

| Permission | Description |
|------------|-------------|
| `read` | Access data endpoints |
| `write` | Modify data (sniper, etc.) |
| `presence` | Mark attendance |
| `auth` | Create/manage sessions |
| `admin` | Manage API keys |

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed VPS deployment guide with Docker.

### Quick Docker Deploy

```bash
# Generate admin key
export MASTER_ADMIN_KEY=$(openssl rand -hex 32)

# Build and run
docker-compose up -d --build

# Check health
curl http://localhost:3000/health
```

## Project Structure

```
six-api/
├── src/
│   ├── routes/
│   │   ├── auth.ts       # Authentication routes
│   │   ├── data.ts       # Data fetching routes
│   │   ├── ui.ts         # Dashboard & docs
│   │   └── admin.ts      # Admin key management
│   ├── services/
│   │   ├── browser-pool.ts    # Browser instance management
│   │   ├── session-store.ts   # Session state storage
│   │   ├── api-key-store.ts   # API key management
│   │   └── auth-middleware.ts # Auth & rate limiting
│   ├── scrapers/
│   │   ├── profile.ts    # Profile scraper
│   │   ├── courses.ts    # Course scraper
│   │   ├── schedule.ts   # Schedule scraper
│   │   ├── financial.ts  # Financial scraper
│   │   └── study-plan.ts # KRS scraper
│   ├── types/
│   │   └── index.ts      # TypeScript interfaces
│   └── server.ts         # Fastify server setup
├── dist/                  # Compiled JavaScript
├── data/                  # SQLite databases (created at runtime)
├── Dockerfile
├── docker-compose.yml
├── deploy.sh
├── nginx.conf.example
├── DEPLOYMENT.md
└── README.md
```

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Fastify
- **Browser Automation**: Playwright
- **Database**: SQLite (better-sqlite3)
- **Language**: TypeScript

## Security

- API keys are stored hashed (SHA-256)
- Rate limiting per API key
- Session-based authentication
- CORS configuration
- Input validation with Zod

## Limitations

- Requires valid ITB credentials
- Dependent on SIX ITB website structure
- Sessions may expire and need re-authentication
- Rate limited by ITB servers

## Disclaimer

This is an **unofficial** API and is not affiliated with or endorsed by Institut Teknologi Bandung. Use at your own risk and responsibility. Be mindful of ITB's terms of service and do not abuse the system.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request