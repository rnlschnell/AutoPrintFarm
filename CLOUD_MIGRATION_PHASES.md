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

## Phase 7: Print Jobs API ✅ COMPLETED

**Goal**: Implement print job queue management and status tracking.

**Completed**: 2025-11-23 - Implemented complete print jobs API with CRUD, job control, state machine, queue processing, and auto-assignment logic.

### Print Job Routes
- [x] Create `src/routes/jobs.ts` (~1,360 lines):
  - `GET /api/v1/jobs` - List jobs (with filters: status, printer, date range, pagination)
  - `GET /api/v1/jobs/:id` - Get job details
  - `POST /api/v1/jobs` - Create/queue new job (validates file, printer, SKU)
  - `PUT /api/v1/jobs/:id` - Update job metadata
  - `DELETE /api/v1/jobs/:id` - Cancel/delete job (not while printing)
  - `POST /api/v1/jobs/:id/assign` - Assign job to printer (validates availability)
  - `POST /api/v1/jobs/:id/start` - Start print (sends to hub via queue)
  - `POST /api/v1/jobs/:id/pause` - Pause print
  - `POST /api/v1/jobs/:id/resume` - Resume print
  - `POST /api/v1/jobs/:id/cancel` - Cancel print
  - `POST /api/v1/jobs/:id/complete` - Mark as completed
  - `POST /api/v1/jobs/:id/fail` - Mark as failed
  - `POST /api/v1/jobs/:id/retry` - Re-queue failed job
  - `PUT /api/v1/jobs/:id/progress` - Update job progress

### Job Queue Logic
- [x] Create `src/lib/job-queue.ts` (~360 lines):
  - Job state machine with valid transitions (queued → processing → uploaded → printing → completed/failed/cancelled)
  - `validateStatusTransition()` - State machine validation
  - `isTerminalState()`, `isActiveJob()` - Status helpers
  - `scorePrinterMatch()`, `findMatchingPrinter()` - Auto-assignment scoring by color/material/model
  - `checkPrinterAvailability()` - Validates printer can accept jobs
  - `calculatePriority()` - Priority scoring algorithm
  - `buildJobFromFile()`, `denormalizePrinterInfo()` - Job creation helpers

### Job History & Stats
- [x] Add job statistics endpoints:
  - `GET /api/v1/jobs/stats` - Job counts by status with summary
  - `GET /api/v1/jobs/history` - Completed job history with pagination and date filters

### Print Events Queue
- [x] Create `src/queues/print-events.ts` (~620 lines):
  - Handle `job_started`, `job_progress`, `job_completed`, `job_failed`, `job_cancelled`, `job_paused`, `job_resumed` events
  - Update printer status on job state changes
  - Update inventory/finished goods on completion
  - Create collection worklist tasks
  - Create assembly tasks for products requiring assembly
  - Log printer failures for analytics
- [x] Configure print-events queue consumer in `wrangler.toml`
- [x] Updated `src/types/env.ts` with detailed PrintEventMessage union type

### Verification
- [x] TypeScript compilation passes
- [x] Wrangler dev server starts with all bindings
- [x] Jobs created with correct defaults from print file metadata
- [x] State transitions validated (invalid transitions rejected with clear error messages)
- [x] Auto-assignment logic implemented with printer scoring
- [x] History queryable with filters and pagination

---

## Phase 8: Products & SKUs API ✅ COMPLETED

**Goal**: Implement product catalog management.

**Completed**: 2025-11-23 - Implemented complete product catalog with Products, SKUs, Color Presets, and Build Plate Types.

### Product Routes
- [x] Create `src/routes/products.ts`:
  - `GET /api/v1/products` - List products (with search, category filter, pagination)
  - `GET /api/v1/products/:id` - Get product with SKUs
  - `POST /api/v1/products` - Create product
  - `PUT /api/v1/products/:id` - Update product
  - `DELETE /api/v1/products/:id` - Delete product (cascade SKUs)
  - `POST /api/v1/products/:id/image` - Upload product image
  - `GET /api/v1/products/:id/image` - Get product image
  - `GET /api/v1/products/categories` - Get unique categories

