/**
 * PrintFarm Data Transformers
 *
 * Transforms data between API format (snake_case) and frontend format (camelCase).
 * These functions handle the conversion for all entity types.
 */

import type {
  Printer as ApiPrinter,
  PrintJob as ApiPrintJob,
  PrintFile as ApiPrintFile,
  Product as ApiProduct,
  ProductSku as ApiProductSku,
  Order as ApiOrder,
  OrderItem as ApiOrderItem,
  FinishedGood as ApiFinishedGood,
  WorklistTask as ApiWorklistTask,
  AssemblyTask as ApiAssemblyTask,
  ColorPreset as ApiColorPreset,
  BuildPlateType as ApiBuildPlateType,
  Hub as ApiHub,
  WikiArticle as ApiWikiArticle,
  PrinterStatus,
  PrintJobStatus,
  SqliteBoolean,
} from '@/types/api';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/** Convert SQLite boolean (0/1) to JavaScript boolean */
export const fromSqliteBoolean = (value: SqliteBoolean | boolean | undefined | null): boolean => {
  if (value === undefined || value === null) return false;
  return value === 1 || value === true;
};

/** Convert JavaScript boolean to SQLite boolean (0/1) */
export const toSqliteBoolean = (value: boolean | undefined | null): SqliteBoolean => {
  return value ? 1 : 0;
};

// =============================================================================
// PRINTER TRANSFORMERS
// =============================================================================

export interface FrontendPrinter {
  id: string;
  tenantId: string;
  hubId: string | null;
  name: string;
  model: string;
  manufacturer: string | null;
  firmwareVersion: string | null;
  totalPrintTime: number;
  lastMaintenanceDate: string | null;
  status: PrinterStatus;
  currentColor: string | null;
  currentColorHex: string | null;
  currentFilamentType: string | null;
  currentBuildPlate: string | null;
  filamentLevel: number;
  nozzleSize: number | null;
  location: string | null;
  connectionType: string;
  ipAddress: string | null;
  serialNumber: string | null;
  accessCode: string | null;
  connected: boolean;
  lastConnectionAttempt: string | null;
  connectionError: string | null;
  isActive: boolean;
  cleared: boolean;
  sortOrder: number;
  printerId: number | null;
  inMaintenance: boolean;
  maintenanceType: string | null;
  createdAt: string;
  updatedAt: string;
}

export const transformPrinterFromDb = (printer: ApiPrinter): FrontendPrinter => {
  return {
    id: printer.id,
    tenantId: printer.tenant_id,
    hubId: printer.hub_id,
    name: printer.name,
    model: printer.model,
    manufacturer: printer.manufacturer,
    firmwareVersion: printer.firmware_version,
    totalPrintTime: printer.total_print_time,
    lastMaintenanceDate: printer.last_maintenance_date,
    status: printer.status,
    currentColor: printer.current_color,
    currentColorHex: printer.current_color_hex,
    currentFilamentType: printer.current_filament_type,
    currentBuildPlate: printer.current_build_plate,
    filamentLevel: printer.filament_level,
    nozzleSize: printer.nozzle_size,
    location: printer.location,
    connectionType: printer.connection_type,
    ipAddress: printer.ip_address,
    serialNumber: printer.serial_number,
    accessCode: printer.access_code,
    connected: fromSqliteBoolean(printer.is_connected),
    lastConnectionAttempt: printer.last_connection_attempt,
    connectionError: printer.connection_error,
    isActive: fromSqliteBoolean(printer.is_active),
    cleared: fromSqliteBoolean(printer.cleared),
    sortOrder: printer.sort_order,
    printerId: printer.printer_id,
    inMaintenance: fromSqliteBoolean(printer.in_maintenance),
    maintenanceType: printer.maintenance_type,
    createdAt: printer.created_at,
    updatedAt: printer.updated_at,
  };
};

