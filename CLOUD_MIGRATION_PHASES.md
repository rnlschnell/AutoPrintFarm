# PrintFarm Cloud Migration - Implementation Phases

This document breaks down the cloud migration into discrete, manageable phases. Each phase is designed to be completable in a single focused session. Use the checkboxes to track progress.

---

## Phase Overview

| Phase | Focus Area | Dependencies |
|-------|------------|--------------|
| 1 | Project Setup & Infrastructure | None |
| 2 | Database Schema (D1) | Phase 1 |
| 3 | Core API Foundation | Phase 2 |
| 4 | Authentication System | Phase 3 |
| 5 | Printer Management API | Phase 4 |
| 6 | Print Files & R2 Storage | Phase 4 |
| 7 | Print Jobs API | Phases 5, 6 |
| 8 | Products & SKUs API | Phase 4 |
| 9 | Inventory & Finished Goods API | Phase 8 |
| 10 | Orders & Shopify Integration | Phase 9 |
| 11 | Worklist & Assembly Tasks API | Phase 4 |
| 12 | Supporting Features API | Phase 4 |
| 13 | Hub WebSocket (Durable Objects) | Phase 5 |
| 14 | Dashboard WebSocket | Phase 13 |
| 15 | Background Queues | Phases 7, 10 |
| 16 | Frontend API Migration | Phases 3-12 |
| 17 | Frontend WebSocket Migration | Phases 13-14 |
| 18 | ESP32 Firmware - Core | Phase 13 |
| 19 | ESP32 Firmware - Printer Protocols | Phase 18 |
| 20 | ESP32 Firmware - File Transfer | Phase 19 |
| 21 | Integration Testing | Phases 1-20 |
| 22 | Data Migration Tools | Phase 21 |
| 23 | Deployment & Cutover | Phase 22 |

---

## Phase 1: Project Setup & Infrastructure

**Goal**: Set up Cloudflare account, project structure, and development environment.

### Cloudflare Account Setup
- [x] Create Cloudflare account (if not existing)
- [x] Set up Workers subscription (paid plan for Durable Objects)
- [x] Create D1 database named `printfarm` (ID: `6dd1d503-b892-44f7-bf54-377d384cb122`)
- [x] Create R2 bucket named `printfarm-files`
- [x] Create KV namespace for sessions/cache (ID: `b96a9e97bfa34295b0fe2d13fa4fdd95`)
- [x] Create required Queues (print-events, file-processing, notifications, shopify-sync)

### Project Structure
- [x] Create `cloud/` directory
- [x] Initialize npm project in `cloud/`
- [x] Install dependencies: `hono`, `@cloudflare/workers-types`, `zod`, `nanoid`
- [x] Create `wrangler.toml` with all bindings (D1, R2, KV, Queues, Durable Objects)
- [x] Create TypeScript configuration (`tsconfig.json`)
- [x] Set up directory structure:
  ```
  cloud/
  ├── src/
  │   ├── index.ts
  │   ├── routes/
  │   ├── durable-objects/
  │   ├── middleware/
  │   ├── lib/
  │   ├── queues/
  │   └── types/
  ├── migrations/
  ├── wrangler.toml
  ├── package.json
  └── tsconfig.json
  ```

### Firmware Project Structure
- [ ] Create `firmware/` directory (deferred to Phase 18)
- [ ] Initialize PlatformIO project (deferred to Phase 18)
- [ ] Create `platformio.ini` for ESP32-S3 (deferred to Phase 18)
- [ ] Set up directory structure (deferred to Phase 18):
  ```
  firmware/
  ├── src/
  ├── include/
  ├── lib/
  └── platformio.ini
  ```

### Verification
- [x] `wrangler dev` starts without errors
- [x] Can connect to D1 locally
- [ ] PlatformIO builds empty firmware (deferred to Phase 18)

---

## Phase 2: Database Schema (D1) ✅ COMPLETED

**Goal**: Create the complete D1 database schema matching the architecture spec.

**Completed**: 2025-01-22 - Created 8 migration files with 30 tables merged from Pi SQLite and Supabase schemas.

### Core Tables Migration
- [x] Create `migrations/0001_tenants_users.sql`:
  - `tenants` table
  - `users` table
  - `tenant_members` table (with indexes)

### Hub & Printer Tables
- [x] Create `migrations/0002_hubs_printers.sql`:
  - `hubs` table (with indexes)
  - `printers` table (with all 30+ columns from Pi SQLite merged)

### Products & Inventory Tables
- [x] Create `migrations/0003_products_inventory.sql`:
  - `products` table
  - `product_skus` table
  - `product_components` table
  - `color_presets` table
  - `build_plate_types` table
  - All related indexes

### Print Files & Jobs Tables
- [x] Create `migrations/0004_print_files_jobs.sql`:
  - `print_files` table (with 3MF metadata columns)
  - `print_file_versions` table
  - `print_jobs` table (with all denormalized columns from Pi)
  - All related indexes

### Finished Goods & Tasks Tables
- [x] Create `migrations/0005_finished_goods_tasks.sql`:
  - `finished_goods` table (with assembly tracking)
  - `assembly_tasks` table
  - `worklist_tasks` table
  - All related indexes

### Orders Tables
- [x] Create `migrations/0006_orders.sql`:
  - `orders` table (with fulfillment tracking)
  - `order_items` table
  - All related indexes

### Supporting Tables
- [x] Create `migrations/0007_supporting.sql`:
  - `wiki_articles` table
  - `cameras` table
  - `automation_rules` table
  - All related indexes