### SKU Routes
- [x] Create `src/routes/skus.ts`:
  - `GET /api/v1/products/:productId/skus` - List SKUs for product
  - `GET /api/v1/skus` - List all SKUs (with filters)
  - `GET /api/v1/skus/:id` - Get SKU details
  - `POST /api/v1/products/:productId/skus` - Create SKU
  - `PUT /api/v1/skus/:id` - Update SKU
  - `DELETE /api/v1/skus/:id` - Delete SKU
  - `POST /api/v1/skus/:id/adjust` - Adjust stock level
  - `GET /api/v1/skus/low-stock` - Get low stock SKUs

### Color Preset Routes
- [x] Create `src/routes/colors.ts`:
  - `GET /api/v1/colors` - List color presets (with filament_type filter)
  - `GET /api/v1/colors/:id` - Get color preset
  - `POST /api/v1/colors` - Create color preset
  - `PUT /api/v1/colors/:id` - Update color preset
  - `DELETE /api/v1/colors/:id` - Delete color preset
  - `GET /api/v1/colors/filament-types` - Get unique filament types
  - `POST /api/v1/colors/batch` - Batch create color presets

### Build Plate Type Routes
- [x] Create `src/routes/plates.ts`:
  - `GET /api/v1/plates` - List plate types
  - `GET /api/v1/plates/:id` - Get plate type
  - `POST /api/v1/plates` - Create plate type
  - `PUT /api/v1/plates/:id` - Update plate type
  - `DELETE /api/v1/plates/:id` - Delete plate type
  - `POST /api/v1/plates/seed-defaults` - Seed default Bambu Lab plate types

### Verification
- [x] Products CRUD works (with image upload to R2)
- [x] SKU creation with duplicate validation (SKU code + color per product)
- [x] Color presets with unique constraint (name + filament_type)
- [x] Product images stored in R2 at `{tenant_id}/products/{product_id}.{ext}`
- [x] TypeScript compilation passes

---

## Phase 9: Inventory & Finished Goods API ✅ COMPLETED

**Goal**: Implement inventory tracking and stock management.

**Completed**: 2025-11-23 - Implemented complete inventory management for finished goods.

### Finished Goods Routes
- [x] Create `src/routes/inventory.ts` (~570 lines):
  - `GET /api/v1/inventory` - List finished goods (filters: status, low_stock, product_sku_id, search, pagination)
  - `GET /api/v1/inventory/:id` - Get finished good with related SKU/product info
  - `POST /api/v1/inventory` - Create finished good record (validates SKU, prevents duplicates)
  - `PUT /api/v1/inventory/:id` - Update stock levels, pricing, assembly info
  - `POST /api/v1/inventory/:id/adjust` - Adjust stock (increment/decrement with reason tracking and audit logging)
  - `DELETE /api/v1/inventory/:id` - Soft delete (marks as discontinued/inactive)
  - `GET /api/v1/inventory/alerts` - Get low stock alerts with product info
  - `PUT /api/v1/inventory/:id/threshold` - Update low stock threshold
  - `GET /api/v1/inventory/stats` - Get aggregated inventory statistics

### Stock Operations
- [x] Create `src/lib/inventory.ts` (~230 lines):
  - `calculateFinishedGoodStatus()` - Auto-calculate status based on stock levels
  - `validateStockAdjustment()` - Prevent negative stock
  - `validateFulfillmentStock()` - Check stock for order fulfillment (Phase 10 prep)
  - `isLowStock()`, `isOutOfStock()` - Status helpers
  - `calculateItemValue()`, `calculateTotalItemValue()` - Value calculations
  - `buildInventoryWhereClause()` - Dynamic query builder
  - `createLowStockAlert()` - Alert structure helper
  - Increment stock on print completion (already in print-events.ts queue)
  - Assembly tracking (needs_assembly, assembled, printed states)