export const transformPrinterToDb = (printer: Partial<FrontendPrinter>): Partial<ApiPrinter> => {
  const result: Partial<ApiPrinter> = {};

  if (printer.name !== undefined) result.name = printer.name;
  if (printer.model !== undefined) result.model = printer.model;
  if (printer.manufacturer !== undefined) result.manufacturer = printer.manufacturer;
  if (printer.firmwareVersion !== undefined) result.firmware_version = printer.firmwareVersion;
  if (printer.location !== undefined) result.location = printer.location;
  if (printer.ipAddress !== undefined) result.ip_address = printer.ipAddress;
  if (printer.serialNumber !== undefined) result.serial_number = printer.serialNumber;
  if (printer.accessCode !== undefined) result.access_code = printer.accessCode;
  if (printer.sortOrder !== undefined) result.sort_order = printer.sortOrder;
  if (printer.status !== undefined) result.status = printer.status;
  if (printer.currentColor !== undefined) result.current_color = printer.currentColor;
  if (printer.currentColorHex !== undefined) result.current_color_hex = printer.currentColorHex;
  if (printer.currentFilamentType !== undefined) result.current_filament_type = printer.currentFilamentType;
  if (printer.currentBuildPlate !== undefined) result.current_build_plate = printer.currentBuildPlate;
  if (printer.filamentLevel !== undefined) result.filament_level = printer.filamentLevel;
  if (printer.nozzleSize !== undefined) result.nozzle_size = printer.nozzleSize;
  if (printer.inMaintenance !== undefined) result.in_maintenance = toSqliteBoolean(printer.inMaintenance);
  if (printer.maintenanceType !== undefined) result.maintenance_type = printer.maintenanceType;
  if (printer.cleared !== undefined) result.cleared = toSqliteBoolean(printer.cleared);

  return result;
};

// =============================================================================
// PRINT JOB TRANSFORMERS
// =============================================================================

