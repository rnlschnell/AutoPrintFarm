/**
 * PrintFarm Cloud API Types
 *
 * TypeScript types matching the Cloudflare Workers API.
 * These mirror the types in cloud/src/types/index.ts for frontend use.
 */

// =============================================================================
// COMMON TYPES
// =============================================================================

/** UUID string type for all entity IDs */
export type UUID = string;

/** ISO8601 timestamp string */
export type Timestamp = string;

/** Boolean stored as integer in SQLite (0 or 1) - frontend converts to boolean */
export type SqliteBoolean = 0 | 1;

// =============================================================================
// ENUMS
// =============================================================================

export type TenantMemberRole = 'owner' | 'admin' | 'operator' | 'viewer';

export type PrinterStatus =
  | 'idle'
  | 'printing'
  | 'paused'
  | 'maintenance'
  | 'offline'
  | 'error';

export type PrinterConnectionType =
  | 'bambu'
  | 'prusa'
  | 'octoprint'
  | 'klipper'
  | 'other';

export type PrintJobStatus =
  | 'queued'
  | 'processing'
  | 'uploaded'
  | 'printing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type FinishedGoodStatus =
  | 'active'
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'needs_assembly'
  | 'discontinued';

export type AssemblyStatus = 'printed' | 'needs_assembly' | 'assembled';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TaskType =
  | 'assembly'
  | 'filament_change'
  | 'collection'
  | 'maintenance'
  | 'quality_check';

export type TaskPriority = 'low' | 'medium' | 'high';

export type OrderPlatform =
  | 'shopify'
  | 'amazon'
  | 'etsy'
  | 'manual'
  | 'other';

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'printed'
  | 'assembled'
  | 'shipped'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

export type FulfillmentStatus = 'pending' | 'partial' | 'fulfilled' | 'cancelled';

export type CameraType = 'bambu' | 'ip' | 'usb' | 'rtsp' | 'mjpeg';

export type InventoryStatus = 'in_stock' | 'low' | 'out_of_stock' | 'on_order';

// =============================================================================
// API ENTITIES
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