### Inventory Alerts
- [x] Add alert endpoints:
  - `GET /api/v1/inventory/alerts` - Get low stock alerts with deficit calculation
  - `PUT /api/v1/inventory/:id/threshold` - Update low stock threshold with auto status recalculation

### Verification
- [x] Stock increments on job completion (via print-events queue from Phase 7)
- [x] Stock decrements via adjust endpoint (fulfillment support for Phase 10)
- [x] Low stock alerts trigger correctly (WHERE current_stock <= low_stock_threshold)
- [x] Assembly quantities tracked (quantity_assembled, quantity_needs_assembly)
- [x] TypeScript compilation passes

---

## Phase 10: Orders & Shopify Integration ✅ COMPLETED

**Goal**: Implement order management and Shopify sync.

**Completed**: 2025-11-23 - Implemented complete order management with CRUD, fulfillment, and Shopify integration.

### Order Routes
- [x] Create `src/routes/orders.ts` (~730 lines):
  - `GET /api/v1/orders` - List orders (with status, platform, search, date filters, pagination)
  - `GET /api/v1/orders/:id` - Get order with all items and product info
  - `POST /api/v1/orders` - Create manual order with items
  - `PUT /api/v1/orders/:id` - Update order details
  - `POST /api/v1/orders/:id/fulfill` - Fulfill entire order (updates inventory)
  - `POST /api/v1/orders/:id/items/:itemId/fulfill` - Fulfill single item (partial fulfillment)
  - `DELETE /api/v1/orders/:id` - Cancel order
  - `GET /api/v1/orders/stats` - Order statistics by status, platform, and revenue

### Order Helper Library
- [x] Create `src/lib/orders.ts` (~490 lines):
  - `validateFulfillmentQuantity()` - Stock validation for fulfillment
  - `calculateOrderStatus()` - Derive order status from item states
  - `calculateItemFulfillmentStatus()` - Item status from quantities
  - `generateOrderNumber()` - Auto-generate order numbers
  - `convertShopifyOrder()` - Transform Shopify orders to local format
  - `validateShopifyWebhook()` - HMAC signature verification
  - `shouldSyncShopifyOrder()` - Filter test/old orders
  - `matchSku()` - Match Shopify SKUs to local SKUs (exact/partial)
  - Reporting helpers for fulfillment rate and time

### Shopify Integration
- [x] Create `src/routes/integrations.ts` (~450 lines):
  - `GET /api/v1/integrations` - List all integrations status
  - `GET /api/v1/integrations/shopify/status` - Connection status
  - `POST /api/v1/integrations/shopify/connect` - Save encrypted credentials
  - `POST /api/v1/integrations/shopify/disconnect` - Remove connection
  - `GET /api/v1/integrations/shopify/settings` - Get sync settings
  - `PUT /api/v1/integrations/shopify/settings` - Update sync settings
  - `POST /api/v1/integrations/shopify/sync` - Manual sync trigger
  - `GET /api/v1/integrations/shopify/webhooks` - Webhook setup info
  - `PUT /api/v1/integrations/shopify/webhooks/enable` - Mark webhooks configured

### Shopify Webhooks
- [x] Create `src/routes/webhooks.ts` (~380 lines):
  - `POST /webhooks/shopify/:tenantId/orders/create` - New order webhook
  - `POST /webhooks/shopify/:tenantId/orders/updated` - Order updated webhook
  - `POST /webhooks/shopify/:tenantId/orders/cancelled` - Order cancelled webhook
  - `GET /webhooks/health` - Webhook service health check
  - HMAC signature verification for all webhooks
  - Auto-create orders with SKU matching
  - Notification queue integration for new orders

### Shopify Sync Queue
- [x] Create `src/queues/shopify-sync.ts` (~440 lines):
  - `handleShopifySyncQueue()` - Queue consumer for sync messages
  - `runOrderSync()` - Full order import with pagination
  - `syncShopifyOrder()` - Individual order sync with SKU matching
  - `syncFulfillmentToShopify()` - Push fulfillment status to Shopify
  - Rate limiting and error handling
  - Cursor-based pagination for large order sets

