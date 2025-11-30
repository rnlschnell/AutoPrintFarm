/**
 * PrintFarm Cloud - TypeScript Entity Types
 *
 * This file contains all entity types matching the D1 database schema.
 * Types are derived from migrations 0001-0008.
 */

// =============================================================================
// COMMON TYPES
// =============================================================================

/** UUID string type for all entity IDs */
export type UUID = string;

/** ISO8601 timestamp string */
export type Timestamp = string;

/** Boolean stored as integer in SQLite (0 or 1) */
export type SqliteBoolean = 0 | 1;

// =============================================================================
// ENUMS (matching SQL CHECK constraints)
// =============================================================================

export type TenantMemberRole = "owner" | "admin" | "operator" | "viewer";

export type PrinterStatus =
  | "idle"
  | "printing"
  | "paused"
  | "maintenance"
  | "offline"
  | "error";

export type PrinterConnectionType =
  | "bambu"
  | "prusa"
  | "octoprint"
  | "klipper"
  | "other";

export type PrintJobStatus =
  | "queued"
  | "processing"
  | "uploaded"
  | "printing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type FinishedGoodStatus =
  | "active"
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "needs_assembly"
  | "discontinued";

export type AssemblyStatus = "printed" | "needs_assembly" | "assembled";

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TaskType =
  | "assembly"
  | "filament_change"
  | "collection"
  | "maintenance"
  | "quality_check";

export type TaskPriority = "low" | "medium" | "high";

export type OrderPlatform =
  | "shopify"
  | "amazon"
  | "etsy"
  | "manual"
  | "other";

export type OrderStatus =
  | "pending"
  | "processing"
  | "printed"
  | "assembled"
  | "shipped"
  | "fulfilled"
  | "cancelled"
  | "refunded";

export type FulfillmentStatus = "pending" | "partial" | "fulfilled" | "cancelled";

export type CameraType = "bambu" | "ip" | "usb" | "rtsp" | "mjpeg";

export type AutomationTriggerType =
  | "print_completed"
  | "print_failed"
  | "print_started"
  | "printer_offline"
  | "printer_online"
  | "printer_error"
  | "low_stock"
  | "order_received"
  | "order_fulfilled"
  | "assembly_completed"
  | "task_completed"
  | "hub_offline"
  | "hub_online"
  | "schedule";

export type AutomationActionType =
  | "send_notification"
  | "send_email"
  | "send_webhook"
  | "create_task"
  | "update_status"
  | "assign_printer"
  | "start_next_job"
  | "pause_queue"
  | "resume_queue"
  | "update_inventory"
  | "create_order_item"
  | "run_script";

export type SyncOperationType =
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "SYNC"
  | "ERROR";

export type SyncStatus = "SUCCESS" | "FAILED" | "PENDING" | "SKIPPED";

export type FailureType =
  | "nozzle_clog"
  | "bed_adhesion"
  | "layer_shift"
  | "filament_runout"
  | "power_loss"
  | "network_disconnect"
  | "firmware_error"
  | "mechanical"
  | "thermal"
  | "user_cancelled"
  | "unknown"
  | "other";

export type InventoryStatus =
  | "in_stock"
  | "low"
  | "out_of_stock"
  | "on_order";

export type MaterialType = "filament" | "packaging" | "accessory" | "part";

// =============================================================================
// MIGRATION 0001: TENANTS & USERS
// =============================================================================