export interface Hub {
  id: UUID;
  tenant_id: UUID | null;
  name: string | null;
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
  name: string;
  model: string;
  manufacturer: string | null;
  firmware_version: string | null;
  total_print_time: number;
  last_maintenance_date: string | null;
  status: PrinterStatus;
  current_color: string | null;
  current_color_hex: string | null;
  current_filament_type: string | null;
  current_build_plate: string | null;
  filament_level: number;
  nozzle_size: number | null;
  location: string | null;
  connection_type: PrinterConnectionType;
  ip_address: string | null;
  serial_number: string | null;
  access_code: string | null;
  is_connected: SqliteBoolean;
  last_connection_attempt: Timestamp | null;
  connection_error: string | null;
  is_active: SqliteBoolean;
  cleared: SqliteBoolean;
  sort_order: number;
  printer_id: number | null;
  in_maintenance: SqliteBoolean;
  maintenance_type: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Product {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description: string | null;
  category: string | null;
  print_file_id: UUID | null;
  file_name: string | null;
  requires_assembly: SqliteBoolean;
  requires_post_processing: SqliteBoolean;
  printer_priority: string | null;
  image_url: string | null;
  is_active: SqliteBoolean;
  wiki_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProductSku {
  id: UUID;
  product_id: UUID;
  tenant_id: UUID;
  sku: string;
  color: string;
  filament_type: string | null;
  hex_code: string | null;
  quantity: number;
  stock_level: number;
  price: number | null;
  low_stock_threshold: number;
  is_active: SqliteBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ColorPreset {
  id: UUID;
  tenant_id: UUID;
  color_name: string;
  hex_code: string;
  filament_type: string;
  is_active: SqliteBoolean;
  created_at: Timestamp;
}

export interface BuildPlateType {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description: string | null;
  is_active: SqliteBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PrintFile {
  id: UUID;
  tenant_id: UUID;
  product_id: UUID | null;
  name: string;
  file_size_bytes: number | null;
  number_of_units: number;
  local_file_path: string | null;
  r2_key: string | null;
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
  thumbnail_r2_key: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PrintJob {
  id: UUID;
  tenant_id: UUID;
  printer_id: UUID | null;
  print_file_id: UUID;
  product_sku_id: UUID | null;
  submitted_by: UUID | null;
  file_name: string;
  status: PrintJobStatus;
  color: string;
  filament_type: string;
  material_type: string;
  number_of_units: number;
  filament_needed_grams: number | null;
  estimated_print_time_minutes: number | null;
  actual_print_time_minutes: number | null;
  progress_percentage: number;
  bambu_job_id: string | null;
  printer_numeric_id: number | null;
  last_sync_time: Timestamp | null;
  priority: number;
  failure_reason: string | null;
  time_submitted: Timestamp;
  time_started: Timestamp | null;
  time_completed: Timestamp | null;
  requires_assembly: SqliteBoolean;
  quantity_per_print: number;
  product_id: UUID | null;
  product_name: string | null;
  sku_name: string | null;
  printer_model: string | null;
  printer_name: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface FinishedGood {
  id: UUID;
  tenant_id: UUID;
  product_sku_id: UUID;
  print_job_id: UUID | null;
  sku: string;
  color: string;
  material: string;
  current_stock: number;
  low_stock_threshold: number;
  quantity_per_sku: number;
  unit_price: number;
  extra_cost: number;
  profit_margin: number;
  requires_assembly: SqliteBoolean;
  quantity_assembled: number;
  quantity_needs_assembly: number;
  status: FinishedGoodStatus;
  assembly_status: AssemblyStatus;
  image_url: string | null;
  is_active: SqliteBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AssemblyTask {
  id: UUID;
  tenant_id: UUID;
  finished_good_id: UUID;
  assigned_to: UUID | null;
  product_name: string;
  sku: string;
  quantity: number;
  status: TaskStatus;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  completed_at: Timestamp | null;
}

export interface WorklistTask {
  id: UUID;
  tenant_id: UUID;
  assembly_task_id: UUID | null;
  printer_id: UUID | null;
  assigned_to: UUID | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  order_number: string | null;
  estimated_time_minutes: number | null;
  actual_time_minutes: number | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  due_date: Timestamp | null;
  metadata: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Order {
  id: UUID;
  tenant_id: UUID;
  order_number: string;
  platform: OrderPlatform;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  order_date: Timestamp;
  status: OrderStatus;
  total_revenue: number;
  shipping_cost: number;
  tax_amount: number;
  discount_amount: number;
  shipping_street: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  shipping_country: string;
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: Timestamp | null;
  external_id: string | null;
  external_data: string | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrderItem {
  id: UUID;
  order_id: UUID;
  finished_good_id: UUID | null;
  product_sku_id: UUID | null;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  quantity_fulfilled: number;
  fulfillment_status: FulfillmentStatus;
  notes: string | null;
  created_at: Timestamp;
}

export interface WikiArticle {
  id: UUID;
  tenant_id: UUID;
  title: string;
  slug: string;
  content: string | null;
  excerpt: string | null;
  category: string | null;
  tags: string | null;
  author_id: UUID | null;
  last_edited_by: UUID | null;
  product_id: UUID | null;
  is_published: SqliteBoolean;
  published_at: Timestamp | null;
  meta_title: string | null;
  meta_description: string | null;
  featured_image_url: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Camera {
  id: UUID;
  tenant_id: UUID;
  name: string;
  description: string | null;
  printer_id: UUID | null;
  hub_id: UUID | null;
  camera_type: CameraType;
  stream_url: string | null;
  snapshot_url: string | null;
  ip_address: string | null;
  port: number | null;
  username: string | null;
  serial_number: string | null;
  is_active: SqliteBoolean;
  is_online: SqliteBoolean;
  last_snapshot_at: Timestamp | null;
  last_error: string | null;
  rotation: number;
  flip_horizontal: SqliteBoolean;
  flip_vertical: SqliteBoolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

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

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// =============================================================================
// SESSION / AUTH TYPES
// =============================================================================

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  token: string;
  user: User;
}

export interface AuthSession {
  session: Session | null;
  user: User | null;
}

// =============================================================================
// STATS / ANALYTICS TYPES
// =============================================================================

export interface JobStats {
  queued: number;
  processing: number;
  printing: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}

export interface InventoryStats {
  total_items: number;
  total_stock: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_value: number;
}

export interface AnalyticsOverview {
  printers: {
    total: number;
    online: number;
    printing: number;
    idle: number;
    maintenance: number;
    error: number;
  };
  jobs: {
    queued: number;
    printing: number;
    completed_today: number;
    failed_today: number;
  };
  tasks: {
    pending: number;
    in_progress: number;
  };
  hubs: {
    total: number;
    online: number;
  };
  alerts: {
    low_stock: number;
  };
}
