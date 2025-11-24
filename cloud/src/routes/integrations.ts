/**
 * Integrations Routes - External Platform Integration Management
 *
 * Manage connections to external platforms like Shopify, Amazon, Etsy.
 * Includes connection status, credential management, and manual sync triggers.
 * All routes are tenant-scoped.
 *
 * Phase 10: Orders & Shopify Integration
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId, encryptAES256GCM, decryptAES256GCM } from "../lib/crypto";

export const integrations = new Hono<HonoEnv>();

// =============================================================================
// TYPES
// =============================================================================

interface ShopifyCredentials {
  shop_domain: string;
  api_key: string;
  api_secret: string;
  access_token: string;
  webhook_secret?: string | undefined;
}

interface IntegrationStatus {
  platform: string;
  connected: boolean;
  shop_domain?: string;
  last_sync?: string;
  sync_enabled?: boolean;
  webhook_enabled?: boolean;
  error?: string;
}

interface TenantIntegration {
  id: string;
  tenant_id: string;
  platform: string;
  credentials_encrypted: string;
  is_enabled: number;
  sync_enabled: number;
  webhook_enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// SCHEMAS
// =============================================================================

const shopifyConnectSchema = z.object({
  shop_domain: z.string().min(1).max(255).regex(/^[a-zA-Z0-9-]+\.myshopify\.com$/),
  api_key: z.string().min(1).max(255),
  api_secret: z.string().min(1).max(255),
  access_token: z.string().min(1).max(255),
  webhook_secret: z.string().max(255).optional(),
});

const syncSettingsSchema = z.object({
  sync_enabled: z.boolean(),
  auto_import_orders: z.boolean().default(true),
  sync_inventory: z.boolean().default(false),
  sync_fulfillments: z.boolean().default(true),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get tenant integration record for a platform
 */
async function getTenantIntegration(
  db: D1Database,
  tenantId: string,
  platform: string
): Promise<TenantIntegration | null> {
  return db
    .prepare(
      "SELECT * FROM tenant_integrations WHERE tenant_id = ? AND platform = ?"
    )
    .bind(tenantId, platform)
    .first<TenantIntegration>();
}

/**
 * Test Shopify API connection
 */
async function testShopifyConnection(
  credentials: ShopifyCredentials
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `https://${credentials.shop_domain}/admin/api/2024-01/shop.json`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": credentials.access_token,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Shopify API error: ${response.status} - ${errorText}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// =============================================================================
// SHOPIFY STATUS
// =============================================================================

/**
 * GET /api/v1/integrations/shopify/status
 * Get Shopify connection status for the tenant
 */
integrations.get(
  "/shopify/status",
  requireAuth(),
  requireTenant(),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    const integration = await getTenantIntegration(c.env.DB, tenantId, "shopify");

    if (!integration) {
      return c.json({
        success: true,
        data: {
          platform: "shopify",
          connected: false,
        } as IntegrationStatus,
      });
    }

    // Decrypt credentials to get shop domain
    let shopDomain: string | undefined;
    try {
      const decrypted = await decryptAES256GCM(
        integration.credentials_encrypted,
        c.env.ENCRYPTION_KEY
      );
      const credentials = JSON.parse(decrypted) as ShopifyCredentials;
      shopDomain = credentials.shop_domain;
    } catch {
      // Credentials corrupted - return disconnected status
      return c.json({
        success: true,
        data: {
          platform: "shopify",
          connected: false,
          error: "Credentials invalid or corrupted",
        } as IntegrationStatus,
      });
    }

    return c.json({
      success: true,
      data: {
        platform: "shopify",
        connected: integration.is_enabled === 1,
        shop_domain: shopDomain,
        last_sync: integration.last_sync_at || undefined,
        sync_enabled: integration.sync_enabled === 1,
        webhook_enabled: integration.webhook_enabled === 1,
        error: integration.last_error || undefined,
      } as IntegrationStatus,
    });
  }
);

// =============================================================================
// SHOPIFY CONNECT
// =============================================================================

/**
 * POST /api/v1/integrations/shopify/connect
 * Connect Shopify store to tenant
 */