### Logging & Inventory Tables
- [x] Create `migrations/0008_logging_analytics.sql`:
  - `sync_logs` table
  - `audit_logs` table
  - `printer_failures` table
  - `daily_analytics` table
  - `material_usage_history` table
  - `filament_inventory` table
  - `packaging_inventory` table
  - `accessories_inventory` table
  - `printer_parts_inventory` table
  - All related indexes

### Verification
- [x] All migrations apply successfully: `wrangler d1 migrations apply printfarm --local`
- [x] Schema merged from both Pi SQLite and Supabase PostgreSQL
- [x] All foreign keys and indexes created (30 tables total)

---

## Phase 3: Core API Foundation ✅ COMPLETED

**Goal**: Set up Hono app, middleware, and helper libraries.

**Completed**: 2025-01-22 - Created comprehensive foundation with types, helpers, and middleware.

### Hono App Setup
- [x] Create `src/index.ts` with Hono app initialization
- [x] Configure CORS middleware
- [x] Set up error handling middleware
- [x] Create environment types in `src/types/env.ts`
- [x] Export Durable Object classes (stubs for now)

### TypeScript Types
- [x] Create `src/types/index.ts` with all entity types:
  - Tenant, User, TenantMember
  - Hub, Printer
  - Product, ProductSku, ColorPreset, BuildPlateType
  - PrintFile, PrintFileVersion, PrintJob
  - FinishedGood, AssemblyTask, WorklistTask
  - Order, OrderItem
  - WikiArticle, Camera, AutomationRule
  - AuditLog, SyncLog, PrinterFailure
  - DailyAnalytics, MaterialUsageHistory
  - FilamentInventory, PackagingInventory, AccessoriesInventory, PrinterPartsInventory
- [x] Create request/response types for API endpoints (ApiResponse, PaginationParams, ListResponse)
- [x] Create WebSocket message types (Hub↔Cloud and Dashboard protocols)

### Database Helpers
- [x] Create `src/lib/db.ts`:
  - Generic query helpers (query, queryOne, queryOneOrFail, insert, update, deleteRow)
  - Batch operations (transaction-like behavior)
  - Tenant-scoped query builder (tenantQuery, tenantQueryOne, withTenantScope)
  - Query builders (buildSelect, buildInsert, buildUpdate)
  - Pagination helpers (paginate, getCount)
  - Error handling utilities (DatabaseError, NotFoundError, UniqueConstraintError, ForeignKeyError)

### R2 Helpers
- [x] Create `src/lib/r2.ts`:
  - Presigned URL generation (generateSignedUrlToken, verifySignedUrlToken)
  - Upload helpers (uploadFile, uploadTenantFile)
  - Download helpers (downloadFile, downloadFileAsBuffer, downloadFileAsText)
  - Delete helpers (deleteFile, deleteFiles, deleteByPrefix)
  - List helpers (listFiles, listTenantFiles)
  - Tenant-scoped path builders (tenantPath, printFilePath, thumbnailPath, productImagePath)
  - Content type utilities (getContentType, getExtension)

### Utility Helpers
- [x] Create `src/lib/crypto.ts`:
  - AES-256-GCM encryption/decryption (encryptAES256GCM, decryptAES256GCM)
  - UUID generation (generateUUID, generateId, generateShortId, generateHex)
  - HMAC helpers (generateHMAC, verifyHMAC)
  - Hub authentication (generateHubSignature, verifyHubSignature)
  - Password hashing (hashPassword, verifyPassword using PBKDF2)
  - SHA-256 hashing (sha256, sha256Hex)
  - API key generation (generateSecureToken, generateApiKey)

### Middleware
- [x] Create `src/middleware/cors.ts` - Environment-aware CORS handling
- [x] Create `src/middleware/errors.ts` - Global error handler with API error classes
- [x] Create `src/middleware/logger.ts` - Request logging with timing and request IDs

### Routes
- [x] Create `src/routes/index.ts` - Route aggregator
- [x] Create `src/routes/health.ts` - Health check endpoints (/health, /health/detailed, /health/ready, /health/live)

### Verification
- [x] Health check endpoint returns 200
- [x] Type checking passes: `npx tsc --noEmit`
- [x] Server starts successfully: `npx wrangler dev`

---

## Phase 4: Authentication System ✅ COMPLETED

**Goal**: Implement JWT-based authentication and tenant middleware.

**Completed**: 2025-11-23 - Implemented Better Auth integration with full multi-tenancy support.

### Auth Service Interface
- [x] Create `src/lib/auth.ts`:
  - Better Auth configured as auth provider
  - Session-based authentication with secure cookies
  - Password hashing (PBKDF2 via Better Auth)
  - Automatic session refresh handling
  - Field mappings for snake_case schema

### Auth Middleware
- [x] Create `src/middleware/auth.ts`:
  - `requireAuth()` - Session validation middleware
  - `optionalAuth()` - Optional auth attachment
  - `getSession()` - Helper to fetch current session
  - User extracted and attached to context

### Tenant Middleware
- [x] Create `src/middleware/tenant.ts`:
  - Extract tenant from X-Tenant-ID header or query param
  - Validate user membership in tenant
  - Attach tenant_id to context
  - `requireRoles()` - Role-based permission checking (owner, admin, operator, viewer)

### Auth Routes
- [x] Create `src/routes/auth.ts` (via Better Auth):
  - `POST /api/v1/auth/sign-up/email` - User registration
  - `POST /api/v1/auth/sign-in/email` - User login
  - `POST /api/v1/auth/sign-out` - User logout
  - `GET /api/v1/auth/get-session` - Get current session
  - `POST /api/v1/auth/forget-password` - Request password reset
  - `POST /api/v1/auth/reset-password` - Reset password with token