### Database Migration
- [x] Create `migrations/0011_tenant_integrations.sql`:
  - `tenant_integrations` table for encrypted credentials
  - `shopify_orders_sync` table for sync tracking
  - Indexes for efficient querying

### Verification
- [x] TypeScript compilation passes
- [x] Manual orders create correctly with auto-generated numbers
- [x] Webhook handlers receive and process Shopify orders
- [x] SKU matching works (exact and partial)
- [x] Queue consumer configured in wrangler.toml

---

## Phase 11: Worklist & Assembly Tasks API ✅ COMPLETED

**Goal**: Implement task management for operators.

**Completed**: 2025-11-23 - Implemented complete worklist and assembly task management with auto-generation library.

### Worklist Routes
- [x] Create `src/routes/worklist.ts`:
  - `GET /api/v1/worklist` - List tasks (with type/status/priority/assigned_to/printer_id filters)
  - `GET /api/v1/worklist/stats` - Get task counts by status and type
  - `GET /api/v1/worklist/:id` - Get task details
  - `POST /api/v1/worklist` - Create task
  - `PUT /api/v1/worklist/:id` - Update task
  - `PUT /api/v1/worklist/:id/status` - Change task status (with automatic timestamp tracking)
  - `PUT /api/v1/worklist/:id/assign` - Assign to user
  - `DELETE /api/v1/worklist/:id` - Delete task

### Assembly Task Routes
- [x] Create `src/routes/assembly.ts`:
  - `GET /api/v1/assembly` - List assembly tasks (with status/assigned_to/finished_good_id filters)
  - `GET /api/v1/assembly/stats` - Get assembly task counts by status
  - `GET /api/v1/assembly/:id` - Get assembly task with finished good details
  - `POST /api/v1/assembly` - Create assembly task
  - `PUT /api/v1/assembly/:id` - Update assembly task
  - `POST /api/v1/assembly/:id/complete` - Complete assembly (updates finished goods inventory)
  - `DELETE /api/v1/assembly/:id` - Delete assembly task (only non-completed)

### Auto-Generated Tasks
- [x] Create `src/lib/tasks.ts`:
  - `createWorklistTask()` - Direct worklist task creation
  - `createAssemblyTask()` - Direct assembly task creation
  - `createCollectionTask()` - Auto-create collection task when print completes
  - `createFilamentChangeTask()` - Auto-create filament change task when color changes
  - `createMaintenanceTask()` - Auto-create maintenance tasks for printers
  - `createQualityCheckTask()` - Auto-create quality check tasks
  - `createAssemblyTasksForFinishedGood()` - Auto-create assembly tasks with linked worklist task
  - `handlePrintJobCompletion()` - Batch handler for post-print task creation
  - `checkAndCreateFilamentChangeTask()` - Check filament match and create task if needed
  - `getPendingTaskCounts()` - Get pending task counts for dashboard

### Verification
- [x] TypeScript compilation passes
- [x] Tasks appear in worklist with proper filtering and pagination
- [x] Status transitions work with automatic started_at/completed_at/actual_time tracking
- [x] Auto-generation functions ready for queue integration (Phase 15)
- [x] Assignment and completion tracked with tenant member validation

### Notes
- Task auto-generation functions are standalone and can be called from:
  - Print events queue (Phase 15)
  - API routes when jobs complete (Phase 7)
  - Automation rules (Phase 12)
- Assembly task completion automatically updates finished goods inventory (quantity_assembled, quantity_needs_assembly, assembly_status)

---

## Phase 12: Supporting Features API ✅ COMPLETED

**Goal**: Implement wiki, cameras, automation, and analytics.

**Completed**: 2025-11-23 - Implemented all supporting features APIs with full CRUD operations.