export interface Tenant {
  id: UUID;
  subdomain: string;
  company_name: string;
  is_active: SqliteBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface User {
  id: UUID;
  email: string;
  full_name: string;
  password_hash: string | null;
  is_active: SqliteBoolean;
  last_login: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TenantMember {
  id: UUID;
  tenant_id: UUID;
  user_id: UUID;
  role: TenantMemberRole;
  invited_by: UUID | null;
  invited_at: Timestamp | null;
  accepted_at: Timestamp | null;
  is_active: SqliteBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// MIGRATION 0002: HUBS & PRINTERS
// =============================================================================

export interface Hub {
  id: UUID;
  tenant_id: UUID | null;
  name: string | null;
  secret_hash: string;
  firmware_version: string | null;
  hardware_version: string | null;
  is_online: SqliteBoolean;
  last_seen_at: Timestamp | null;
  ip_address: string | null;
  mac_address: string | null;
  claimed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Printer {
  id: UUID;
  tenant_id: UUID;
  hub_id: UUID | null;

  // Basic info
  name: string;
  model: string;
  manufacturer: string | null;
  firmware_version: string | null;

  // Usage and maintenance
  total_print_time: number;
  last_maintenance_date: string | null;

  // Status
  status: PrinterStatus;
  current_color: string | null;
  current_color_hex: string | null;
  current_filament_type: string | null;
  current_build_plate: string | null;
  filament_level: number;
  nozzle_size: number | null;
  location: string | null;

  // Connection details
  connection_type: PrinterConnectionType;
  ip_address: string | null;
  serial_number: string | null;
  access_code: string | null;

  // Connection status
  is_connected: SqliteBoolean;
  last_connection_attempt: Timestamp | null;
  connection_error: string | null;

  // Management
  is_active: SqliteBoolean;
  cleared: SqliteBoolean;
  sort_order: number;
  printer_id: number | null;

  // Maintenance
  in_maintenance: SqliteBoolean;
  maintenance_type: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// MIGRATION 0003: PRODUCTS & INVENTORY PRESETS
// =============================================================================

export interface Product {
  id: UUID;
  tenant_id: UUID;

  // Basic info
  name: string;
  description: string | null;
  category: string | null;

  // File association
  print_file_id: UUID | null;
  file_name: string | null;

  // Flags
  requires_assembly: SqliteBoolean;
  requires_post_processing: SqliteBoolean;

  // Printer config
  printer_priority: string | null; // JSON array

  // Display
  image_url: string | null;
  is_active: SqliteBoolean;

  // Wiki
  wiki_id: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProductSku {
  id: UUID;
  product_id: UUID;
  tenant_id: UUID;

  // Identification
  sku: string;
  color: string;
  filament_type: string | null;
  hex_code: string | null;

  // Quantity and pricing
  quantity: number;
  stock_level: number;
  price: number | null; // cents
  low_stock_threshold: number;

  // Status
  is_active: SqliteBoolean;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProductComponent {
  id: UUID;
  product_id: UUID;

  // Component info
  component_name: string;
  component_type: string | null;
  quantity_required: number;
  notes: string | null;

  // Timestamps
  created_at: Timestamp;
}

export interface ColorPreset {
  id: UUID;
  tenant_id: UUID;

  // Color info
  color_name: string;
  hex_code: string;
  filament_type: string;

  // Status
  is_active: SqliteBoolean;

  // Timestamps
  created_at: Timestamp;
}

export interface BuildPlateType {
  id: UUID;
  tenant_id: UUID;

  // Plate info
  name: string;
  description: string | null;

  // Status
  is_active: SqliteBoolean;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// MIGRATION 0004: PRINT FILES & JOBS
// =============================================================================

export interface PrintFile {
  id: UUID;
  tenant_id: UUID;
  product_id: UUID | null;

  // File info
  name: string;
  file_size_bytes: number | null;

  // Storage
  number_of_units: number;
  local_file_path: string | null;
  r2_key: string | null;

  // 3MF Metadata
  print_time_seconds: number | null;
  filament_weight_grams: number | null;
  filament_length_meters: number | null;
  filament_type: string | null;
  printer_model_id: string | null;
  nozzle_diameter: number | null;
  layer_count: number | null;
  curr_bed_type: string | null;
  default_print_profile: string | null;
  object_count: number;

  // Thumbnail
  thumbnail_r2_key: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PrintFileVersion {
  id: UUID;
  print_file_id: UUID;

  // Version info
  version_number: number;
  file_url: string | null;
  r2_key: string | null;
  notes: string | null;
  is_current_version: SqliteBoolean;

  // Timestamps
  created_at: Timestamp;
}

export interface PrintJob {
  id: UUID;
  tenant_id: UUID;

  // Foreign keys
  printer_id: UUID | null;
  print_file_id: UUID;
  product_sku_id: UUID | null;
  submitted_by: UUID | null;

  // Job info
  file_name: string;
  status: PrintJobStatus;
  color: string;
  filament_type: string;
  material_type: string;

  // Quantity
  number_of_units: number;

  // Print metrics
  filament_needed_grams: number | null;
  estimated_print_time_minutes: number | null;
  actual_print_time_minutes: number | null;
  progress_percentage: number;

  // Printer tracking
  bambu_job_id: string | null;
  printer_numeric_id: number | null;
  last_sync_time: Timestamp | null;

  // Queue management
  priority: number;
  failure_reason: string | null;

  // Timestamps
  time_submitted: Timestamp;
  time_started: Timestamp | null;
  time_completed: Timestamp | null;

  // Workflow
  requires_assembly: SqliteBoolean;
  quantity_per_print: number;

  // Denormalized fields
  product_id: UUID | null;
  product_name: string | null;
  sku_name: string | null;
  printer_model: string | null;
  printer_name: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// MIGRATION 0005: FINISHED GOODS & TASKS
// =============================================================================

export interface FinishedGood {
  id: UUID;
  tenant_id: UUID;

  // Foreign keys
  product_sku_id: UUID;
  print_job_id: UUID | null;

  // Product info (denormalized)
  sku: string;
  color: string;
  material: string;

  // Stock and quantity
  current_stock: number;
  low_stock_threshold: number;
  quantity_per_sku: number;

  // Pricing (cents)
  unit_price: number;
  extra_cost: number;
  profit_margin: number;

  // Assembly tracking
  requires_assembly: SqliteBoolean;
  quantity_assembled: number;
  quantity_needs_assembly: number;

  // Status
  status: FinishedGoodStatus;
  assembly_status: AssemblyStatus;

  // Display
  image_url: string | null;

  // Management
  is_active: SqliteBoolean;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AssemblyTask {
  id: UUID;
  tenant_id: UUID;

  // Foreign keys
  finished_good_id: UUID;
  assigned_to: UUID | null;

  // Task info
  product_name: string;
  sku: string;
  quantity: number;

  // Status
  status: TaskStatus;

  // Notes
  notes: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: Timestamp | null;
}

export interface WorklistTask {
  id: UUID;
  tenant_id: UUID;

  // Foreign keys
  assembly_task_id: UUID | null;
  printer_id: UUID | null;
  assigned_to: UUID | null;

  // Task info
  title: string;
  subtitle: string | null;
  description: string | null;

  // Type and priority
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;

  // Time tracking
  estimated_time_minutes: number | null;
  actual_time_minutes: number | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  due_date: Timestamp | null;

  // Metadata
  metadata: string | null; // JSON string

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// MIGRATION 0006: ORDERS
// =============================================================================

export interface Order {
  id: UUID;
  tenant_id: UUID;

  // Order identification
  order_number: string;
  platform: OrderPlatform;

  // Customer info
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;

  // Order details
  order_date: Timestamp;
  status: OrderStatus;

  // Financials (cents)
  total_revenue: number;
  shipping_cost: number;
  tax_amount: number;
  discount_amount: number;

  // Shipping address
  shipping_street: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  shipping_country: string;

  // Fulfillment
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: Timestamp | null;

  // Platform data
  external_id: string | null;
  external_data: string | null; // JSON string

  // Notes
  notes: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrderItem {
  id: UUID;
  order_id: UUID;

  // Product reference
  finished_good_id: UUID | null;
  product_sku_id: UUID | null;

  // Item info (denormalized)
  sku: string;
  product_name: string;

  // Quantity and pricing (cents)
  quantity: number;
  unit_price: number;
  total_price: number;

  // Fulfillment
  quantity_fulfilled: number;
  fulfillment_status: FulfillmentStatus;

  // Notes
  notes: string | null;

  // Timestamps
  created_at: Timestamp;
}

// =============================================================================
// MIGRATION 0007: SUPPORTING FEATURES
// =============================================================================

export type WikiDifficulty = "easy" | "medium" | "hard";

export interface WikiArticle {
  id: UUID;
  tenant_id: UUID;

  // Content
  title: string;
  slug: string;
  content: string | null;
  excerpt: string | null;

  // Organization
  category: string | null;
  tags: string | null; // JSON array

  // Authorship
  author_id: UUID | null;
  last_edited_by: UUID | null;

  // Product link
  product_id: UUID | null;

  // Publishing
  is_published: SqliteBoolean;
  published_at: Timestamp | null;

  // SEO
  meta_title: string | null;
  meta_description: string | null;
  featured_image_url: string | null;

  // Frontend wiki fields (migration 0012)
  description: string | null;
  estimated_time_minutes: number | null;
  difficulty: WikiDifficulty | null;
  tools_required: string | null; // JSON array
  sections: string | null; // JSON array of WikiSection objects
  sku_id: UUID | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Camera {
  id: UUID;
  tenant_id: UUID;

  // Identification
  name: string;
  description: string | null;

  // Association
  printer_id: UUID | null;
  hub_id: UUID | null;

  // Camera type
  camera_type: CameraType;

  // Connection details
  stream_url: string | null;
  snapshot_url: string | null;
  ip_address: string | null;
  port: number | null;
  username: string | null;
  password: string | null;

  // Bambu specific
  serial_number: string | null;

  // Status
  is_active: SqliteBoolean;
  is_online: SqliteBoolean;
  last_snapshot_at: Timestamp | null;
  last_error: string | null;

  // Display settings
  rotation: number;
  flip_horizontal: SqliteBoolean;
  flip_vertical: SqliteBoolean;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AutomationRule {
  id: UUID;
  tenant_id: UUID;

  // Identification
  name: string;
  description: string | null;

  // Trigger
  trigger_type: AutomationTriggerType;
  trigger_conditions: string | null; // JSON

  // Action
  action_type: AutomationActionType;
  action_config: string | null; // JSON

  // Targeting
  printer_ids: string | null; // JSON array
  product_ids: string | null; // JSON array

  // Schedule
  schedule_cron: string | null;
  schedule_timezone: string;

  // Status
  is_enabled: SqliteBoolean;
  last_triggered_at: Timestamp | null;
  trigger_count: number;

  // Rate limiting
  cooldown_seconds: number;
  max_triggers_per_hour: number | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// MIGRATION 0008: LOGGING & ANALYTICS
// =============================================================================

export interface SyncLog {
  id: number; // Auto-incrementing
  tenant_id: UUID | null;

  // Operation details
  operation_type: SyncOperationType | null;
  table_name: string | null;
  record_id: string | null;

  // Status
  status: SyncStatus | null;
  error_message: string | null;

  // Timestamps
  created_at: Timestamp;
}

export interface AuditLog {
  id: UUID;
  tenant_id: UUID;

  // Who
  user_id: UUID | null;

  // What
  action: string;
  table_name: string | null;
  record_id: string | null;

  // Change details (JSON)
  old_values: string | null;
  new_values: string | null;
  metadata: string | null;

  // Request context
  ip_address: string | null;
  user_agent: string | null;

  // Timestamps
  created_at: Timestamp;
}

export interface PrinterFailure {
  id: UUID;
  tenant_id: UUID;

  // References
  printer_id: UUID | null;
  print_job_id: UUID | null;

  // Failure details
  failure_type: FailureType;
  failure_reason: string | null;
  error_code: string | null;

  // Context
  progress_at_failure: number | null;
  print_time_at_failure: number | null;
  layer_at_failure: number | null;

  // Resolution
  resolution: string | null;
  resolved_at: Timestamp | null;
  resolved_by: UUID | null;

  // Timestamps
  created_at: Timestamp;
}

export interface DailyAnalytics {
  id: UUID;
  tenant_id: UUID;

  // Date
  date: string; // YYYY-MM-DD

  // Revenue (cents)
  revenue: number;
  profit: number;

  // Print metrics
  print_completion_percentage: number;
  jobs_completed: number;
  jobs_failed: number;
  units_produced: number;

  // Printer metrics
  active_printers: number;
  total_printers: number;
  utilization_percentage: number;

  // Time metrics
  average_job_time_minutes: number;
  total_print_time_minutes: number;
  time_saved_minutes: number;

  // Cost metrics (cents)
  materials_cost: number;
  labor_cost: number;
  overhead_cost: number;

  // Timestamps
  created_at: Timestamp;
}

export interface MaterialUsageHistory {
  id: UUID;
  tenant_id: UUID;

  // Material reference
  material_type: MaterialType;
  material_id: UUID;

  // Usage details
  print_job_id: UUID | null;
  usage_amount: number;
  usage_date: Timestamp;
  reason: string | null;

  // Timestamps
  created_at: Timestamp;
}

export interface FilamentInventory {
  id: UUID;
  tenant_id: UUID;

  // Details
  type: string;
  color: string;
  hex_code: string | null;
  brand: string | null;
  diameter: string;

  // Stock levels
  remaining_grams: number;
  spool_weight_grams: number;
  low_threshold: number;

  // Status
  status: InventoryStatus;

  // Location and cost
  location: string | null;
  cost_per_unit: number | null; // cents
  reorder_link: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PackagingInventory {
  id: UUID;
  tenant_id: UUID;

  // Details
  type: string;
  name: string | null;
  color: string | null;
  brand: string | null;
  size: string | null;

  // Stock levels
  remaining_units: number;
  low_threshold: number;

  // Status
  status: InventoryStatus;

  // Location and cost
  location: string | null;
  cost_per_unit: number | null; // cents
  reorder_link: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AccessoriesInventory {
  id: UUID;
  tenant_id: UUID;

  // Details
  type: string;
  name: string | null;
  color: string | null;
  brand: string | null;
  diameter: string | null;
  size: string | null;

  // Stock levels
  remaining_units: number;
  low_threshold: number;

  // Status
  status: InventoryStatus;

  // Location and cost
  location: string | null;
  cost_per_unit: number | null; // cents
  reorder_link: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PrinterPartsInventory {
  id: UUID;
  tenant_id: UUID;

  // Details
  type: string;
  name: string | null;
  color: string | null;
  brand: string | null;
  compatible_models: string | null; // JSON array

  // Stock levels
  remaining_units: number;
  low_threshold: number;

  // Status
  status: InventoryStatus;

  // Location and cost
  location: string | null;
  cost_per_unit: number | null; // cents
  reorder_link: string | null;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

/** Standard API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

/** Pagination parameters */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/** Generic list response */
export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// =============================================================================
// WEBSOCKET MESSAGE TYPES
// =============================================================================

/** Hub → Cloud messages */
export type HubToCloudMessage =
  | HubHelloMessage
  | PrinterStatusMessage
  | FileProgressMessage
  | CommandAckMessage
  | PrinterDiscoveredMessage;

export interface HubHelloMessage {
  type: "hub_hello";
  hub_id: string;
  firmware_version: string;
  hardware_version?: string;
  mac_address?: string;
}

export interface PrinterStatusMessage {
  type: "printer_status";
  printer_id: string;
  status: PrinterStatus;
  is_connected?: boolean;
  progress_percentage?: number;
  remaining_time_seconds?: number;
  current_layer?: number;
  total_layers?: number;
  temperatures?: {
    nozzle?: number;
    nozzle_target?: number;
    bed?: number;
    bed_target?: number;
    chamber?: number;
  };
  error_code?: string;
  error_message?: string;
}

export interface FileProgressMessage {
  type: "file_progress";
  printer_id: string;
  job_id: string;
  stage: "downloading" | "uploading" | "complete" | "failed";
  progress_percentage: number;
  error?: string;
}

export interface CommandAckMessage {
  type: "command_ack";
  command_id: string;
  success: boolean;
  error?: string;
}

export interface PrinterDiscoveredMessage {
  type: "printer_discovered";
  printers: Array<{
    serial_number: string;
    ip_address: string;
    model: string;
    name?: string;
  }>;
}

/** Cloud → Hub messages */
export type CloudToHubMessage =
  | ConfigurePrinterMessage
  | PrintCommandMessage
  | PrinterCommandMessage
  | DiscoverPrintersMessage
  | HubCommandMessage
  | HubConfigMessage;

export interface ConfigurePrinterMessage {
  type: "configure_printer";
  command_id: string;
  action: "add" | "remove" | "update";
  printer: {
    id: string;
    serial_number: string;
    access_code?: string;
    ip_address?: string;
    connection_type: PrinterConnectionType;
  };
}

export interface PrintCommandMessage {
  type: "print_command";
  command_id: string;
  printer_id: string;
  job_id: string;
  action: "start";
  file_url: string;
  file_name: string;
}

export interface PrinterCommandMessage {
  type: "printer_command";
  command_id: string;
  printer_id: string;
  action: "pause" | "resume" | "stop" | "clear_bed" | "light_on" | "light_off";
}

export interface DiscoverPrintersMessage {
  type: "discover_printers";
  command_id: string;
}

export interface HubCommandMessage {
  type: "hub_command";
  command_id: string;
  action: "disconnect" | "gpio_set";
  gpio_pin?: number;      // For gpio_set
  gpio_state?: boolean;   // For gpio_set: true = HIGH, false = LOW
}

export interface HubConfigMessage {
  type: "hub_config";
  command_id: string;
  hub_name?: string | undefined;
}

/** Dashboard WebSocket messages */
export type DashboardClientMessage =
  | DashboardAuthMessage
  | DashboardSubscribeMessage;

export interface DashboardAuthMessage {
  type: "auth";
  token: string;
}

export interface DashboardSubscribeMessage {
  type: "subscribe";
  printers?: string[];
  unsubscribe?: boolean;
}

export type DashboardServerMessage =
  | DashboardAuthResultMessage
  | DashboardPrinterStatusMessage
  | DashboardJobUpdateMessage
  | DashboardHubStatusMessage
  | DashboardInventoryAlertMessage
  | DashboardNewOrderMessage;

export interface DashboardAuthResultMessage {
  type: "auth_success" | "auth_error";
  error?: string;
}

export interface DashboardPrinterStatusMessage {
  type: "printer_status";
  printer_id: string;
  status: PrinterStatus;
  is_connected?: boolean;
  progress_percentage?: number;
  remaining_time_seconds?: number;
  current_layer?: number;
  total_layers?: number;
  temperatures?: {
    nozzle?: number;
    nozzle_target?: number;
    bed?: number;
    bed_target?: number;
    chamber?: number;
  };
}

export interface DashboardJobUpdateMessage {
  type: "job_update";
  job_id: string;
  status: PrintJobStatus;
  progress_percentage?: number;
  printer_id?: string;
}

export interface DashboardHubStatusMessage {
  type: "hub_status";
  hub_id: string;
  is_online: boolean;
}

export interface DashboardInventoryAlertMessage {
  type: "inventory_alert";
  sku_id: string;
  sku: string;
  current_stock: number;
  threshold: number;
}

export interface DashboardNewOrderMessage {
  type: "new_order";
  order_id: string;
  order_number: string;
  platform: OrderPlatform;
  total_items: number;
}
