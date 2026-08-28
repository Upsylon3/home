# Setup

## Requirements

- Docker + Docker Compose
- Node.js + npm for development
- Android Studio / Android SDK for HomeSync development

## Docker

Create the environment file:

```bash
cp homecore/.env.example homecore/.env
```

Set a strong `JWT_SECRET`, then start the stack:

```bash
docker compose up --build -d
```

Open `http://localhost:8080`.

Useful commands:

```bash
docker compose down
docker compose logs -f
```

Run `npm install` and `npm test` from the repository root for local Node
development.

## Data

Docker volumes contain application data:

- `homecloud_data`
- `homemedia_data`
- `homenotes_data`
- `homesync_data`

The `backups/` directory is mounted into the backup service.

To remove containers and all named volumes:

```bash
docker compose down -v
```

Only do this when you intentionally want to delete stored data.

## Remote access

Port 8080 is HTTP only and is intended for a trusted local network. For remote
access, use a TLS reverse proxy or private VPN/overlay network.

## Troubleshooting

Check container state and logs with:

```bash
docker compose ps
docker compose logs
```

If you changed configuration or Dockerfiles, recreate the affected services:

```bash
docker compose up --build -d
```