### Tenant Routes
- [x] Create `src/routes/tenants.ts`:
  - `POST /api/v1/tenants` - Create tenant (user becomes owner)
  - `GET /api/v1/tenants` - List user's tenants
  - `GET /api/v1/tenants/:id` - Get tenant details
  - `PUT /api/v1/tenants/:id` - Update tenant (admin/owner only)
  - `GET /api/v1/tenants/:id/members` - List tenant members
  - `POST /api/v1/tenants/:id/members` - Invite member (admin/owner only)
  - `PUT /api/v1/tenants/:id/members/:userId` - Update member role (owner only)
  - `DELETE /api/v1/tenants/:id/members/:userId` - Remove member (admin/owner only)

### Verification
- [x] Can register new user
- [x] Can login and receive session token
- [x] Protected routes reject invalid tokens (returns 401)
- [x] Tenant middleware correctly scopes queries

---

## Phase 5: Printer Management API

**Goal**: Implement complete printer CRUD and status management.

### Printer Routes
- [x] Create `src/routes/printers.ts`:
  - `GET /api/v1/printers` - List printers (tenant-scoped)
  - `GET /api/v1/printers/:id` - Get printer details
  - `POST /api/v1/printers` - Create printer
  - `PUT /api/v1/printers/:id` - Update printer
  - `DELETE /api/v1/printers/:id` - Delete printer
  - `PUT /api/v1/printers/:id/status` - Update printer status
  - `PUT /api/v1/printers/:id/maintenance` - Toggle maintenance mode
  - `PUT /api/v1/printers/:id/cleared` - Mark bed cleared
  - `PUT /api/v1/printers/:id/order` - Update sort order (batch)

### Printer Commands (routed to hub)
- [x] Add command endpoints:
  - `POST /api/v1/printers/:id/connect` - Initiate connection
  - `POST /api/v1/printers/:id/disconnect` - Close connection
  - `POST /api/v1/printers/:id/control` - Send control command (pause/resume/stop)

### Hub Management Routes
- [x] Create `src/routes/hubs.ts`:
  - `GET /api/v1/hubs` - List hubs (tenant-scoped)
  - `GET /api/v1/hubs/:id` - Get hub details
  - `POST /api/v1/hubs/claim` - Claim unclaimed hub
  - `PUT /api/v1/hubs/:id` - Update hub (name, etc.)
  - `DELETE /api/v1/hubs/:id` - Unclaim/release hub

### Verification
- [x] CRUD operations work correctly
- [x] Tenant isolation enforced
- [x] Printer access codes encrypted at rest
- [x] Hub claim flow works

---

## Phase 6: Print Files & R2 Storage ✅ COMPLETED

**Goal**: Implement file upload, metadata extraction, and thumbnail generation.

**Completed**: 2025-01-23 - Implemented complete file management with upload, 3MF parsing, thumbnail extraction, and queue processing.

**Verified**: 2025-11-23 - Manual testing confirmed all functionality works correctly.

### File Upload Flow
- [x] Create `src/routes/files.ts`:
  - `GET /api/v1/files` - List print files (tenant-scoped)
  - `GET /api/v1/files/:id` - Get file metadata
  - `POST /api/v1/files/upload-url` - Get presigned upload URL
  - `PUT /api/v1/files/upload/:token` - Direct upload with token
  - `POST /api/v1/files` - Create file record (after upload)
  - `PUT /api/v1/files/:id` - Update file metadata
  - `DELETE /api/v1/files/:id` - Delete file (from R2 and D1)
  - `GET /api/v1/files/:id/download-url` - Get presigned download URL
  - `GET /api/v1/files/download/:token` - Direct download with token
  - `GET /api/v1/files/:id/thumbnail` - Get thumbnail image
  - `GET /api/v1/files/:id/versions` - List file versions
  - `POST /api/v1/files/:id/versions` - Add new version (max 3)
  - `PUT /api/v1/files/:id/versions/:versionNumber/current` - Set current version
  - `DELETE /api/v1/files/:id/versions/:versionNumber` - Delete version

### Metadata Extraction
- [x] Create `src/lib/threemf.ts`:
  - Parse 3MF file structure (ZIP with XML)
  - Extract print time, filament usage, layer count
  - Extract printer model compatibility
  - Extract bed type requirements
  - Extract filament type, nozzle diameter, print profile

### Thumbnail Generation
- [x] Create thumbnail extraction from 3MF (embedded thumbnails)
- [x] Store thumbnails in R2 at `{tenant_id}/thumbnails/{file_id}.png`
- [x] Return thumbnail URL with file metadata

### File Processing Queue
- [x] Create `src/queues/file-processing.ts`:
  - Handle `extract_metadata` messages
  - Handle `generate_thumbnail` messages
  - Handle `validate_file` messages
  - Download file from R2
  - Extract metadata using threemf parser
  - Extract/store thumbnail
  - Update file record in D1
- [x] Configure queue consumer in `wrangler.toml`
- [x] Export queue handler from `src/index.ts`

### Dependencies Added
- [x] `fflate` - ZIP file parsing for 3MF files

### Verification
- [x] TypeScript compilation passes
- [x] Can upload 3MF file via presigned URL
- [x] Metadata extracted correctly (3MF parser verified with Bambu Lab files)
- [x] Thumbnail available (extraction working, verified with test files)
- [x] Files deleted from R2 when record deleted

