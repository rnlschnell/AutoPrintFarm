# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**This is the development repository for the next-generation ESP32 + Cloud architecture.**

AutoPrintFarm is the evolution of PrintFarmSoftware, migrating from a Raspberry Pi-based system to a cloud-native architecture using ESP32 hubs and Cloudflare services. The current Pi system (at 192.168.4.45) remains the production system - this repo is for developing the cloud migration.

### Architecture Overview
- **Cloud Backend**: Cloudflare Workers (API), Durable Objects (WebSocket/state), D1 (database), R2 (file storage)
- **Edge Hardware**: ESP32-S3 hubs bridge local printers to cloud via WebSocket
- **Frontend**: React 18 + TypeScript + Vite + shadcn/ui (deployed to Cloudflare Pages)
- **Printers**: Bambu Lab printers communicate with ESP32 hubs via local MQTT + FTP

### Key Documentation
- `PRINTFARM_CLOUD_ARCHITECTURE.md` - **Primary reference** for cloud architecture, complete D1 schema, and all features
- `PRINTFARM_CURRENT_ARCHITECTURE_AND_MIGRATION.md` - Current Pi system architecture and migration mapping
- `ESP32_CLOUD_ARCHITECTURE_SPECIFICATION.md` - Detailed ESP32 firmware and hub specifications

## Development Workflow

**This repo is the source of truth for cloud/ESP32 development.** Edit files directly in this repo.

### Project Structure (Target)
```
AutoPrintFarm/
├── cloud/                    # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts         # Hono app entry point
│   │   ├── routes/          # API routes (auth, printers, jobs, files, etc.)
│   │   ├── durable-objects/ # HubConnection, DashboardBroadcast
│   │   ├── middleware/      # Auth, tenant scoping
│   │   ├── lib/             # D1, R2, crypto helpers
│   │   ├── queues/          # Background job handlers
│   │   └── types/           # TypeScript types
│   ├── migrations/          # D1 schema migrations
│   └── wrangler.toml        # Cloudflare configuration
├── firmware/                 # ESP32 hub firmware
│   ├── src/                 # C source files
│   ├── include/             # Header files
│   └── platformio.ini       # PlatformIO configuration
├── frontend/                 # React frontend (existing, to be migrated)
│   ├── src/
│   │   ├── pages/           # Route components
│   │   ├── components/      # UI components
│   │   ├── hooks/           # Custom hooks
│   │   ├── services/        # API clients
│   │   └── contexts/        # React contexts
│   └── package.json
└── docs/                     # Additional documentation
```

### Common Development Commands

#### Cloud Workers (Cloudflare)
```bash
cd cloud
npm install
npm run dev                  # Local development server (wrangler dev)
npm run deploy               # Deploy to Cloudflare
wrangler d1 migrations apply printfarm  # Apply database migrations
wrangler d1 execute printfarm --local --file=migrations/0001_initial.sql  # Run migration locally
```

#### ESP32 Firmware (PlatformIO)
```bash
cd firmware
pio run                      # Build firmware
pio run -t upload            # Flash to ESP32
pio device monitor           # Serial monitor
```

#### Frontend
```bash
cd frontend
npm install
npm run dev                  # Dev server
npm run build                # Production build
npm run lint                 # ESLint
npx tsc --noEmit            # Type checking
```

## Critical Development Principles

### 1. This Repo is for Cloud Architecture
This is NOT the production Pi system. Changes here don't affect the running system at 192.168.4.45.

### 2. Reference the Architecture Docs
Before making changes, read the relevant architecture docs:
- **Schema changes**: See `PRINTFARM_CLOUD_ARCHITECTURE.md` for complete D1 schema
- **API changes**: See API structure in `PRINTFARM_CLOUD_ARCHITECTURE.md`
- **ESP32 changes**: See `ESP32_CLOUD_ARCHITECTURE_SPECIFICATION.md`

### 3. Follow Existing Patterns
- Use `tenant_id` for multi-tenancy (not `organization_id`)
- API routes use `/api/v1/` prefix
- Durable Objects: `HubConnection` (per hub), `DashboardBroadcast` (per tenant)
- All timestamps stored as INTEGER (Unix epoch) in D1