### Wiki Routes
- [x] Create `src/routes/wiki.ts`:
  - `GET /api/v1/wiki` - List articles (with category, is_published, product_id, search filters, pagination)
  - `GET /api/v1/wiki/categories` - Get unique categories
  - `GET /api/v1/wiki/:slug` - Get article by slug
  - `POST /api/v1/wiki` - Create article (admin/owner/operator)
  - `PUT /api/v1/wiki/:id` - Update article (admin/owner/operator)
  - `POST /api/v1/wiki/:id/publish` - Publish article (admin/owner)
  - `POST /api/v1/wiki/:id/unpublish` - Unpublish article (admin/owner)
  - `DELETE /api/v1/wiki/:id` - Delete article (admin/owner)

### Camera Routes
- [x] Create `src/routes/cameras.ts`:
  - `GET /api/v1/cameras` - List cameras (with printer_id, hub_id, is_active, camera_type filters)
  - `GET /api/v1/cameras/:id` - Get camera details (password sanitized)
  - `POST /api/v1/cameras` - Create camera (admin/owner, encrypts password)
  - `PUT /api/v1/cameras/:id` - Update camera (admin/owner)
  - `PUT /api/v1/cameras/:id/status` - Update online status
  - `DELETE /api/v1/cameras/:id` - Delete camera (admin/owner)
  - `GET /api/v1/cameras/:id/snapshot` - Fetch and return camera snapshot (with auth support)

### Automation Routes
- [x] Create `src/routes/automation.ts`:
  - `GET /api/v1/automation/trigger-types` - List available trigger types with descriptions
  - `GET /api/v1/automation/action-types` - List available action types with descriptions
  - `GET /api/v1/automation` - List rules (with trigger_type, action_type, is_enabled filters)
  - `GET /api/v1/automation/:id` - Get rule details (JSON fields parsed)
  - `POST /api/v1/automation` - Create rule (admin/owner, validates printer/product IDs)
  - `PUT /api/v1/automation/:id` - Update rule (admin/owner)
  - `PUT /api/v1/automation/:id/toggle` - Enable/disable rule (admin/owner)
  - `DELETE /api/v1/automation/:id` - Delete rule (admin/owner)

### Analytics Routes
- [x] Create `src/routes/analytics.ts`:
  - `GET /api/v1/analytics/overview` - Real-time dashboard stats (printers, jobs, tasks, hubs, alerts)
  - `GET /api/v1/analytics/production` - Production metrics over date range (jobs, units, print time)
  - `GET /api/v1/analytics/printers` - Printer utilization (per printer stats, success rates)
  - `GET /api/v1/analytics/failures` - Failure analysis (by type, by printer, trends, recent)
  - `GET /api/v1/analytics/inventory` - Inventory status (low stock, filament, material usage)
  - `GET /api/v1/analytics/revenue` - Revenue and profit breakdown (by platform, daily trends)

### Verification
- [x] TypeScript compilation passes
- [x] Wrangler dev server starts with all bindings
- [x] Wiki articles support markdown content, SEO fields, and product linking
- [x] Camera credentials encrypted with AES-256-GCM
- [x] Camera snapshots fetch with basic auth support and error handling
- [x] Automation rules support rate limiting (cooldown_seconds, max_triggers_per_hour)
- [x] Analytics queries aggregate from daily_analytics and real-time tables

---

## Phase 13: Hub WebSocket (Durable Objects) ✅ COMPLETE

**Goal**: Implement HubConnection Durable Object for ESP32 communication.

### HubConnection Durable Object
- [x] Create `src/durable-objects/hub-connection.ts`:
  - WebSocket handling for hub connections (hibernation API)
  - Hub authentication (HMAC signature verification ready)
  - State: hub_id, tenant_id, session info, pending commands
  - Message parsing and validation

### Hub → Cloud Messages
- [x] Implement handlers for:
  - `hub_hello` - Hub connection initialization
  - `printer_status` - Printer status updates
  - `file_progress` - File transfer progress
  - `command_ack` - Command acknowledgment
  - `printer_discovered` - New printer discovery results

### Cloud → Hub Messages
- [x] Implement command sending via `src/lib/hub-commands.ts`:
  - `configure_printer` - Add/remove printer from hub
  - `print_command` - Start print (with presigned file URL)
  - `printer_command` - Control commands (pause/resume/stop)
  - `discover_printers` - Trigger printer discovery