### Notes from Verification Testing (2025-11-23)
- Added `ENCRYPTION_KEY` to `.dev.vars` for signed URL token generation
- Added `http://127.0.0.1:8787` to `TRUSTED_ORIGINS` for local testing
- Fixed 3MF metadata parsing to handle Bambu Lab XML format with `<metadata key="..." value="..."/>` attributes
- Queue processing requires production environment or explicit triggering in local dev mode
- Test script created at `cloud/test-phase6.mjs` for future regression testing

---

## Phase 7: Print Jobs API

**Goal**: Implement print job queue management and status tracking.

### Print Job Routes
- [ ] Create `src/routes/jobs.ts`:
  - `GET /api/v1/jobs` - List jobs (with filters: status, printer, date range)
  - `GET /api/v1/jobs/:id` - Get job details
  - `POST /api/v1/jobs` - Create/queue new job
  - `PUT /api/v1/jobs/:id` - Update job
  - `DELETE /api/v1/jobs/:id` - Cancel/delete job
  - `POST /api/v1/jobs/:id/assign` - Assign job to printer
  - `POST /api/v1/jobs/:id/start` - Start print (send to hub)
  - `POST /api/v1/jobs/:id/pause` - Pause print
  - `POST /api/v1/jobs/:id/resume` - Resume print
  - `POST /api/v1/jobs/:id/cancel` - Cancel print
  - `POST /api/v1/jobs/:id/complete` - Mark as completed

### Job Queue Logic
- [ ] Create `src/lib/job-queue.ts`:
  - Auto-assign jobs to idle printers (matching color/material)
  - Priority-based queue ordering
  - Job state machine validation
  - Conflict detection (printer already printing)

### Job History & Stats
- [ ] Add job statistics endpoints:
  - `GET /api/v1/jobs/stats` - Job counts by status
  - `GET /api/v1/jobs/history` - Completed job history with pagination

### Print Events Queue
- [ ] Create `src/queues/print-events.ts`:
  - Handle job completion events
  - Update inventory on successful print
  - Create worklist tasks (collection, filament change)
  - Trigger automation rules

### Verification
- [ ] Jobs created with correct defaults
- [ ] State transitions validated
- [ ] Auto-assignment works correctly
- [ ] History queryable with filters

---

## Phase 8: Products & SKUs API

**Goal**: Implement product catalog management.

### Product Routes
- [ ] Create `src/routes/products.ts`:
  - `GET /api/v1/products` - List products (with search, category filter)
  - `GET /api/v1/products/:id` - Get product with SKUs
  - `POST /api/v1/products` - Create product
  - `PUT /api/v1/products/:id` - Update product
  - `DELETE /api/v1/products/:id` - Delete product (cascade SKUs)
  - `POST /api/v1/products/:id/image` - Upload product image

### SKU Routes
- [ ] Create `src/routes/skus.ts`:
  - `GET /api/v1/products/:productId/skus` - List SKUs for product
  - `GET /api/v1/skus/:id` - Get SKU details
  - `POST /api/v1/products/:productId/skus` - Create SKU
  - `PUT /api/v1/skus/:id` - Update SKU
  - `DELETE /api/v1/skus/:id` - Delete SKU

### Color Preset Routes
- [ ] Create `src/routes/colors.ts`:
  - `GET /api/v1/colors` - List color presets
  - `POST /api/v1/colors` - Create color preset
  - `PUT /api/v1/colors/:id` - Update color preset
  - `DELETE /api/v1/colors/:id` - Delete color preset

### Build Plate Type Routes
- [ ] Create `src/routes/plates.ts`:
  - `GET /api/v1/plates` - List plate types
  - `POST /api/v1/plates` - Create plate type
  - `PUT /api/v1/plates/:id` - Update plate type
  - `DELETE /api/v1/plates/:id` - Delete plate type

### Verification
- [ ] Products CRUD works
- [ ] SKU creation with color/material validation
- [ ] Color presets used in dropdowns
- [ ] Product images stored in R2

---

## Phase 9: Inventory & Finished Goods API

**Goal**: Implement inventory tracking and stock management.

### Finished Goods Routes
- [ ] Create `src/routes/inventory.ts`:
  - `GET /api/v1/inventory` - List finished goods (with low stock filter)
  - `GET /api/v1/inventory/:id` - Get finished good details
  - `POST /api/v1/inventory` - Create finished good record
  - `PUT /api/v1/inventory/:id` - Update stock levels
  - `POST /api/v1/inventory/:id/adjust` - Adjust stock (increment/decrement)
  - `DELETE /api/v1/inventory/:id` - Delete finished good

### Stock Operations
- [ ] Create `src/lib/inventory.ts`:
  - Increment stock on print completion
  - Decrement stock on order fulfillment
  - Low stock alert detection
  - Assembly tracking (needs assembly vs assembled)

### Inventory Alerts
- [ ] Add alert endpoints:
  - `GET /api/v1/inventory/alerts` - Get low stock alerts
  - `PUT /api/v1/inventory/:id/threshold` - Update low stock threshold

### Verification
- [ ] Stock increments on job completion
- [ ] Stock decrements on fulfillment
- [ ] Low stock alerts trigger correctly
- [ ] Assembly quantities tracked

---

## Phase 10: Orders & Shopify Integration

**Goal**: Implement order management and Shopify sync.

### Order Routes
- [ ] Create `src/routes/orders.ts`:
  - `GET /api/v1/orders` - List orders (with status filter)
  - `GET /api/v1/orders/:id` - Get order with items
  - `POST /api/v1/orders` - Create manual order
  - `PUT /api/v1/orders/:id` - Update order
  - `POST /api/v1/orders/:id/fulfill` - Mark as fulfilled
  - `DELETE /api/v1/orders/:id` - Cancel order

