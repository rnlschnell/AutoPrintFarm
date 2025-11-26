/**
 * PrintFarm Cloud - Route Aggregator
 *
 * Exports all route handlers for mounting in the main app.
 * Routes are organized by resource/feature.
 */

// Health check routes (Phase 3)
export { health } from "./health";

// Auth routes (Phase 4)
export { auth } from "./auth";
export { tenants } from "./tenants";

// Printer management routes (Phase 5)
export { printers } from "./printers";
export { hubs } from "./hubs";

// Print files routes (Phase 6)
export { files } from "./files";

// Print jobs routes (Phase 7)
export { jobs } from "./jobs";

// Products & SKUs routes (Phase 8)
export { products } from "./products";
export { skus } from "./skus";
export { colors } from "./colors";
export { plates } from "./plates";

// Inventory routes (Phase 9)
export { inventory } from "./inventory";

// Orders & Integrations routes (Phase 10)
export { orders } from "./orders";
export { integrations } from "./integrations";
export { webhooks } from "./webhooks";

// Worklist & Assembly routes (Phase 11)
export { worklist } from "./worklist";
export { assembly } from "./assembly";

// Supporting features routes (Phase 12)
export { wiki } from "./wiki";
export { cameras } from "./cameras";
export { automation } from "./automation";
export { analytics } from "./analytics";

// Material inventory routes
export { materials } from "./materials";

// Admin routes (Phase 15)
export { admin } from "./admin";