### State Management
- [x] Implement alarm-based features:
  - Heartbeat checking (mark offline if no response after 60s)
  - Auth timeout (10s to authenticate after connect)
  - Pending command timeout (30s default)
  - Database updates on connect/disconnect

### WebSocket Route
- [x] Create `ws/hub/:id` route in `src/index.ts`:
  - Upgrade HTTP to WebSocket
  - Route to HubConnection Durable Object by hub ID
  - Handle connection errors

### API Integration
- [x] Update `src/routes/printers.ts`:
  - `/connect` - Send configure_printer add command
  - `/disconnect` - Send configure_printer remove command
  - `/control` - Send printer_command (pause/resume/stop)
- [x] Update `src/routes/jobs.ts`:
  - `/start` - Send print_command with signed file URL
- [x] Update `src/routes/hubs.ts`:
  - `/discover` - Trigger printer discovery
  - `/connection` - Get Durable Object status

### Verification
- [x] Hub can connect via WebSocket (`/ws/hub/:id`)
- [x] Messages parsed and routed correctly
- [x] Commands sent via hub-commands helper
- [x] Offline detection via heartbeat alarm
- [x] TypeScript compilation passes

---

## Phase 14: Dashboard WebSocket ✅ COMPLETED

**Goal**: Implement DashboardBroadcast Durable Object for real-time UI updates.

**Completed**: 2025-11-23 - Implemented full dashboard WebSocket with auth, subscriptions, and broadcasting.

### DashboardBroadcast Durable Object
- [x] Create `src/durable-objects/dashboard-broadcast.ts`:
  - Multi-client WebSocket connections (hibernation API)
  - Session token authentication on connect
  - State: connected users, subscriptions per client
  - Message broadcasting with subscription filtering

### Authentication Flow
- [x] Implement auth message handling:
  - Validate session token (Better Auth sessions table)
  - Extract user and verify tenant membership
  - Subscribe to tenant updates
  - Send auth_success/auth_error response
  - Auth timeout (30s) for unauthenticated connections

### Broadcast Messages
- [x] Implement broadcasting for:
  - `printer_status` - Real-time printer updates
  - `job_update` - Job status changes (started, progress, completed, failed, paused, resumed, cancelled)
  - `hub_status` - Hub online/offline
  - `inventory_alert` - Low stock notifications
  - `new_order` - Order received notification (from Shopify webhooks)

### Subscription Management
- [x] Implement client subscriptions:
  - Subscribe to specific printers (filter by printer_id)
  - Unsubscribe from printers
  - Empty subscription set = receive all updates
  - Hub status, inventory alerts, and new orders always sent to all clients

### HubConnection Integration
- [x] Connect HubConnection to DashboardBroadcast (already in Phase 13):
  - Forward printer status updates via `/broadcast` endpoint
  - Forward job progress updates
  - Forward hub connection status

### WebSocket Route
- [x] Create `ws/dashboard` route in `src/index.ts`:
  - Upgrade HTTP to WebSocket
  - Route to DashboardBroadcast (by tenant ID query param)
  - Handle connection errors
- [x] Create `ws/dashboard/status` endpoint for connection statistics

### Broadcast Helper Library
- [x] Create `src/lib/broadcast.ts`:
  - `broadcastPrinterStatus()` - Send printer status updates
  - `broadcastJobUpdate()` - Send job state changes
  - `broadcastHubStatus()` - Send hub online/offline
  - `broadcastInventoryAlert()` - Send low stock alerts
  - `broadcastNewOrder()` - Send new order notifications
  - `broadcastBatch()` - Send multiple messages efficiently

### Queue Integration
- [x] Update `src/queues/print-events.ts`:
  - Broadcast job started, progress, completed, failed, paused, resumed, cancelled
  - Broadcast printer status changes
  - Broadcast inventory alerts on low stock
- [x] Update `src/routes/webhooks.ts`:
  - Broadcast new order notifications when Shopify orders arrive