### Shopify Integration
- [ ] Create `src/routes/integrations.ts`:
  - `GET /api/v1/integrations/shopify/status` - Connection status
  - `POST /api/v1/integrations/shopify/connect` - Save credentials
  - `POST /api/v1/integrations/shopify/disconnect` - Remove connection
  - `POST /api/v1/integrations/shopify/sync` - Manual sync trigger

### Shopify Webhooks
- [ ] Create webhook handlers:
  - `POST /webhooks/shopify/orders/create` - New order
  - `POST /webhooks/shopify/orders/updated` - Order updated
  - `POST /webhooks/shopify/orders/cancelled` - Order cancelled

### Shopify Sync Queue
- [ ] Create `src/queues/shopify-sync.ts`:
  - Import new orders from Shopify
  - Match SKUs to products
  - Update fulfillment status back to Shopify
  - Sync inventory levels

### Verification
- [ ] Manual orders create correctly
- [ ] Shopify webhook creates orders
- [ ] Fulfillment syncs back to Shopify
- [ ] SKU matching works

---

## Phase 11: Worklist & Assembly Tasks API

**Goal**: Implement task management for operators.

### Worklist Routes
- [ ] Create `src/routes/worklist.ts`:
  - `GET /api/v1/worklist` - List tasks (with type/status filters)
  - `GET /api/v1/worklist/:id` - Get task details
  - `POST /api/v1/worklist` - Create task
  - `PUT /api/v1/worklist/:id` - Update task
  - `PUT /api/v1/worklist/:id/status` - Change task status
  - `PUT /api/v1/worklist/:id/assign` - Assign to user
  - `DELETE /api/v1/worklist/:id` - Delete task

### Assembly Task Routes
- [ ] Create `src/routes/assembly.ts`:
  - `GET /api/v1/assembly` - List assembly tasks
  - `GET /api/v1/assembly/:id` - Get assembly task
  - `POST /api/v1/assembly` - Create assembly task
  - `PUT /api/v1/assembly/:id` - Update assembly task
  - `POST /api/v1/assembly/:id/complete` - Complete assembly

### Auto-Generated Tasks
- [ ] Create `src/lib/tasks.ts`:
  - Auto-create collection task when print completes
  - Auto-create filament change task when color changes
  - Auto-create assembly task for products requiring assembly
  - Auto-create quality check tasks

### Verification
- [ ] Tasks appear in worklist
- [ ] Status transitions work
- [ ] Auto-generated tasks created at right time
- [ ] Assignment and completion tracked

---

## Phase 12: Supporting Features API

**Goal**: Implement wiki, cameras, and automation.

### Wiki Routes
- [ ] Create `src/routes/wiki.ts`:
  - `GET /api/v1/wiki` - List articles (with category filter)
  - `GET /api/v1/wiki/:slug` - Get article by slug
  - `POST /api/v1/wiki` - Create article
  - `PUT /api/v1/wiki/:id` - Update article
  - `DELETE /api/v1/wiki/:id` - Delete article

### Camera Routes
- [ ] Create `src/routes/cameras.ts`:
  - `GET /api/v1/cameras` - List cameras
  - `GET /api/v1/cameras/:id` - Get camera details
  - `POST /api/v1/cameras` - Create camera
  - `PUT /api/v1/cameras/:id` - Update camera
  - `DELETE /api/v1/cameras/:id` - Delete camera
  - `GET /api/v1/cameras/:id/snapshot` - Get latest snapshot

### Automation Routes
- [ ] Create `src/routes/automation.ts`:
  - `GET /api/v1/automation` - List rules
  - `GET /api/v1/automation/:id` - Get rule details
  - `POST /api/v1/automation` - Create rule
  - `PUT /api/v1/automation/:id` - Update rule
  - `PUT /api/v1/automation/:id/toggle` - Enable/disable rule
  - `DELETE /api/v1/automation/:id` - Delete rule

### Analytics Routes
- [ ] Create `src/routes/analytics.ts`:
  - `GET /api/v1/analytics/overview` - Dashboard stats
  - `GET /api/v1/analytics/production` - Production metrics
  - `GET /api/v1/analytics/printers` - Printer utilization
  - `GET /api/v1/analytics/failures` - Failure analysis
  - `GET /api/v1/analytics/inventory` - Inventory turnover

### Verification
- [ ] Wiki articles render markdown
- [ ] Camera snapshots accessible
- [ ] Automation rules can be toggled
- [ ] Analytics queries performant

---

## Phase 13: Hub WebSocket (Durable Objects)

**Goal**: Implement HubConnection Durable Object for ESP32 communication.

### HubConnection Durable Object
- [ ] Create `src/durable-objects/hub-connection.ts`:
  - WebSocket handling for hub connections
  - Hub authentication (HMAC signature verification)
  - State: hub_id, tenant_id, connected printers, pending commands
  - Message parsing and validation

### Hub → Cloud Messages
- [ ] Implement handlers for:
  - `hub_hello` - Hub connection initialization
  - `printer_status` - Printer status updates
  - `file_progress` - File transfer progress
  - `command_ack` - Command acknowledgment
  - `printer_discovered` - New printer discovery results

### Cloud → Hub Messages
- [ ] Implement command sending:
  - `configure_printer` - Add/remove printer from hub
  - `print_command` - Start print (with presigned file URL)
  - `printer_command` - Control commands (pause/resume/stop)
  - `discover_printers` - Trigger printer discovery

