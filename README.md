# PurePedal

AQI-aware cycling route app. Find the cleanest air for your ride.

PurePedal generates multiple cycling route options between any two points and scores each one based on real-time air quality exposure, distance, and elevation — so you always know the healthiest path.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  React Native │────▶│  Node.js Gateway  │────▶│  Python Scoring  │
│  Mobile App   │◀────│  (Express)        │◀────│  (FastAPI)       │
└──────────────┘     └────────┬─────────┘     └──────────────────┘
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              ┌──────────┐ ┌──────┐ ┌──────────┐
              │ Postgres │ │Redis │ │ BullMQ   │
              │ + PostGIS│ │      │ │ Workers  │
              └──────────┘ └──────┘ └──────────┘
```

**External APIs:** WAQI (air quality), OpenRouteService (cycling routes), Mapbox (map tiles), RevenueCat (subscriptions)

## Quick start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+
- Git

### Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/PurePedal.git
cd PurePedal

# Copy env file and add your API keys
cp .env.example .env

# Start all services
docker-compose up --build

# Verify everything is running
curl http://localhost:3000/health  # Backend gateway
curl http://localhost:8000/health  # Scoring service
```

The backend runs on port 3000, the scoring service on 8000, Postgres on 5432, and Redis on 6379.

### API keys you'll need

| Service | Sign up | Free tier |
|---------|---------|-----------|
| WAQI | [aqicn.org/data-platform/token](https://aqicn.org/data-platform/token/) | 1000 req/day |
| OpenRouteService | [openrouteservice.org](https://openrouteservice.org/dev/#/signup) | 2000 req/day |
| Mapbox | [mapbox.com](https://www.mapbox.com/) | 50k map loads/mo |
| Supabase | [supabase.com](https://supabase.com/) | 2 free projects |
| RevenueCat | [revenuecat.com](https://www.revenuecat.com/) | Free up to $2.5k MRR |

## Project structure

```
PurePedal/
├── backend/              # Node.js API gateway
│   ├── src/
│   │   ├── config/       # Environment config
│   │   ├── db/           # Postgres pool, Redis client, init SQL
│   │   ├── middleware/    # Auth, rate limiting, entitlements
│   │   ├── routes/       # Express route handlers
│   │   ├── workers/      # BullMQ job processors
│   │   ├── utils/        # Logger, helpers
│   │   └── index.js      # Entry point
│   ├── Dockerfile
│   └── package.json
├── scoring/              # Python scoring microservice
│   ├── app/
│   │   ├── main.py       # FastAPI app
│   │   └── config.py     # Settings
│   ├── Dockerfile
│   └── requirements.txt
├── mobile/               # React Native app (Expo)
├── docker-compose.yml
├── .env.example
└── .github/workflows/    # CI pipeline
```

## Tech stack

| Layer | Choice |
|-------|--------|
| Mobile | React Native (Expo) |
| Backend | Node.js + Express |
| Scoring | Python + FastAPI |
| Database | PostgreSQL + PostGIS |
| Cache | Redis |
| Jobs | BullMQ |
| Auth | Supabase Auth |
| Subscriptions | RevenueCat |

## Features

**Free tier:** AQI-scored routes, live heatmap, current air quality, save 3 routes, ride logging, weekly exposure summary, best time to ride, hazardous air alerts.

**Premium:** 48-hour forecast routing, "Why this route?" breakdown, personalized exposure tracking, unlimited saved routes with tags, detailed ride analytics, 7-day departure forecast, custom scoring weights, monthly health report, group ride sharing.

## License

Private — not for redistribution.
