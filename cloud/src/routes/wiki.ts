/**
 * Wiki Routes - Internal Documentation Management
 *
 * CRUD operations for wiki articles with markdown support.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant, requireRoles } from "../middleware/tenant";
import { ApiError } from "../middleware/errors";
import { generateId } from "../lib/crypto";
import { paginate, getCount, now } from "../lib/db";
import type { WikiArticle } from "../types";

export const wiki = new Hono<HonoEnv>();

// =============================================================================
// SCHEMAS
// =============================================================================

// Wiki section schema for structured content
const wikiSectionSchema = z.object({
  id: z.string(),
  type: z.enum(['subtitle', 'step', 'note', 'warning']),
  order: z.number(),
  content: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  image_url: z.string().optional(),
  notes: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  number: z.number().optional(),
});

const createArticleSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Slug must be lowercase letters, numbers, and hyphens only",
  }).optional().nullable(), // Make slug optional - auto-generate from title if not provided
  content: z.string().optional().nullable(),
  excerpt: z.string().max(500).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  tags: z.array(z.string().max(50)).optional().nullable(),
  product_id: z.string().optional().nullable(),
  is_published: z.boolean().default(false),
  meta_title: z.string().max(60).optional().nullable(),
  meta_description: z.string().max(160).optional().nullable(),
  featured_image_url: z.string().max(500).optional().nullable(),
  // Frontend wiki fields
  description: z.string().optional().nullable(),
  estimated_time_minutes: z.number().optional().nullable(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional().nullable(),
  tools_required: z.array(z.string()).optional().nullable(),
  sections: z.array(wikiSectionSchema).optional().nullable(),
  sku_id: z.string().optional().nullable(),
});

const updateArticleSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Slug must be lowercase letters, numbers, and hyphens only",
  }).optional(),
  content: z.string().nullable().optional(),
  excerpt: z.string().max(500).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  tags: z.array(z.string().max(50)).nullable().optional(),
  product_id: z.string().nullable().optional(),
  meta_title: z.string().max(60).nullable().optional(),
  meta_description: z.string().max(160).nullable().optional(),
  featured_image_url: z.string().max(500).nullable().optional(),
  // Frontend wiki fields
  description: z.string().nullable().optional(),
  estimated_time_minutes: z.number().nullable().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(),
  tools_required: z.array(z.string()).nullable().optional(),
  sections: z.array(wikiSectionSchema).nullable().optional(),
  sku_id: z.string().nullable().optional(),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/** Generate a URL-friendly slug from a title */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200);
}

/** Parse JSON fields in a wiki article for response */
function parseWikiArticle(article: WikiArticle) {
  return {
    ...article,
    tags: article.tags ? JSON.parse(article.tags as string) : [],
    tools_required: article.tools_required ? JSON.parse(article.tools_required as string) : [],
    sections: article.sections ? JSON.parse(article.sections as string) : [],
  };
}

// =============================================================================
// LIST WIKI ARTICLES
// =============================================================================

/**
 * GET /api/v1/wiki
 * List all wiki articles for the current tenant
 * Supports filtering by category, is_published, search
 * Supports pagination
 */
wiki.get("/", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const category = c.req.query("category");
  const isPublished = c.req.query("is_published");
  const productId = c.req.query("product_id");
  const skuId = c.req.query("sku_id");
  const search = c.req.query("search");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");

  // Build WHERE clause
  let whereClause = "tenant_id = ?";
  const params: (string | number)[] = [tenantId];

  if (category) {
    whereClause += " AND category = ?";
    params.push(category);
  }

  if (isPublished !== undefined) {
    whereClause += " AND is_published = ?";
    params.push(isPublished === "true" ? 1 : 0);
  }

  if (productId) {
    whereClause += " AND product_id = ?";
    params.push(productId);
  }

  if (skuId) {
    whereClause += " AND sku_id = ?";
    params.push(skuId);
  }

  if (search) {
    whereClause += " AND (title LIKE ? OR content LIKE ? OR excerpt LIKE ? OR description LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  // Get total count
  const total = await getCount(c.env.DB, "wiki_articles", whereClause, params);

  // Paginate
  const pagination = paginate({ page, limit });
  const offset = pagination.offset;

  // Query articles
  const query = `
    SELECT * FROM wiki_articles
    WHERE ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `;

  const result = await c.env.DB.prepare(query)
    .bind(...params, pagination.limit, offset)
    .all<WikiArticle>();

  // Parse JSON fields for each article
  const articles = (result.results || []).map(parseWikiArticle);

  return c.json({
    success: true,
    data: articles,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasMore: offset + (result.results?.length || 0) < total,
    },
  });
});