### State Management
- [ ] Implement alarm-based features:
  - Heartbeat checking (mark offline if no response)
  - Pending command timeout
  - State persistence to D1

### WebSocket Route
- [ ] Create `ws/hub/:id` route in `src/index.ts`:
  - Upgrade HTTP to WebSocket
  - Route to HubConnection Durable Object
  - Handle connection errors

### Verification
- [ ] Hub can connect via WebSocket
- [ ] Messages parsed correctly
- [ ] Commands sent and acknowledged
- [ ] Offline detection works

---

## Phase 14: Dashboard WebSocket

**Goal**: Implement DashboardBroadcast Durable Object for real-time UI updates.

### DashboardBroadcast Durable Object
- [ ] Create `src/durable-objects/dashboard-broadcast.ts`:
  - Multi-client WebSocket connections
  - JWT authentication on connect
  - State: connected users, subscriptions
  - Message broadcasting

### Authentication Flow
- [ ] Implement auth message handling:
  - Validate JWT token
  - Extract user and tenant
  - Subscribe to tenant updates
  - Send auth_success/auth_error response

### Broadcast Messages
- [ ] Implement broadcasting for:
  - `printer_status` - Real-time printer updates
  - `job_update` - Job status changes
  - `hub_status` - Hub online/offline
  - `inventory_alert` - Low stock notifications
  - `new_order` - Order received notification

### Subscription Management
- [ ] Implement client subscriptions:
  - Subscribe to specific printers
  - Unsubscribe from printers
  - Receive only relevant updates

### HubConnection Integration
- [ ] Connect HubConnection to DashboardBroadcast:
  - Forward printer status updates
  - Forward job progress updates
  - Forward hub connection status

### WebSocket Route
- [ ] Create `ws/dashboard` route in `src/index.ts`:
  - Upgrade HTTP to WebSocket
  - Route to DashboardBroadcast (by tenant)
  - Handle connection errors

### Verification
- [ ] Dashboard connects via WebSocket
- [ ] Auth succeeds with valid JWT
- [ ] Receives real-time printer updates
- [ ] Multiple clients receive broadcasts

---

## Phase 15: Background Queues

**Goal**: Implement all queue consumers for async processing.

### Print Events Queue Consumer
- [ ] Finalize `src/queues/print-events.ts`:
  - Update finished goods on completion
  - Create worklist tasks
  - Trigger automation rules
  - Send notifications

### File Processing Queue Consumer
- [ ] Finalize `src/queues/file-processing.ts`:
  - Extract 3MF metadata
  - Generate thumbnails
  - Update file record

### Notifications Queue Consumer
- [ ] Create `src/queues/notifications.ts`:
  - Email notifications (via external service)
  - Webhook deliveries
  - Retry logic for failures

### Shopify Sync Queue Consumer
- [ ] Finalize `src/queues/shopify-sync.ts`:
  - Batch import orders
  - Update fulfillment status
  - Sync inventory levels
  - Handle rate limiting

### Queue Configuration
- [ ] Update `wrangler.toml` with queue consumers
- [ ] Configure batch sizes and timeouts
- [ ] Set up dead letter queues

### Verification
- [ ] Print completion triggers inventory update
- [ ] File uploads trigger metadata extraction
- [ ] Notifications delivered successfully
- [ ] Shopify sync handles errors gracefully

---

## Phase 16: Frontend API Migration

**Goal**: Update frontend services to use new cloud API.

### API Client Setup
- [ ] Create new API client configuration:
  - Base URL configuration (production vs development)
  - JWT token management
  - Automatic token refresh
  - Error handling standardization

### Auth Integration
- [ ] Update `AuthContext.tsx`:
  - Login/logout via new API
  - Token storage and refresh
  - Multi-tenant support

### Printer Services
- [ ] Update `usePrinters.ts`:
  - Fetch from `/api/v1/printers`
  - CRUD operations
  - Status updates

### Job Services
- [ ] Update `usePrintJobs.ts`:
  - Fetch from `/api/v1/jobs`
  - Create/update jobs
  - Job control (start/pause/cancel)

### File Services
- [ ] Update `usePrintFiles.ts`:
  - Upload via presigned URL
  - Metadata display
  - Thumbnail display

### Product Services
- [ ] Update `useProductsNew.ts`:
  - Fetch from `/api/v1/products`
  - SKU management
  - Image uploads

### Inventory Services
- [ ] Update inventory hooks:
  - Fetch from `/api/v1/inventory`
  - Stock adjustments
  - Low stock alerts

### Order Services
- [ ] Update `useOrders.ts`:
  - Fetch from `/api/v1/orders`
  - Manual order creation
  - Fulfillment updates

### Task Services
- [ ] Update `useWorklistTasks.ts`:
  - Fetch from `/api/v1/worklist`
  - Status updates
  - Assignment

### Verification
- [ ] All pages load data correctly
- [ ] CRUD operations work
- [ ] Error handling displays correctly
- [ ] Loading states work

---

## Phase 17: Frontend WebSocket Migration

**Goal**: Update frontend to use new WebSocket connections.

### WebSocket Client
- [ ] Update `useWebSocket.ts`:
  - Connect to `/ws/dashboard`
  - JWT authentication message
  - Reconnection logic
  - Message type handling

### Real-Time Updates
- [ ] Implement update handlers:
  - `printer_status` → Update printer list
  - `job_update` → Update job list/details
  - `hub_status` → Update hub indicators
  - `inventory_alert` → Show notification
  - `new_order` → Show notification and update list

### Subscription Management
- [ ] Implement subscription UI:
  - Subscribe to relevant printers on page load
  - Unsubscribe when navigating away
  - Optimize bandwidth