export interface FrontendPrintJob {
  id: string;
  tenantId: string;
  printerId: string | null;
  printFileId: string;
  productSkuId: string | null;
  submittedBy: string | null;
  fileName: string;
  status: PrintJobStatus;
  color: string;
  filamentType: string;
  materialType: string;
  numberOfUnits: number;
  filamentNeededGrams: number | null;
  estimatedPrintTimeMinutes: number | null;
  actualPrintTimeMinutes: number | null;
  progressPercentage: number;
  bambuJobId: string | null;
  printerNumericId: number | null;
  lastSyncTime: string | null;
  priority: number;
  failureReason: string | null;
  timeSubmitted: string;
  timeStarted: string | null;
  timeCompleted: string | null;
  requiresAssembly: boolean;
  quantityPerPrint: number;
  productId: string | null;
  productName: string | null;
  skuName: string | null;
  printerModel: string | null;
  printerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export const transformPrintJobFromDb = (job: ApiPrintJob): FrontendPrintJob => {
  return {
    id: job.id,
    tenantId: job.tenant_id,
    printerId: job.printer_id,
    printFileId: job.print_file_id,
    productSkuId: job.product_sku_id,
    submittedBy: job.submitted_by,
    fileName: job.file_name,
    status: job.status,
    color: job.color,
    filamentType: job.filament_type,
    materialType: job.material_type,
    numberOfUnits: job.number_of_units,
    filamentNeededGrams: job.filament_needed_grams,
    estimatedPrintTimeMinutes: job.estimated_print_time_minutes,
    actualPrintTimeMinutes: job.actual_print_time_minutes,
    progressPercentage: job.progress_percentage,
    bambuJobId: job.bambu_job_id,
    printerNumericId: job.printer_numeric_id,
    lastSyncTime: job.last_sync_time,
    priority: job.priority,
    failureReason: job.failure_reason,
    timeSubmitted: job.time_submitted,
    timeStarted: job.time_started,
    timeCompleted: job.time_completed,
    requiresAssembly: fromSqliteBoolean(job.requires_assembly),
    quantityPerPrint: job.quantity_per_print,
    productId: job.product_id,
    productName: job.product_name,
    skuName: job.sku_name,
    printerModel: job.printer_model,
    printerName: job.printer_name,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
};

export const transformPrintJobToDb = (job: Partial<FrontendPrintJob>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  if (job.printerId !== undefined) result.printer_id = job.printerId;
  if (job.printFileId !== undefined) result.print_file_id = job.printFileId;
  if (job.productSkuId !== undefined) result.product_sku_id = job.productSkuId;
  if (job.fileName !== undefined) result.file_name = job.fileName;
  if (job.status !== undefined) result.status = job.status;
  if (job.color !== undefined) result.color = job.color;
  if (job.filamentType !== undefined) result.filament_type = job.filamentType;
  if (job.materialType !== undefined) result.material_type = job.materialType;
  if (job.numberOfUnits !== undefined) result.number_of_units = job.numberOfUnits;
  if (job.priority !== undefined) result.priority = job.priority;
  if (job.failureReason !== undefined) result.failure_reason = job.failureReason;

  return result;
};

// =============================================================================
// PRINT FILE TRANSFORMERS
// =============================================================================

export interface FrontendPrintFile {
  id: string;
  tenantId: string;
  productId: string | null;
  name: string;
  fileSizeBytes: number | null;
  numberOfUnits: number;
  localFilePath: string | null;
  r2Key: string | null;
  printTimeSeconds: number | null;
  filamentWeightGrams: number | null;
  filamentLengthMeters: number | null;
  filamentType: string | null;
  printerModelId: string | null;
  nozzleDiameter: number | null;
  layerCount: number | null;
  currBedType: string | null;
  defaultPrintProfile: string | null;
  objectCount: number;
  thumbnailR2Key: string | null;
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const transformPrintFileFromDb = (file: ApiPrintFile & { thumbnail_url?: string }): FrontendPrintFile => {
  return {
    id: file.id,
    tenantId: file.tenant_id,
    productId: file.product_id,
    name: file.name,
    fileSizeBytes: file.file_size_bytes,
    numberOfUnits: file.number_of_units,
    localFilePath: file.local_file_path,
    r2Key: file.r2_key,
    printTimeSeconds: file.print_time_seconds,
    filamentWeightGrams: file.filament_weight_grams,
    filamentLengthMeters: file.filament_length_meters,
    filamentType: file.filament_type,
    printerModelId: file.printer_model_id,
    nozzleDiameter: file.nozzle_diameter,
    layerCount: file.layer_count,
    currBedType: file.curr_bed_type,
    defaultPrintProfile: file.default_print_profile,
    objectCount: file.object_count,
    thumbnailR2Key: file.thumbnail_r2_key,
    thumbnailUrl: file.thumbnail_url,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
  };
};

export const transformPrintFileToDb = (file: Partial<FrontendPrintFile>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  if (file.productId !== undefined) result.product_id = file.productId;
  if (file.name !== undefined) result.name = file.name;
  if (file.numberOfUnits !== undefined) result.number_of_units = file.numberOfUnits;

  return result;
};

// =============================================================================
// PRODUCT TRANSFORMERS
// =============================================================================

export interface FrontendProduct {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  category: string | null;
  printFileId: string | null;
  fileName: string | null;
  requiresAssembly: boolean;
  requiresPostProcessing: boolean;
  printerPriority: string | null;
  imageUrl: string | null;
  isActive: boolean;
  wikiId: string | null;
  createdAt: string;
  updatedAt: string;
  skus?: FrontendProductSku[];
}

export const transformProductFromDb = (product: ApiProduct & { skus?: ApiProductSku[] }): FrontendProduct => {
  return {
    id: product.id,
    tenantId: product.tenant_id,
    name: product.name,
    description: product.description,
    category: product.category,
    printFileId: product.print_file_id,
    fileName: product.file_name,
    requiresAssembly: fromSqliteBoolean(product.requires_assembly),
    requiresPostProcessing: fromSqliteBoolean(product.requires_post_processing),
    printerPriority: product.printer_priority,
    imageUrl: product.image_url,
    isActive: fromSqliteBoolean(product.is_active),
    wikiId: product.wiki_id,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
    skus: product.skus?.map(transformProductSkuFromDb),
  };
};

export const transformProductToDb = (product: Partial<FrontendProduct>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  if (product.name !== undefined) result.name = product.name;
  if (product.description !== undefined) result.description = product.description;
  if (product.category !== undefined) result.category = product.category;
  if (product.printFileId !== undefined) result.print_file_id = product.printFileId;
  if (product.fileName !== undefined) result.file_name = product.fileName;
  if (product.requiresAssembly !== undefined) result.requires_assembly = toSqliteBoolean(product.requiresAssembly);
  if (product.requiresPostProcessing !== undefined) result.requires_post_processing = toSqliteBoolean(product.requiresPostProcessing);
  if (product.printerPriority !== undefined) result.printer_priority = product.printerPriority;
  if (product.wikiId !== undefined) result.wiki_id = product.wikiId;
  if (product.isActive !== undefined) result.is_active = toSqliteBoolean(product.isActive);

  return result;
};

// =============================================================================
// PRODUCT SKU TRANSFORMERS
// =============================================================================

export interface FrontendProductSku {
  id: string;
  productId: string;
  tenantId: string;
  sku: string;
  color: string;
  filamentType: string | null;
  hexCode: string | null;
  quantity: number;
  stockLevel: number;
  price: number | null;
  lowStockThreshold: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const transformProductSkuFromDb = (sku: ApiProductSku): FrontendProductSku => {
  return {
    id: sku.id,
    productId: sku.product_id,
    tenantId: sku.tenant_id,
    sku: sku.sku,
    color: sku.color,
    filamentType: sku.filament_type,
    hexCode: sku.hex_code,
    quantity: sku.quantity,
    stockLevel: sku.stock_level,
    price: sku.price,
    lowStockThreshold: sku.low_stock_threshold,
    isActive: fromSqliteBoolean(sku.is_active),
    createdAt: sku.created_at,
    updatedAt: sku.updated_at,
  };
};

export const transformProductSkuToDb = (sku: Partial<FrontendProductSku>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  if (sku.sku !== undefined) result.sku = sku.sku;
  if (sku.color !== undefined) result.color = sku.color;
  if (sku.filamentType !== undefined) result.filament_type = sku.filamentType;
  if (sku.hexCode !== undefined) result.hex_code = sku.hexCode;
  if (sku.quantity !== undefined) result.quantity = sku.quantity;
  if (sku.stockLevel !== undefined) result.stock_level = sku.stockLevel;
  if (sku.price !== undefined) result.price = sku.price;
  if (sku.lowStockThreshold !== undefined) result.low_stock_threshold = sku.lowStockThreshold;
  if (sku.isActive !== undefined) result.is_active = toSqliteBoolean(sku.isActive);

  return result;
};

// =============================================================================
// ORDER TRANSFORMERS
// =============================================================================

export interface FrontendOrder {
  id: string;
  tenantId: string;
  orderNumber: string;
  platform: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  orderDate: string;
  status: string;
  totalRevenue: number;
  shippingCost: number;
  taxAmount: number;
  discountAmount: number;
  shippingStreet: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZip: string | null;
  shippingCountry: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  externalId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items?: FrontendOrderItem[];
}

export interface FrontendOrderItem {
  id: string;
  orderId: string;
  finishedGoodId: string | null;
  productSkuId: string | null;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  quantityFulfilled: number;
  fulfillmentStatus: string;
  notes: string | null;
  createdAt: string;
}

export const transformOrderFromDb = (order: ApiOrder & { items?: ApiOrderItem[] }): FrontendOrder => {
  return {
    id: order.id,
    tenantId: order.tenant_id,
    orderNumber: order.order_number,
    platform: order.platform,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    customerPhone: order.customer_phone,
    orderDate: order.order_date,
    status: order.status,
    totalRevenue: order.total_revenue,
    shippingCost: order.shipping_cost,
    taxAmount: order.tax_amount,
    discountAmount: order.discount_amount,
    shippingStreet: order.shipping_street,
    shippingCity: order.shipping_city,
    shippingState: order.shipping_state,
    shippingZip: order.shipping_zip,
    shippingCountry: order.shipping_country,
    trackingNumber: order.tracking_number,
    trackingUrl: order.tracking_url,
    shippedAt: order.shipped_at,
    externalId: order.external_id,
    notes: order.notes,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: order.items?.map(transformOrderItemFromDb),
  };
};

export const transformOrderItemFromDb = (item: ApiOrderItem): FrontendOrderItem => {
  return {
    id: item.id,
    orderId: item.order_id,
    finishedGoodId: item.finished_good_id,
    productSkuId: item.product_sku_id,
    sku: item.sku,
    productName: item.product_name,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    totalPrice: item.total_price,
    quantityFulfilled: item.quantity_fulfilled,
    fulfillmentStatus: item.fulfillment_status,
    notes: item.notes,
    createdAt: item.created_at,
  };
};

export const transformOrderToDb = (order: Partial<FrontendOrder>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  if (order.orderNumber !== undefined) result.order_number = order.orderNumber;
  if (order.platform !== undefined) result.platform = order.platform;
  if (order.customerName !== undefined) result.customer_name = order.customerName;
  if (order.customerEmail !== undefined) result.customer_email = order.customerEmail;
  if (order.customerPhone !== undefined) result.customer_phone = order.customerPhone;
  if (order.orderDate !== undefined) result.order_date = order.orderDate;
  if (order.status !== undefined) result.status = order.status;
  if (order.totalRevenue !== undefined) result.total_revenue = order.totalRevenue;
  if (order.shippingCost !== undefined) result.shipping_cost = order.shippingCost;
  if (order.taxAmount !== undefined) result.tax_amount = order.taxAmount;
  if (order.discountAmount !== undefined) result.discount_amount = order.discountAmount;
  if (order.shippingStreet !== undefined) result.shipping_street = order.shippingStreet;
  if (order.shippingCity !== undefined) result.shipping_city = order.shippingCity;
  if (order.shippingState !== undefined) result.shipping_state = order.shippingState;
  if (order.shippingZip !== undefined) result.shipping_zip = order.shippingZip;
  if (order.shippingCountry !== undefined) result.shipping_country = order.shippingCountry;
  if (order.trackingNumber !== undefined) result.tracking_number = order.trackingNumber;
  if (order.trackingUrl !== undefined) result.tracking_url = order.trackingUrl;
  if (order.notes !== undefined) result.notes = order.notes;

  return result;
};

// =============================================================================
// FINISHED GOOD TRANSFORMERS
// =============================================================================

export interface FrontendFinishedGood {
  id: string;
  tenantId: string;
  productSkuId: string;
  printJobId: string | null;
  sku: string;
  color: string;
  material: string;
  currentStock: number;
  lowStockThreshold: number;
  quantityPerSku: number;
  unitPrice: number;
  extraCost: number;
  profitMargin: number;
  requiresAssembly: boolean;
  quantityAssembled: number;
  quantityNeedsAssembly: number;
  status: string;
  assemblyStatus: string;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const transformFinishedGoodFromDb = (fg: ApiFinishedGood): FrontendFinishedGood => {
  return {
    id: fg.id,
    tenantId: fg.tenant_id,
    productSkuId: fg.product_sku_id,
    printJobId: fg.print_job_id,
    sku: fg.sku,
    color: fg.color,
    material: fg.material,
    currentStock: fg.current_stock,
    lowStockThreshold: fg.low_stock_threshold,
    quantityPerSku: fg.quantity_per_sku,
    unitPrice: fg.unit_price,
    extraCost: fg.extra_cost,
    profitMargin: fg.profit_margin,
    requiresAssembly: fromSqliteBoolean(fg.requires_assembly),
    quantityAssembled: fg.quantity_assembled,
    quantityNeedsAssembly: fg.quantity_needs_assembly,
    status: fg.status,
    assemblyStatus: fg.assembly_status,
    imageUrl: fg.image_url,
    isActive: fromSqliteBoolean(fg.is_active),
    createdAt: fg.created_at,
    updatedAt: fg.updated_at,
  };
};

// =============================================================================
// WORKLIST TASK TRANSFORMERS
// =============================================================================

export interface FrontendWorklistTask {
  id: string;
  tenantId: string;
  assemblyTaskId: string | null;
  printerId: string | null;
  assignedTo: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  taskType: string;
  priority: string;
  status: string;
  estimatedTimeMinutes: number | null;
  actualTimeMinutes: number | null;
  startedAt: string | null;
  completedAt: string | null;
  dueDate: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export const transformWorklistTaskFromDb = (task: ApiWorklistTask): FrontendWorklistTask => {
  return {
    id: task.id,
    tenantId: task.tenant_id,
    assemblyTaskId: task.assembly_task_id,
    printerId: task.printer_id,
    assignedTo: task.assigned_to,
    title: task.title,
    subtitle: task.subtitle,
    description: task.description,
    taskType: task.task_type,
    priority: task.priority,
    status: task.status,
    estimatedTimeMinutes: task.estimated_time_minutes,
    actualTimeMinutes: task.actual_time_minutes,
    startedAt: task.started_at,
    completedAt: task.completed_at,
    dueDate: task.due_date,
    metadata: task.metadata,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
};

export const transformWorklistTaskToDb = (task: Partial<FrontendWorklistTask>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  if (task.assemblyTaskId !== undefined) result.assembly_task_id = task.assemblyTaskId;
  if (task.printerId !== undefined) result.printer_id = task.printerId;
  if (task.assignedTo !== undefined) result.assigned_to = task.assignedTo;
  if (task.title !== undefined) result.title = task.title;
  if (task.subtitle !== undefined) result.subtitle = task.subtitle;
  if (task.description !== undefined) result.description = task.description;
  if (task.taskType !== undefined) result.task_type = task.taskType;
  if (task.priority !== undefined) result.priority = task.priority;
  if (task.status !== undefined) result.status = task.status;
  if (task.estimatedTimeMinutes !== undefined) result.estimated_time_minutes = task.estimatedTimeMinutes;
  if (task.dueDate !== undefined) result.due_date = task.dueDate;

  return result;
};

// =============================================================================
// ASSEMBLY TASK TRANSFORMERS
// =============================================================================

export interface FrontendAssemblyTask {
  id: string;
  tenantId: string;
  finishedGoodId: string;
  assignedTo: string | null;
  productName: string;
  sku: string;
  quantity: number;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export const transformAssemblyTaskFromDb = (task: ApiAssemblyTask): FrontendAssemblyTask => {
  return {
    id: task.id,
    tenantId: task.tenant_id,
    finishedGoodId: task.finished_good_id,
    assignedTo: task.assigned_to,
    productName: task.product_name,
    sku: task.sku,
    quantity: task.quantity,
    status: task.status,
    notes: task.notes,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    completedAt: task.completed_at,
  };
};

// =============================================================================
// COLOR PRESET TRANSFORMERS
// =============================================================================

export interface FrontendColorPreset {
  id: string;
  tenantId: string;
  colorName: string;
  hexCode: string;
  filamentType: string;
  isActive: boolean;
  createdAt: string;
}

export const transformColorPresetFromDb = (preset: ApiColorPreset): FrontendColorPreset => {
  return {
    id: preset.id,
    tenantId: preset.tenant_id,
    colorName: preset.color_name,
    hexCode: preset.hex_code,
    filamentType: preset.filament_type,
    isActive: fromSqliteBoolean(preset.is_active),
    createdAt: preset.created_at,
  };
};

// =============================================================================
// BUILD PLATE TYPE TRANSFORMERS
// =============================================================================

export interface FrontendBuildPlateType {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const transformBuildPlateTypeFromDb = (plate: ApiBuildPlateType): FrontendBuildPlateType => {
  return {
    id: plate.id,
    tenantId: plate.tenant_id,
    name: plate.name,
    description: plate.description,
    isActive: fromSqliteBoolean(plate.is_active),
    createdAt: plate.created_at,
    updatedAt: plate.updated_at,
  };
};

// =============================================================================
// HUB TRANSFORMERS
// =============================================================================

export interface FrontendHub {
  id: string;
  tenantId: string | null;
  name: string | null;
  firmwareVersion: string | null;
  hardwareVersion: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const transformHubFromDb = (hub: ApiHub): FrontendHub => {
  return {
    id: hub.id,
    tenantId: hub.tenant_id,
    name: hub.name,
    firmwareVersion: hub.firmware_version,
    hardwareVersion: hub.hardware_version,
    isOnline: fromSqliteBoolean(hub.is_online),
    lastSeenAt: hub.last_seen_at,
    ipAddress: hub.ip_address,
    macAddress: hub.mac_address,
    claimedAt: hub.claimed_at,
    createdAt: hub.created_at,
    updatedAt: hub.updated_at,
  };
};

// =============================================================================
// WIKI TRANSFORMERS
// =============================================================================

export interface FrontendWikiArticle {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  content: string | null;
  excerpt: string | null;
  category: string | null;
  tags: string | null;
  authorId: string | null;
  lastEditedBy: string | null;
  productId: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  featuredImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export const transformWikiArticleFromDb = (article: ApiWikiArticle): FrontendWikiArticle => {
  return {
    id: article.id,
    tenantId: article.tenant_id,
    title: article.title,
    slug: article.slug,
    content: article.content,
    excerpt: article.excerpt,
    category: article.category,
    tags: article.tags,
    authorId: article.author_id,
    lastEditedBy: article.last_edited_by,
    productId: article.product_id,
    isPublished: fromSqliteBoolean(article.is_published),
    publishedAt: article.published_at,
    metaTitle: article.meta_title,
    metaDescription: article.meta_description,
    featuredImageUrl: article.featured_image_url,
    createdAt: article.created_at,
    updatedAt: article.updated_at,
  };
};

export const transformWikiArticleToDb = (article: Partial<FrontendWikiArticle>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  if (article.title !== undefined) result.title = article.title;
  if (article.slug !== undefined) result.slug = article.slug;
  if (article.content !== undefined) result.content = article.content;
  if (article.excerpt !== undefined) result.excerpt = article.excerpt;
  if (article.category !== undefined) result.category = article.category;
  if (article.tags !== undefined) result.tags = article.tags;
  if (article.productId !== undefined) result.product_id = article.productId;
  if (article.isPublished !== undefined) result.is_published = toSqliteBoolean(article.isPublished);
  if (article.metaTitle !== undefined) result.meta_title = article.metaTitle;
  if (article.metaDescription !== undefined) result.meta_description = article.metaDescription;
  if (article.featuredImageUrl !== undefined) result.featured_image_url = article.featuredImageUrl;

  return result;
};