integrations.post(
  "/shopify/connect",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    // Parse and validate request body
    let body: z.infer<typeof shopifyConnectSchema>;
    try {
      const rawBody = await c.req.json();
      body = shopifyConnectSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Test the connection first
    const testResult = await testShopifyConnection(body);
    if (!testResult.success) {
      throw new ApiError(
        `Failed to connect to Shopify: ${testResult.error}`,
        400,
        "SHOPIFY_CONNECTION_FAILED"
      );
    }

    // Encrypt credentials
    const credentialsJson = JSON.stringify(body);
    const encryptedCredentials = await encryptAES256GCM(
      credentialsJson,
      c.env.ENCRYPTION_KEY
    );

    const now = new Date().toISOString();

    // Check if integration already exists
    const existing = await getTenantIntegration(c.env.DB, tenantId, "shopify");

    if (existing) {
      // Update existing integration
      await c.env.DB.prepare(
        `UPDATE tenant_integrations
         SET credentials_encrypted = ?,
             is_enabled = 1,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?`
      )
        .bind(encryptedCredentials, now, existing.id)
        .run();
    } else {
      // Create new integration
      const integrationId = generateId();
      await c.env.DB.prepare(
        `INSERT INTO tenant_integrations (
          id, tenant_id, platform, credentials_encrypted,
          is_enabled, sync_enabled, webhook_enabled,
          last_sync_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          integrationId,
          tenantId,
          "shopify",
          encryptedCredentials,
          1, // is_enabled
          1, // sync_enabled
          0, // webhook_enabled (user needs to configure webhooks separately)
          null, // last_sync_at
          null, // last_error
          now,
          now
        )
        .run();
    }

    return c.json({
      success: true,
      message: "Shopify connected successfully",
      data: {
        platform: "shopify",
        connected: true,
        shop_domain: body.shop_domain,
      },
    });
  }
);

// =============================================================================
// SHOPIFY DISCONNECT
// =============================================================================

/**
 * POST /api/v1/integrations/shopify/disconnect
 * Disconnect Shopify store from tenant
 */
integrations.post(
  "/shopify/disconnect",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    const integration = await getTenantIntegration(c.env.DB, tenantId, "shopify");

    if (!integration) {
      throw new ApiError(
        "Shopify is not connected",
        400,
        "SHOPIFY_NOT_CONNECTED"
      );
    }

    // Soft disable instead of deleting (preserves history)
    await c.env.DB.prepare(
      `UPDATE tenant_integrations
       SET is_enabled = 0,
           sync_enabled = 0,
           webhook_enabled = 0,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(new Date().toISOString(), integration.id)
      .run();

    return c.json({
      success: true,
      message: "Shopify disconnected successfully",
    });
  }
);

// =============================================================================
// SHOPIFY SYNC SETTINGS
// =============================================================================

/**
 * GET /api/v1/integrations/shopify/settings
 * Get Shopify sync settings
 */
integrations.get(
  "/shopify/settings",
  requireAuth(),
  requireTenant(),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    const integration = await getTenantIntegration(c.env.DB, tenantId, "shopify");

    if (!integration || integration.is_enabled !== 1) {
      throw new ApiError(
        "Shopify is not connected",
        400,
        "SHOPIFY_NOT_CONNECTED"
      );
    }

    // Get additional settings from KV (or a settings table)
    const settingsKey = `shopify:settings:${tenantId}`;
    const settingsJson = await c.env.KV.get(settingsKey);
    const settings = settingsJson
      ? JSON.parse(settingsJson)
      : {
          auto_import_orders: true,
          sync_inventory: false,
          sync_fulfillments: true,
        };

    return c.json({
      success: true,
      data: {
        sync_enabled: integration.sync_enabled === 1,
        ...settings,
      },
    });
  }
);

/**
 * PUT /api/v1/integrations/shopify/settings
 * Update Shopify sync settings
 */
integrations.put(
  "/shopify/settings",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    const integration = await getTenantIntegration(c.env.DB, tenantId, "shopify");

    if (!integration || integration.is_enabled !== 1) {
      throw new ApiError(
        "Shopify is not connected",
        400,
        "SHOPIFY_NOT_CONNECTED"
      );
    }

    // Parse and validate request body
    let body: z.infer<typeof syncSettingsSchema>;
    try {
      const rawBody = await c.req.json();
      body = syncSettingsSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Update sync_enabled in database
    await c.env.DB.prepare(
      `UPDATE tenant_integrations
       SET sync_enabled = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(body.sync_enabled ? 1 : 0, new Date().toISOString(), integration.id)
      .run();

    // Store additional settings in KV
    const settingsKey = `shopify:settings:${tenantId}`;
    await c.env.KV.put(
      settingsKey,
      JSON.stringify({
        auto_import_orders: body.auto_import_orders,
        sync_inventory: body.sync_inventory,
        sync_fulfillments: body.sync_fulfillments,
      }),
      { expirationTtl: 60 * 60 * 24 * 365 } // 1 year
    );

    return c.json({
      success: true,
      message: "Settings updated successfully",
      data: body,
    });
  }
);

// =============================================================================
// SHOPIFY MANUAL SYNC
// =============================================================================

/**
 * POST /api/v1/integrations/shopify/sync
 * Trigger a manual sync of Shopify orders
 */
integrations.post(
  "/shopify/sync",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    const integration = await getTenantIntegration(c.env.DB, tenantId, "shopify");

    if (!integration || integration.is_enabled !== 1) {
      throw new ApiError(
        "Shopify is not connected",
        400,
        "SHOPIFY_NOT_CONNECTED"
      );
    }

    // Parse optional parameters
    const body = await c.req.json().catch(() => ({})) as {
      since_date?: string;
      full_sync?: boolean;
    };

    // Queue the sync job
    await c.env.SHOPIFY_SYNC.send({
      type: "order_created", // Using existing type for manual sync
      tenantId,
      payload: {
        manual_sync: true,
        since_date: body.since_date || null,
        full_sync: body.full_sync || false,
        triggered_by: c.get("userId"),
      },
      timestamp: Date.now(),
    });

    // Update last sync attempt time
    await c.env.DB.prepare(
      `UPDATE tenant_integrations
       SET last_sync_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(new Date().toISOString(), new Date().toISOString(), integration.id)
      .run();

    return c.json({
      success: true,
      message: "Sync job queued successfully",
      data: {
        queued_at: new Date().toISOString(),
        since_date: body.since_date || "last 30 days",
        full_sync: body.full_sync || false,
      },
    });
  }
);

// =============================================================================
// SHOPIFY WEBHOOKS INFO
// =============================================================================

/**
 * GET /api/v1/integrations/shopify/webhooks
 * Get webhook configuration info for the tenant
 */
integrations.get(
  "/shopify/webhooks",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    const integration = await getTenantIntegration(c.env.DB, tenantId, "shopify");

    if (!integration || integration.is_enabled !== 1) {
      throw new ApiError(
        "Shopify is not connected",
        400,
        "SHOPIFY_NOT_CONNECTED"
      );
    }

    // Generate webhook URLs for the tenant
    const baseUrl = c.env.BETTER_AUTH_URL || `https://${c.req.header("host")}`;

    const webhookEndpoints = [
      {
        topic: "orders/create",
        description: "New order created in Shopify",
        url: `${baseUrl}/webhooks/shopify/${tenantId}/orders/create`,
      },
      {
        topic: "orders/updated",
        description: "Order updated in Shopify",
        url: `${baseUrl}/webhooks/shopify/${tenantId}/orders/updated`,
      },
      {
        topic: "orders/cancelled",
        description: "Order cancelled in Shopify",
        url: `${baseUrl}/webhooks/shopify/${tenantId}/orders/cancelled`,
      },
    ];

    return c.json({
      success: true,
      data: {
        webhook_enabled: integration.webhook_enabled === 1,
        instructions:
          "Configure these webhooks in your Shopify admin under Settings > Notifications > Webhooks",
        endpoints: webhookEndpoints,
      },
    });
  }
);

/**
 * PUT /api/v1/integrations/shopify/webhooks/enable
 * Mark webhooks as configured
 */
integrations.put(
  "/shopify/webhooks/enable",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;

    const integration = await getTenantIntegration(c.env.DB, tenantId, "shopify");

    if (!integration || integration.is_enabled !== 1) {
      throw new ApiError(
        "Shopify is not connected",
        400,
        "SHOPIFY_NOT_CONNECTED"
      );
    }

    await c.env.DB.prepare(
      `UPDATE tenant_integrations
       SET webhook_enabled = 1, updated_at = ?
       WHERE id = ?`
    )
      .bind(new Date().toISOString(), integration.id)
      .run();

    return c.json({
      success: true,
      message: "Webhooks marked as enabled",
    });
  }
);