// =============================================================================
// GET WIKI CATEGORIES
// =============================================================================

/**
 * GET /api/v1/wiki/categories
 * Get list of unique wiki categories for the tenant
 */
wiki.get("/categories", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;

  const result = await c.env.DB.prepare(
    `SELECT DISTINCT category FROM wiki_articles
     WHERE tenant_id = ? AND category IS NOT NULL AND category != ''
     ORDER BY category ASC`
  )
    .bind(tenantId)
    .all<{ category: string }>();

  const categories = (result.results || []).map((r) => r.category);

  return c.json({
    success: true,
    data: categories,
  });
});

// =============================================================================
// GET SINGLE ARTICLE BY SLUG
// =============================================================================

/**
 * GET /api/v1/wiki/:slug
 * Get a single article by slug
 */
wiki.get("/:idOrSlug", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const idOrSlug = c.req.param("idOrSlug");

  // Try to find by ID first, then by slug
  let article = await c.env.DB.prepare(
    "SELECT * FROM wiki_articles WHERE id = ? AND tenant_id = ?"
  )
    .bind(idOrSlug, tenantId)
    .first<WikiArticle>();

  if (!article) {
    // Fallback to slug lookup
    article = await c.env.DB.prepare(
      "SELECT * FROM wiki_articles WHERE slug = ? AND tenant_id = ?"
    )
      .bind(idOrSlug, tenantId)
      .first<WikiArticle>();
  }

  if (!article) {
    throw new ApiError("Article not found", 404, "ARTICLE_NOT_FOUND");
  }

  return c.json({
    success: true,
    data: parseWikiArticle(article),
  });
});

// =============================================================================
// CREATE ARTICLE
// =============================================================================

/**
 * POST /api/v1/wiki
 * Create a new wiki article
 */