### Notification Integration
- [ ] Connect WebSocket events to toast notifications:
  - Print complete notifications
  - Error notifications
  - Order received notifications

### Verification
- [ ] WebSocket connects on page load
- [ ] Printer status updates in real-time
- [ ] Job progress shows without refresh
- [ ] Notifications display correctly

---

## Phase 18: ESP32 Firmware - Core

**Goal**: Implement core ESP32 firmware foundation.

### WiFi Manager
- [ ] Create `src/wifi_manager.c`:
  - NVS storage for credentials
  - Auto-connect on boot
  - Reconnection with exponential backoff
  - Captive portal for initial setup

### Configuration Storage
- [ ] Create `src/config_storage.c`:
  - NVS read/write helpers
  - Store hub UUID and secret
  - Store cloud URL
  - Factory reset capability

### WebSocket Client
- [ ] Create `src/websocket_client.c`:
  - Connect to cloud URL
  - TLS certificate handling
  - Binary message support
  - Heartbeat (ping/pong)
  - Auto-reconnect on disconnect

### Message Protocol
- [ ] Create `include/messages.h`:
  - Message type definitions
  - JSON parsing helpers
  - Message building helpers

### Hub Hello Flow
- [ ] Implement connection initialization:
  - Send `hub_hello` on connect
  - Include firmware version
  - Handle welcome response
  - Store tenant_id in memory

### OTA Updater
- [ ] Create `src/ota_updater.c`:
  - Check firmware version on boot
  - Download from R2 URL
  - Dual-partition update
  - Rollback on failure

### Verification
- [ ] ESP32 connects to WiFi
- [ ] WebSocket connects to cloud
- [ ] Hub hello exchange works
- [ ] OTA update downloads and applies

---

## Phase 19: ESP32 Firmware - Printer Protocols

**Goal**: Implement Bambu Lab printer communication.

### Printer Discovery
- [ ] Create `src/printer_discovery.c`:
  - mDNS browsing for Bambu printers
  - SSDP discovery (optional)
  - Report discovered printers to cloud
  - Periodic re-scan

### Protocol Abstraction
- [ ] Create `src/protocol_manager.c`:
  - Protocol interface structure
  - Register protocol handlers
  - Route commands to correct protocol

### Bambu MQTT Client
- [ ] Create `src/bambu_mqtt.c`:
  - TLS connection to port 8883
  - Authentication with serial + access code
  - Subscribe to status topic
  - Parse status messages
  - Send commands (start, pause, resume, stop)

### Status Parsing
- [ ] Implement Bambu status parsing:
  - Print state (idle, printing, paused, etc.)
  - Progress percentage
  - Remaining time
  - Layer information
  - Temperature data
  - Error codes

### Command Handling
- [ ] Implement cloud command processing:
  - `configure_printer` - Add/remove printer
  - `printer_command` - Control commands
  - Send acknowledgments

### Verification
- [ ] Discovers local Bambu printers
- [ ] Connects to printer via MQTT
- [ ] Receives status updates
- [ ] Can pause/resume/stop print

---

## Phase 20: ESP32 Firmware - File Transfer

**Goal**: Implement file download and FTP upload to printers.

### HTTP Download
- [ ] Create `src/http_client.c`:
  - Download file from presigned R2 URL
  - Progress tracking
  - Chunked download (memory constraints)
  - Resume on failure

### Bambu FTP Client
- [ ] Create `src/bambu_ftp.c`:
  - FTPS connection to port 990
  - Authentication
  - Upload file to SD card
  - Progress reporting
  - Error handling

### Print Start Flow
- [ ] Implement `print_command` handler:
  - Receive file URL from cloud
  - Download file from R2
  - Upload to printer via FTP
  - Report progress to cloud
  - Send MQTT start command
  - Confirm print started