// =============================================================================
// LIST ALL INTEGRATIONS
// =============================================================================

/**
 * GET /api/v1/integrations
 * List all available integrations and their status
 */
integrations.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  // Get all integrations for tenant
  const result = await c.env.DB.prepare(
    "SELECT platform, is_enabled, sync_enabled, webhook_enabled, last_sync_at, last_error FROM tenant_integrations WHERE tenant_id = ?"
  )
    .bind(tenantId)
    .all<{
      platform: string;
      is_enabled: number;
      sync_enabled: number;
      webhook_enabled: number;
      last_sync_at: string | null;
      last_error: string | null;
    }>();

  const connectedPlatforms = new Map(
    (result.results || []).map((r) => [r.platform, r])
  );

  // Available integrations (even if not connected)
  const availableIntegrations = [
    {
      platform: "shopify",
      name: "Shopify",
      description: "Sync orders and inventory with your Shopify store",
      connected: connectedPlatforms.has("shopify") && connectedPlatforms.get("shopify")!.is_enabled === 1,
      sync_enabled: connectedPlatforms.get("shopify")?.sync_enabled === 1,
      webhook_enabled: connectedPlatforms.get("shopify")?.webhook_enabled === 1,
      last_sync: connectedPlatforms.get("shopify")?.last_sync_at || null,
      error: connectedPlatforms.get("shopify")?.last_error || null,
    },
    {
      platform: "amazon",
      name: "Amazon Seller Central",
      description: "Sync orders from Amazon marketplace",
      connected: false,
      available: false,
      coming_soon: true,
    },
    {
      platform: "etsy",
      name: "Etsy",
      description: "Sync orders from your Etsy shop",
      connected: false,
      available: false,
      coming_soon: true,
    },
  ];

  return c.json({
    success: true,
    data: availableIntegrations,
  });
});