### 4. Test Locally First
- Use `wrangler dev` for Workers
- Use `wrangler d1 execute --local` for D1 queries
- Use PlatformIO for ESP32 firmware testing

## Feature Overview

The cloud architecture supports all features from the current Pi system:

### Core Features
- **Printers**: CRUD, status tracking, maintenance, connection management
- **Print Jobs**: Queue management, progress tracking, job history
- **Print Files**: 3MF upload, metadata extraction, thumbnails
- **Products & SKUs**: Product catalog with color/material variants
- **Inventory**: Stock levels, low-stock alerts, finished goods tracking

### Workflow Features
- **Worklist Tasks**: Task management (assembly, filament change, collection, maintenance, quality check)
- **Assembly Tasks**: Post-print assembly tracking
- **Orders**: Shopify integration, manual orders, fulfillment tracking

### Supporting Features
- **Color Presets**: Filament color management
- **Build Plate Types**: Plate type presets
- **Wiki/Documentation**: Internal knowledge base
- **Cameras**: Printer camera feeds (Bambu, IP, USB)
- **Automation Rules**: Event-driven automation
- **Analytics**: Reports and dashboards

## Printer Communication

The ESP32 hub supports multiple printer communication protocols:

### Bambu Lab Printers (Primary)
- **MQTT over TLS** (port 8883): Status updates and commands
- **FTP over TLS** (port 990): File transfers
- Topics: `device/{serial}/report` (subscribe), `device/{serial}/request` (publish)

### Future Support
- **Prusa**: HTTP REST API (PrusaLink)
- **OctoPrint**: HTTP API
- **Klipper**: Moonraker API

## Database Schema

The complete D1 schema is documented in `PRINTFARM_CLOUD_ARCHITECTURE.md`. Key tables:

| Table | Purpose |
|-------|---------|
| `tenants` | Multi-tenant organizations |
| `users` | User accounts |
| `tenant_members` | User-tenant membership with roles |
| `hubs` | ESP32 hub registration |
| `printers` | Printer configuration and status |
| `products` | Product catalog |
| `product_skus` | Product variants (color/material) |
| `print_files` | 3MF file metadata |
| `print_jobs` | Print job queue and history |
| `finished_goods` | Completed inventory |
| `assembly_tasks` | Post-print assembly tasks |
| `worklist_tasks` | General task management |
| `orders` | Customer orders |
| `order_items` | Order line items |
| `wiki_articles` | Documentation articles |
| `cameras` | Camera configurations |
| `automation_rules` | Event-driven automation |
| `color_presets` | Filament colors |
| `build_plate_types` | Plate type presets |
| `audit_log` | Action audit trail |
| `printer_failures` | Failure tracking |
| `sync_logs` | Debug/sync logging |

## Authentication

The system is designed to work with multiple auth providers:
- **Supabase Auth**: Managed authentication with social logins
- **Better Auth**: Self-hosted auth with full control
- **Custom JWT**: Roll your own with D1 user storage

Auth is abstracted behind a service interface. JWT tokens are used for API authentication with role-based access control (owner, admin, operator, viewer).

## WebSocket Protocols

### Hub ↔ Cloud (`/ws/hub/:id`)
```json
// Hub → Cloud
{"type": "hub_hello", "hub_id": "...", "firmware": "1.0.0"}
{"type": "printer_status", "printer_id": "...", "status": {...}}
{"type": "command_ack", "command_id": "...", "success": true}

// Cloud → Hub
{"type": "configure_printer", "command_id": "...", "action": "add", "printer": {...}}
{"type": "print_command", "command_id": "...", "printer_id": "...", "action": "start", "file_url": "..."}
```

### Dashboard WebSocket (`/ws/dashboard`)
```json
// Client → Server
{"type": "auth", "token": "jwt_token"}
{"type": "subscribe", "printers": ["id1", "id2"]}

// Server → Client
{"type": "printer_status", "printer_id": "...", "status": "printing", "progress": 45}
{"type": "job_update", "job_id": "...", "status": "completed"}
{"type": "hub_status", "hub_id": "...", "is_online": true}
```