### Memory Management
- [ ] Implement efficient file handling:
  - Stream file (don't load entirely)
  - Use PSRAM for buffers
  - Clean up on completion/error

### Error Recovery
- [ ] Implement failure handling:
  - Retry downloads on network error
  - Retry FTP on connection failure
  - Report failures to cloud
  - Clean up partial transfers

### Verification
- [ ] Downloads file from R2
- [ ] Uploads file to printer
- [ ] Print starts successfully
- [ ] Progress reported accurately
- [ ] Errors handled gracefully

---

## Phase 21: Integration Testing

**Goal**: End-to-end testing of all components.

### API Integration Tests
- [ ] Auth flow testing:
  - Register → Login → Access protected routes → Refresh → Logout
- [ ] Printer management flow:
  - Create → Update → Status update → Delete
- [ ] Job lifecycle flow:
  - Create → Assign → Start → Progress → Complete
- [ ] Order flow:
  - Create → Fulfill → Inventory update

### WebSocket Integration Tests
- [ ] Hub connection testing:
  - Connect → Auth → Printer status → Disconnect
- [ ] Dashboard connection testing:
  - Connect → Auth → Subscribe → Receive updates

### ESP32 Integration Tests
- [ ] End-to-end print test:
  - Queue job in UI → Cloud sends to hub → Hub downloads file → Hub uploads to printer → Print starts → Status updates flow back
- [ ] Reconnection testing:
  - Disconnect hub → Reconnect → State recovery

### Multi-Tenant Tests
- [ ] Verify data isolation:
  - Tenant A cannot see Tenant B's printers
  - WebSocket broadcasts only to correct tenant
  - R2 files isolated by tenant path

### Load Testing
- [ ] Simulate realistic load:
  - Multiple concurrent hub connections
  - Multiple dashboard connections
  - High frequency status updates

### Verification
- [ ] All integration tests pass
- [ ] No data leaks between tenants
- [ ] System handles expected load
- [ ] Recovery from failures works

---

## Phase 22: Data Migration Tools

**Goal**: Build tools to migrate data from Pi to cloud.

### Database Export Tool
- [ ] Create script to export Pi SQLite:
  - Export all tables to JSON/CSV
  - Include all relationships
  - Handle binary data (base64)

### D1 Import Tool
- [ ] Create script to import to D1:
  - Map IDs to UUIDs
  - Set tenant_id for all records
  - Maintain relationships
  - Batch inserts for performance

### R2 File Migration
- [ ] Create script to upload files to R2:
  - Upload print files from Pi
  - Upload product images
  - Update file paths in D1

### Data Validation
- [ ] Create validation scripts:
  - Compare record counts
  - Verify relationships intact
  - Check file accessibility
  - Spot check data integrity

### Rollback Plan
- [ ] Document rollback procedure:
  - Keep Pi system running during migration
  - Export cloud data back to Pi format
  - Clear cloud data if rollback needed

### Verification
- [ ] All data migrated successfully
- [ ] Files accessible from R2
- [ ] Relationships maintained
- [ ] No data loss

---

## Phase 23: Deployment & Cutover

**Goal**: Deploy to production and perform cutover.

### Production Deployment
- [ ] Deploy Workers to production:
  - `wrangler deploy`
  - Verify health check
- [ ] Deploy frontend to Pages:
  - Configure custom domain
  - Verify build and deployment
- [ ] Create production D1 database:
  - Apply all migrations
  - Verify schema

### DNS & SSL Configuration
- [ ] Configure custom domain for API
- [ ] Configure custom domain for frontend
- [ ] Verify SSL certificates

### ESP32 Production Firmware
- [ ] Build release firmware:
  - Production cloud URL
  - Disable debug logging
- [ ] Upload to R2 for OTA
- [ ] Flash initial devices

### Data Migration Execution
- [ ] Execute migration scripts:
  - Export from Pi
  - Import to D1
  - Upload files to R2
  - Validate data

### Parallel Operation
- [ ] Run both systems briefly:
  - Monitor for issues
  - Compare behavior
  - Validate data consistency

### Cutover
- [ ] Deploy ESP32 hub at location
- [ ] Configure printers on hub
- [ ] Verify all functionality:
  - Printer connections
  - Print job flow
  - Real-time updates
  - Order sync
- [ ] Decommission Pi (keep as backup)

### Post-Cutover Monitoring
- [ ] Monitor for 24-48 hours:
  - Error rates
  - Latency
  - Hub connectivity
  - User reports
- [ ] Address any issues

### Verification
- [ ] Production API accessible
- [ ] Frontend loads correctly
- [ ] ESP32 connects to production
- [ ] All features working
- [ ] Performance acceptable

---

## Quick Reference: File Locations

### Cloud (Cloudflare Workers)
| File | Purpose |
|------|---------|
| `cloud/src/index.ts` | Hono app entry, route mounting |
| `cloud/src/routes/*.ts` | API route handlers |
| `cloud/src/durable-objects/*.ts` | WebSocket handlers |
| `cloud/src/middleware/*.ts` | Auth, tenant middleware |
| `cloud/src/lib/*.ts` | Helpers (db, r2, crypto) |
| `cloud/src/queues/*.ts` | Background job handlers |
| `cloud/src/types/*.ts` | TypeScript types |
| `cloud/migrations/*.sql` | D1 schema migrations |
| `cloud/wrangler.toml` | Cloudflare configuration |

### ESP32 Firmware
| File | Purpose |
|------|---------|
| `firmware/src/main.c` | Entry point |
| `firmware/src/wifi_manager.c` | WiFi connection |
| `firmware/src/websocket_client.c` | Cloud connection |
| `firmware/src/bambu_mqtt.c` | Printer MQTT |
| `firmware/src/bambu_ftp.c` | File transfers |
| `firmware/src/protocol_manager.c` | Protocol abstraction |
| `firmware/src/printer_discovery.c` | mDNS discovery |
| `firmware/src/ota_updater.c` | Firmware updates |
| `firmware/include/*.h` | Header files |
| `firmware/platformio.ini` | Build configuration |

### Frontend Updates
| File | Purpose |
|------|---------|
| `frontend/src/services/apiClient.ts` | New API client |
| `frontend/src/hooks/useWebSocket.ts` | WebSocket migration |
| `frontend/src/contexts/AuthContext.tsx` | Auth updates |

---

## Session Estimation

Each phase is designed to be completable in approximately 2-4 hours of focused work:

- **Phases 1-2**: Infrastructure & Schema (~3 hours each)
- **Phases 3-4**: Foundation & Auth (~3 hours each)
- **Phases 5-12**: API Routes (~2-3 hours each)
- **Phases 13-15**: Real-time & Queues (~3-4 hours each)
- **Phases 16-17**: Frontend Migration (~3-4 hours each)
- **Phases 18-20**: ESP32 Firmware (~4 hours each)
- **Phases 21-23**: Testing & Deployment (~3-4 hours each)

**Total estimated effort**: ~70-90 hours across 23 phases

---

## Notes

- Complete phases in order (dependencies listed)
- Each phase has verification steps - don't skip them
- Keep the Pi system running until Phase 23 cutover
- Use `wrangler dev --local` for fast iteration
- Test WebSocket changes with browser dev tools
- ESP32 development requires physical hardware