### Verification
- [x] Dashboard connects via WebSocket (`/ws/dashboard?tenant=xxx`)
- [x] Auth succeeds with valid session token
- [x] Auth fails with invalid/expired token (returns `auth_error`)
- [x] Subscription filtering works correctly
- [x] Broadcasts reach all relevant clients
- [x] TypeScript compilation passes
- [x] Wrangler dev starts with all bindings

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

## Phase 16: Frontend API Migration ✅ COMPLETED

**Goal**: Update frontend services to use new cloud API.

**Completed**: 2025-11-23 - Migrated frontend to use Cloudflare Workers API.

### API Client Setup
- [x] Create new API client configuration:
  - Base URL configuration (production vs development) - `frontend/src/lib/api-client.ts`
  - JWT/session cookie management (Better Auth uses cookies)
  - Automatic tenant ID header injection
  - Error handling standardization with `ApiError` class

### Auth Integration
- [x] Update `AuthContext.tsx`:
  - Login/logout via Better Auth client (`frontend/src/lib/auth-client.ts`)
  - Session cookie management
  - Multi-tenant support with tenant switching
  - Created API types (`frontend/src/types/api.ts`)

### Printer Services
- [x] Update `usePrinters.ts`:
  - Fetch from `/api/v1/printers`
  - CRUD operations
  - Status updates, maintenance toggle, cleared toggle
  - Printer control commands (connect, disconnect, pause/resume/stop)

### Job Services
- [x] Update `usePrintJobs.ts`:
  - Fetch from `/api/v1/jobs`
  - Create/update jobs
  - Job state machine (assign, start, pause, resume, complete, fail, cancel, retry)
  - Progress updates and job statistics

### File Services
- [x] Update `usePrintFiles.ts`:
  - Upload via presigned URL (`getUploadUrl`, `uploadFile`)
  - Metadata display with transformers
  - Thumbnail display with `getThumbnailUrl`
  - File versioning support

### Product Services
- [ ] Update `useProductsNew.ts` (deferred - complex hook, needs additional work)

### Inventory Services
- [ ] Update inventory hooks (deferred - complex aggregation logic)

### Order Services
- [x] Update `useOrders.ts`:
  - Fetch from `/api/v1/orders`
  - Manual order creation with items
  - Fulfillment updates (fulfill order, fulfill item)
  - Order statistics

### Task Services
- [ ] Update `useWorklistTasks.ts` (deferred - complex multi-entity logic)

### Context Providers
- [x] Update `ColorPresetsContext.tsx` - uses `/api/v1/colors`
- [x] Update `useTenant.ts` - wrapper around AuthContext

### Environment Configuration
- [x] Created `frontend/.env.example` with API/WS URL configuration
- [x] Created data transformers (`frontend/src/lib/transformers.ts`)

### Verification
- [x] TypeScript type check passes
- [ ] All pages load data correctly (requires running frontend)
- [ ] CRUD operations work (requires E2E testing)
- [ ] Error handling displays correctly (requires manual testing)
- [ ] Loading states work (requires manual testing)

### Files Created/Modified
**Created:**
- `frontend/src/lib/api-client.ts` - Centralized API client
- `frontend/src/lib/auth-client.ts` - Better Auth client wrapper
- `frontend/src/lib/transformers.ts` - Data transformation utilities
- `frontend/src/types/api.ts` - TypeScript types for API
- `frontend/.env.example` - Environment configuration template

**Modified:**
- `frontend/src/contexts/AuthContext.tsx` - Better Auth integration
- `frontend/src/contexts/ColorPresetsContext.tsx` - Cloud API
- `frontend/src/hooks/usePrinters.ts` - Cloud API
- `frontend/src/hooks/usePrintJobs.ts` - Cloud API
- `frontend/src/hooks/usePrintFiles.ts` - Cloud API
- `frontend/src/hooks/useOrders.ts` - Cloud API
- `frontend/src/hooks/useTenant.ts` - AuthContext wrapper

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