wiki.post(
  "/",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const userId = c.get("userId")!;

    // Parse and validate request body
    let body: z.infer<typeof createArticleSchema>;
    try {
      const rawBody = await c.req.json();
      body = createArticleSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Generate slug from title if not provided
    const slug = body.slug || generateSlug(body.title);

    // Check for duplicate slug
    const existing = await c.env.DB.prepare(
      "SELECT id FROM wiki_articles WHERE tenant_id = ? AND slug = ?"
    )
      .bind(tenantId, slug)
      .first();

    if (existing) {
      throw new ApiError(
        "An article with this slug already exists",
        409,
        "DUPLICATE_SLUG"
      );
    }

    // Validate product_id if provided
    if (body.product_id) {
      const product = await c.env.DB.prepare(
        "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.product_id, tenantId)
        .first();

      if (!product) {
        throw new ApiError(
          "Product not found or does not belong to this tenant",
          404,
          "PRODUCT_NOT_FOUND"
        );
      }
    }

    // Validate sku_id if provided
    if (body.sku_id) {
      const sku = await c.env.DB.prepare(
        "SELECT id FROM product_skus WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.sku_id, tenantId)
        .first();

      if (!sku) {
        throw new ApiError(
          "SKU not found or does not belong to this tenant",
          404,
          "SKU_NOT_FOUND"
        );
      }
    }

    const articleId = generateId();
    const timestamp = now();
    const publishedAt = body.is_published ? timestamp : null;

    await c.env.DB.prepare(
      `INSERT INTO wiki_articles (
        id, tenant_id, title, slug, content, excerpt,
        category, tags, author_id, last_edited_by,
        product_id, is_published, published_at,
        meta_title, meta_description, featured_image_url,
        description, estimated_time_minutes, difficulty,
        tools_required, sections, sku_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        articleId,
        tenantId,
        body.title,
        slug,
        body.content || null,
        body.excerpt || null,
        body.category || null,
        body.tags ? JSON.stringify(body.tags) : null,
        userId,
        userId,
        body.product_id || null,
        body.is_published ? 1 : 0,
        publishedAt,
        body.meta_title || null,
        body.meta_description || null,
        body.featured_image_url || null,
        body.description || null,
        body.estimated_time_minutes || null,
        body.difficulty || null,
        body.tools_required ? JSON.stringify(body.tools_required) : null,
        body.sections ? JSON.stringify(body.sections) : '[]',
        body.sku_id || null,
        timestamp,
        timestamp
      )
      .run();

    // Fetch the created article
    const article = await c.env.DB.prepare(
      "SELECT * FROM wiki_articles WHERE id = ?"
    )
      .bind(articleId)
      .first<WikiArticle>();

    return c.json(
      {
        success: true,
        data: article ? parseWikiArticle(article) : null,
      },
      201
    );
  }
);

// =============================================================================
// UPDATE ARTICLE
// =============================================================================

/**
 * PUT /api/v1/wiki/:id
 * Update a wiki article
 */
wiki.put(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin", "operator"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const userId = c.get("userId")!;
    const articleId = c.req.param("id");

    // Check article exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM wiki_articles WHERE id = ? AND tenant_id = ?"
    )
      .bind(articleId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Article not found", 404, "ARTICLE_NOT_FOUND");
    }

    // Parse and validate request body
    let body: z.infer<typeof updateArticleSchema>;
    try {
      const rawBody = await c.req.json();
      body = updateArticleSchema.parse(rawBody);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }
      throw new ApiError("Invalid request body", 400, "INVALID_REQUEST");
    }

    // Check for duplicate slug if being changed
    if (body.slug) {
      const duplicate = await c.env.DB.prepare(
        "SELECT id FROM wiki_articles WHERE tenant_id = ? AND slug = ? AND id != ?"
      )
        .bind(tenantId, body.slug, articleId)
        .first();

      if (duplicate) {
        throw new ApiError(
          "An article with this slug already exists",
          409,
          "DUPLICATE_SLUG"
        );
      }
    }

    // Validate product_id if provided
    if (body.product_id) {
      const product = await c.env.DB.prepare(
        "SELECT id FROM products WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.product_id, tenantId)
        .first();

      if (!product) {
        throw new ApiError(
          "Product not found or does not belong to this tenant",
          404,
          "PRODUCT_NOT_FOUND"
        );
      }
    }

    // Validate sku_id if provided
    if (body.sku_id) {
      const sku = await c.env.DB.prepare(
        "SELECT id FROM product_skus WHERE id = ? AND tenant_id = ?"
      )
        .bind(body.sku_id, tenantId)
        .first();

      if (!sku) {
        throw new ApiError(
          "SKU not found or does not belong to this tenant",
          404,
          "SKU_NOT_FOUND"
        );
      }
    }

    // Build dynamic update
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    const fields: Array<{
      key: keyof typeof body;
      column: string;
      transform?: (v: unknown) => unknown;
    }> = [
      { key: "title", column: "title" },
      { key: "slug", column: "slug" },
      { key: "content", column: "content" },
      { key: "excerpt", column: "excerpt" },
      { key: "category", column: "category" },
      {
        key: "tags",
        column: "tags",
        transform: (v) => (v ? JSON.stringify(v) : null),
      },
      { key: "product_id", column: "product_id" },
      { key: "meta_title", column: "meta_title" },
      { key: "meta_description", column: "meta_description" },
      { key: "featured_image_url", column: "featured_image_url" },
      // Frontend wiki fields
      { key: "description", column: "description" },
      { key: "estimated_time_minutes", column: "estimated_time_minutes" },
      { key: "difficulty", column: "difficulty" },
      {
        key: "tools_required",
        column: "tools_required",
        transform: (v) => (v ? JSON.stringify(v) : null),
      },
      {
        key: "sections",
        column: "sections",
        transform: (v) => (v ? JSON.stringify(v) : '[]'),
      },
      { key: "sku_id", column: "sku_id" },
    ];

    for (const field of fields) {
      if (body[field.key] !== undefined) {
        updates.push(`${field.column} = ?`);
        const value = body[field.key];
        values.push(
          field.transform
            ? (field.transform(value) as string | number | null)
            : (value as string | number | null)
        );
      }
    }

    if (updates.length === 0) {
      throw new ApiError("No updates provided", 400, "NO_UPDATES");
    }

    updates.push("last_edited_by = ?");
    values.push(userId);

    updates.push("updated_at = ?");
    values.push(now());

    values.push(articleId);
    values.push(tenantId);

    await c.env.DB.prepare(
      `UPDATE wiki_articles SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`
    )
      .bind(...values)
      .run();

    // Fetch updated article
    const article = await c.env.DB.prepare(
      "SELECT * FROM wiki_articles WHERE id = ?"
    )
      .bind(articleId)
      .first<WikiArticle>();

    return c.json({
      success: true,
      data: article ? parseWikiArticle(article) : null,
    });
  }
);

// =============================================================================
// PUBLISH ARTICLE
// =============================================================================

/**
 * POST /api/v1/wiki/:id/publish
 * Publish an article
 */
wiki.post(
  "/:id/publish",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const articleId = c.req.param("id");

    // Check article exists
    const existing = await c.env.DB.prepare(
      "SELECT id, is_published FROM wiki_articles WHERE id = ? AND tenant_id = ?"
    )
      .bind(articleId, tenantId)
      .first<{ id: string; is_published: number }>();

    if (!existing) {
      throw new ApiError("Article not found", 404, "ARTICLE_NOT_FOUND");
    }

    if (existing.is_published === 1) {
      throw new ApiError("Article is already published", 400, "ALREADY_PUBLISHED");
    }

    const timestamp = now();

    await c.env.DB.prepare(
      `UPDATE wiki_articles SET is_published = 1, published_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`
    )
      .bind(timestamp, timestamp, articleId, tenantId)
      .run();

    const article = await c.env.DB.prepare(
      "SELECT * FROM wiki_articles WHERE id = ?"
    )
      .bind(articleId)
      .first<WikiArticle>();

    return c.json({
      success: true,
      data: article ? parseWikiArticle(article) : null,
    });
  }
);

// =============================================================================
// UNPUBLISH ARTICLE
// =============================================================================

/**
 * POST /api/v1/wiki/:id/unpublish
 * Unpublish an article
 */
wiki.post(
  "/:id/unpublish",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const articleId = c.req.param("id");

    // Check article exists
    const existing = await c.env.DB.prepare(
      "SELECT id, is_published FROM wiki_articles WHERE id = ? AND tenant_id = ?"
    )
      .bind(articleId, tenantId)
      .first<{ id: string; is_published: number }>();

    if (!existing) {
      throw new ApiError("Article not found", 404, "ARTICLE_NOT_FOUND");
    }

    if (existing.is_published === 0) {
      throw new ApiError("Article is already unpublished", 400, "ALREADY_UNPUBLISHED");
    }

    const timestamp = now();

    await c.env.DB.prepare(
      `UPDATE wiki_articles SET is_published = 0, updated_at = ? WHERE id = ? AND tenant_id = ?`
    )
      .bind(timestamp, articleId, tenantId)
      .run();

    const article = await c.env.DB.prepare(
      "SELECT * FROM wiki_articles WHERE id = ?"
    )
      .bind(articleId)
      .first<WikiArticle>();

    return c.json({
      success: true,
      data: article ? parseWikiArticle(article) : null,
    });
  }
);

// =============================================================================
// DELETE ARTICLE
// =============================================================================

/**
 * DELETE /api/v1/wiki/:id
 * Delete a wiki article
 */
wiki.delete(
  "/:id",
  requireAuth(),
  requireTenant(),
  requireRoles(["owner", "admin"]),
  async (c) => {
    const tenantId = c.get("tenantId")!;
    const articleId = c.req.param("id");

    // Check article exists
    const existing = await c.env.DB.prepare(
      "SELECT id FROM wiki_articles WHERE id = ? AND tenant_id = ?"
    )
      .bind(articleId, tenantId)
      .first();

    if (!existing) {
      throw new ApiError("Article not found", 404, "ARTICLE_NOT_FOUND");
    }

    await c.env.DB.prepare(
      "DELETE FROM wiki_articles WHERE id = ? AND tenant_id = ?"
    )
      .bind(articleId, tenantId)
      .run();

    return c.json({
      success: true,
      message: "Article deleted successfully",
    });
  }
);
