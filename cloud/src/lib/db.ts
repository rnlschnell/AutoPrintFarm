/**
 * PrintFarm Cloud - Database Helpers
 *
 * Utility functions for D1 database operations with type safety,
 * tenant scoping, and error handling.
 */

import type { D1Database, D1Result } from "@cloudflare/workers-types";

// =============================================================================
// ERROR TYPES
// =============================================================================

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, "NOT_FOUND");
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(message: string, cause?: Error) {
    super(message, "UNIQUE_CONSTRAINT", cause);
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(message: string, cause?: Error) {
    super(message, "FOREIGN_KEY", cause);
  }
}

// =============================================================================
// QUERY HELPERS
// =============================================================================

/**
 * Execute a query and return all results as typed array
 */
export async function query<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const result = await db.prepare(sql).bind(...params).all<T>();
    return result.results;
  } catch (error) {
    throw wrapDatabaseError(error, sql);
  }
}

/**
 * Execute a query and return a single result or null
 */
export async function queryOne<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  try {
    const result = await db.prepare(sql).bind(...params).first<T>();
    return result ?? null;
  } catch (error) {
    throw wrapDatabaseError(error, sql);
  }
}

/**
 * Execute a query and return exactly one result, or throw NotFoundError
 */
export async function queryOneOrFail<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
  entityName = "Record"
): Promise<T> {
  const result = await queryOne<T>(db, sql, params);
  if (!result) {
    throw new NotFoundError(entityName, params[0]?.toString() ?? "unknown");
  }
  return result;
}

/**
 * Execute an INSERT and return the result with changes count
 */
export async function insert(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<D1Result> {
  try {
    const result = await db.prepare(sql).bind(...params).run();
    return result;
  } catch (error) {
    throw wrapDatabaseError(error, sql);
  }
}

/**
 * Execute an UPDATE and return the number of affected rows
 */
export async function update(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<number> {
  try {
    const result = await db.prepare(sql).bind(...params).run();
    return result.meta.changes;
  } catch (error) {
    throw wrapDatabaseError(error, sql);
  }
}

/**
 * Execute a DELETE and return the number of affected rows
 */
export async function deleteRow(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<number> {
  try {
    const result = await db.prepare(sql).bind(...params).run();
    return result.meta.changes;
  } catch (error) {
    throw wrapDatabaseError(error, sql);
  }
}

/**
 * Execute multiple statements in a batch (transaction-like behavior)
 * D1 doesn't support true transactions, but batch executes atomically
 */
export async function batch<T>(
  db: D1Database,
  statements: Array<{ sql: string; params?: unknown[] }>
): Promise<D1Result<T>[]> {
  try {
    const prepared = statements.map((stmt) =>
      db.prepare(stmt.sql).bind(...(stmt.params ?? []))
    );
    return (await db.batch(prepared)) as D1Result<T>[];
  } catch (error) {
    throw wrapDatabaseError(error, "BATCH");
  }
}

// =============================================================================
// TENANT-SCOPED QUERY HELPERS
// =============================================================================

/**
 * Query with automatic tenant_id filtering
 */
export async function tenantQuery<T>(
  db: D1Database,
  tenantId: string,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  // The SQL should have a placeholder for tenant_id as the first parameter
  return query<T>(db, sql, [tenantId, ...params]);
}

/**
 * Query one with automatic tenant_id filtering
 */
export async function tenantQueryOne<T>(
  db: D1Database,
  tenantId: string,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  return queryOne<T>(db, sql, [tenantId, ...params]);
}

/**
 * Build a WHERE clause with tenant_id scoping
 */
export function withTenantScope(
  baseWhere: string = "",
  tenantColumn = "tenant_id"
): string {
  if (baseWhere) {
    return `${tenantColumn} = ? AND ${baseWhere}`;
  }
  return `${tenantColumn} = ?`;
}

// =============================================================================
// QUERY BUILDER HELPERS
// =============================================================================

/**
 * Build SELECT query with optional conditions
 */
export function buildSelect(options: {
  table: string;
  columns?: string[];
  where?: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
}): string {
  const columns = options.columns?.join(", ") ?? "*";
  let sql = `SELECT ${columns} FROM ${options.table}`;

  if (options.where) {
    sql += ` WHERE ${options.where}`;
  }

  if (options.orderBy) {
    sql += ` ORDER BY ${options.orderBy}`;
  }

  if (options.limit !== undefined) {
    sql += ` LIMIT ${options.limit}`;
  }

  if (options.offset !== undefined) {
    sql += ` OFFSET ${options.offset}`;
  }

  return sql;
}

/**
 * Build INSERT query from object keys
 */
export function buildInsert(
  table: string,
  data: Record<string, unknown>
): { sql: string; params: unknown[] } {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
  return { sql, params: Object.values(data) };
}

/**
 * Build UPDATE query from object keys
 */
export function buildUpdate(
  table: string,
  data: Record<string, unknown>,
  where: string
): { sql: string; params: unknown[] } {
  const keys = Object.keys(data);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const sql = `UPDATE ${table} SET ${setClause}, updated_at = datetime('now') WHERE ${where}`;
  return { sql, params: Object.values(data) };
}

// =============================================================================
// PAGINATION HELPERS
// =============================================================================

export interface PaginationOptions {
  page?: number;
  limit?: number;
  maxLimit?: number;
}

export interface PaginationResult {
  limit: number;
  offset: number;
  page: number;
}

/**
 * Calculate pagination values with safe defaults
 */
export function paginate(options: PaginationOptions): PaginationResult {
  const maxLimit = options.maxLimit ?? 100;
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(Math.max(1, options.limit ?? 20), maxLimit);
  const offset = (page - 1) * limit;

  return { limit, offset, page };
}

/**
 * Get total count for a query (for pagination metadata)
 */
export async function getCount(
  db: D1Database,
  table: string,
  where?: string,
  params: unknown[] = []
): Promise<number> {
  let sql = `SELECT COUNT(*) as count FROM ${table}`;
  if (where) {
    sql += ` WHERE ${where}`;
  }

  const result = await queryOne<{ count: number }>(db, sql, params);
  return result?.count ?? 0;
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Wrap D1 errors with more specific error types
 */
function wrapDatabaseError(error: unknown, _sql: string): DatabaseError {
  const message = error instanceof Error ? error.message : String(error);

  // Check for specific constraint violations
  if (message.includes("UNIQUE constraint failed")) {
    return new UniqueConstraintError(
      `Duplicate record: ${message}`,
      error instanceof Error ? error : undefined
    );
  }

  if (message.includes("FOREIGN KEY constraint failed")) {
    return new ForeignKeyError(
      `Foreign key constraint: ${message}`,
      error instanceof Error ? error : undefined
    );
  }

  return new DatabaseError(
    `Database error: ${message}`,
    "DATABASE_ERROR",
    error instanceof Error ? error : undefined
  );
}

/**
 * Check if error is a specific database error type
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

export function isUniqueConstraintError(
  error: unknown
): error is UniqueConstraintError {
  return error instanceof UniqueConstraintError;
}

// =============================================================================
// TIMESTAMP HELPERS
// =============================================================================

/**
 * Get current timestamp in ISO8601 format (SQLite compatible)
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Format a Date object to ISO8601 string
 */
export function toTimestamp(date: Date): string {
  return date.toISOString();
}

/**
 * Parse an ISO8601 timestamp string to Date
 */
export function fromTimestamp(timestamp: string): Date {
  return new Date(timestamp);
}
