/**
 * Analytics Routes - Dashboard & Reporting
 *
 * Endpoints for analytics, metrics, and reporting.
 * All routes are tenant-scoped.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";
import type { DailyAnalytics, PrinterFailure, FailureType } from "../types";

export const analytics = new Hono<HonoEnv>();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get date string for N days ago in YYYY-MM-DD format
 */
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const parts = date.toISOString().split("T");
  return parts[0] ?? date.toISOString().substring(0, 10);
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getToday(): string {
  const parts = new Date().toISOString().split("T");
  return parts[0] ?? new Date().toISOString().substring(0, 10);
}

/**
 * Parse date range from query params
 */
function parseDateRange(
  startDate?: string,
  endDate?: string,
  defaultDays = 30
): { start: string; end: string } {
  const end = endDate || getToday();
  const start = startDate || getDateDaysAgo(defaultDays);
  return { start, end };
}

// =============================================================================
// DASHBOARD OVERVIEW
// =============================================================================

/**
 * GET /api/v1/analytics/overview
 * Get dashboard overview with real-time stats
 */
analytics.get("/overview", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const today = getToday();

  // Get today's analytics if exists
  const todayStats = await c.env.DB.prepare(
    "SELECT * FROM daily_analytics WHERE tenant_id = ? AND date = ?"
  )
    .bind(tenantId, today)
    .first<DailyAnalytics>();

  // Get real-time printer counts
  const printerStats = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'idle' THEN 1 ELSE 0 END) as idle,
      SUM(CASE WHEN status = 'printing' THEN 1 ELSE 0 END) as printing,
      SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
      SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance,
      SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error
    FROM printers WHERE tenant_id = ? AND is_active = 1`
  )
    .bind(tenantId)
    .first<{
      total: number;
      idle: number;
      printing: number;
      paused: number;
      maintenance: number;
      offline: number;
      error: number;
    }>();

  // Get pending job counts
  const jobStats = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total_pending,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'printing' THEN 1 ELSE 0 END) as printing,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing
    FROM print_jobs WHERE tenant_id = ? AND status IN ('queued', 'processing', 'uploaded', 'printing')`
  )
    .bind(tenantId)
    .first<{
      total_pending: number;
      queued: number;
      printing: number;
      processing: number;
    }>();

  // Get today's completed jobs (if no daily_analytics entry yet)
  const todayJobs = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM print_jobs WHERE tenant_id = ? AND DATE(time_submitted) = ?`
  )
    .bind(tenantId, today)
    .first<{ total: number; completed: number; failed: number }>();

  // Get pending worklist tasks
  const taskStats = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN task_type = 'collection' THEN 1 ELSE 0 END) as collection,
      SUM(CASE WHEN task_type = 'assembly' THEN 1 ELSE 0 END) as assembly,
      SUM(CASE WHEN task_type = 'filament_change' THEN 1 ELSE 0 END) as filament_change
    FROM worklist_tasks WHERE tenant_id = ? AND status IN ('pending', 'in_progress')`
  )
    .bind(tenantId)
    .first<{
      total: number;
      collection: number;
      assembly: number;
      filament_change: number;
    }>();

  // Get low stock alerts
  const lowStockCount = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM product_skus
     WHERE tenant_id = ? AND is_active = 1 AND stock_level <= low_stock_threshold`
  )
    .bind(tenantId)
    .first<{ count: number }>();

  // Get hub status
  const hubStats = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_online = 1 THEN 1 ELSE 0 END) as online
    FROM hubs WHERE tenant_id = ?`
  )
    .bind(tenantId)
    .first<{ total: number; online: number }>();

  return c.json({
    success: true,
    data: {
      date: today,
      printers: {
        total: printerStats?.total || 0,
        idle: printerStats?.idle || 0,
        printing: printerStats?.printing || 0,
        paused: printerStats?.paused || 0,
        maintenance: printerStats?.maintenance || 0,
        offline: printerStats?.offline || 0,
        error: printerStats?.error || 0,
      },
      jobs: {
        pending: jobStats?.total_pending || 0,
        queued: jobStats?.queued || 0,
        printing: jobStats?.printing || 0,
        processing: jobStats?.processing || 0,
        today_completed: todayJobs?.completed || todayStats?.jobs_completed || 0,
        today_failed: todayJobs?.failed || todayStats?.jobs_failed || 0,
      },
      tasks: {
        pending: taskStats?.total || 0,
        collection: taskStats?.collection || 0,
        assembly: taskStats?.assembly || 0,
        filament_change: taskStats?.filament_change || 0,
      },
      hubs: {
        total: hubStats?.total || 0,
        online: hubStats?.online || 0,
      },
      alerts: {
        low_stock: lowStockCount?.count || 0,
      },
      daily: todayStats || null,
    },
  });
});

// =============================================================================
// PRODUCTION METRICS
// =============================================================================

/**
 * GET /api/v1/analytics/production
 * Get production metrics over a date range
 */
analytics.get("/production", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const { start, end } = parseDateRange(
    c.req.query("start_date"),
    c.req.query("end_date"),
    30
  );

  // Get daily analytics for the date range
  const dailyData = await c.env.DB.prepare(
    `SELECT * FROM daily_analytics
     WHERE tenant_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`
  )
    .bind(tenantId, start, end)
    .all<DailyAnalytics>();

  // Calculate aggregates from daily data
  const records = dailyData.results || [];

  const totals = records.reduce(
    (acc, day) => ({
      jobs_completed: acc.jobs_completed + (day.jobs_completed || 0),
      jobs_failed: acc.jobs_failed + (day.jobs_failed || 0),
      units_produced: acc.units_produced + (day.units_produced || 0),
      total_print_time_minutes:
        acc.total_print_time_minutes + (day.total_print_time_minutes || 0),
      revenue: acc.revenue + (day.revenue || 0),
      profit: acc.profit + (day.profit || 0),
    }),
    {
      jobs_completed: 0,
      jobs_failed: 0,
      units_produced: 0,
      total_print_time_minutes: 0,
      revenue: 0,
      profit: 0,
    }
  );

  const totalJobs = totals.jobs_completed + totals.jobs_failed;
  const completionRate =
    totalJobs > 0
      ? Math.round((totals.jobs_completed / totalJobs) * 100 * 10) / 10
      : 0;

  // Get job counts from actual jobs table if no daily analytics
  let jobCounts = { completed: 0, failed: 0 };
  if (records.length === 0) {
    const jobs = await c.env.DB.prepare(
      `SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM print_jobs
      WHERE tenant_id = ? AND DATE(time_submitted) >= ? AND DATE(time_submitted) <= ?`
    )
      .bind(tenantId, start, end)
      .first<{ completed: number; failed: number }>();
    jobCounts = { completed: jobs?.completed || 0, failed: jobs?.failed || 0 };
  }

  return c.json({
    success: true,
    data: {
      date_range: { start, end },
      summary: {
        jobs_completed:
          records.length > 0 ? totals.jobs_completed : jobCounts.completed,
        jobs_failed:
          records.length > 0 ? totals.jobs_failed : jobCounts.failed,
        completion_rate: completionRate,
        units_produced: totals.units_produced,
        total_print_time_hours: Math.round(
          totals.total_print_time_minutes / 60
        ),
        revenue_cents: totals.revenue,
        profit_cents: totals.profit,
      },
      daily: records,
    },
  });
});

// =============================================================================
// PRINTER UTILIZATION
// =============================================================================

/**
 * GET /api/v1/analytics/printers
 * Get printer utilization metrics
 */
analytics.get("/printers", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const { start, end } = parseDateRange(
    c.req.query("start_date"),
    c.req.query("end_date"),
    30
  );

  // Get all active printers
  const printers = await c.env.DB.prepare(
    `SELECT id, name, model, status, total_print_time, in_maintenance
     FROM printers WHERE tenant_id = ? AND is_active = 1
     ORDER BY name ASC`
  )
    .bind(tenantId)
    .all<{
      id: string;
      name: string;
      model: string;
      status: string;
      total_print_time: number;
      in_maintenance: number;
    }>();

  // Get job counts per printer in date range
  const printerJobs = await c.env.DB.prepare(
    `SELECT
      printer_id,
      COUNT(*) as total_jobs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(COALESCE(actual_print_time_minutes, 0)) as total_print_minutes
    FROM print_jobs
    WHERE tenant_id = ? AND printer_id IS NOT NULL
      AND DATE(time_submitted) >= ? AND DATE(time_submitted) <= ?
    GROUP BY printer_id`
  )
    .bind(tenantId, start, end)
    .all<{
      printer_id: string;
      total_jobs: number;
      completed: number;
      failed: number;
      total_print_minutes: number;
    }>();

  // Get failure counts per printer
  const printerFailures = await c.env.DB.prepare(
    `SELECT printer_id, COUNT(*) as failure_count
     FROM printer_failures
     WHERE tenant_id = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?
     GROUP BY printer_id`
  )
    .bind(tenantId, start, end)
    .all<{ printer_id: string; failure_count: number }>();

  // Build printer stats map
  const jobsMap = new Map(
    (printerJobs.results || []).map((j) => [j.printer_id, j])
  );
  const failuresMap = new Map(
    (printerFailures.results || []).map((f) => [f.printer_id, f.failure_count])
  );

  // Calculate utilization (assuming 24/7 availability for date range)
  const dateRangeMs =
    new Date(end).getTime() - new Date(start).getTime() + 86400000;
  const dateRangeMinutes = dateRangeMs / 60000;

  const printerStats = (printers.results || []).map((printer) => {
    const jobs = jobsMap.get(printer.id);
    const failureCount = failuresMap.get(printer.id) || 0;
    const totalJobs = jobs?.total_jobs || 0;
    const completed = jobs?.completed || 0;
    const failed = jobs?.failed || 0;
    const printMinutes = jobs?.total_print_minutes || 0;

    const successRate =
      totalJobs > 0 ? Math.round((completed / totalJobs) * 100 * 10) / 10 : 100;
    const utilizationPercent =
      Math.round((printMinutes / dateRangeMinutes) * 100 * 10) / 10;

    return {
      id: printer.id,
      name: printer.name,
      model: printer.model,
      status: printer.status,
      in_maintenance: printer.in_maintenance === 1,
      total_jobs: totalJobs,
      completed,
      failed,
      success_rate: successRate,
      failure_count: failureCount,
      total_print_hours: Math.round(printMinutes / 60),
      utilization_percent: Math.min(utilizationPercent, 100),
    };
  });

  // Calculate overall averages
  const avgUtilization =
    printerStats.length > 0
      ? Math.round(
          (printerStats.reduce((sum, p) => sum + p.utilization_percent, 0) /
            printerStats.length) *
            10
        ) / 10
      : 0;

  const avgSuccessRate =
    printerStats.length > 0
      ? Math.round(
          (printerStats.reduce((sum, p) => sum + p.success_rate, 0) /
            printerStats.length) *
            10
        ) / 10
      : 100;

  return c.json({
    success: true,
    data: {
      date_range: { start, end },
      summary: {
        total_printers: printerStats.length,
        average_utilization: avgUtilization,
        average_success_rate: avgSuccessRate,
        total_jobs: printerStats.reduce((sum, p) => sum + p.total_jobs, 0),
        total_print_hours: printerStats.reduce(
          (sum, p) => sum + p.total_print_hours,
          0
        ),
      },
      printers: printerStats,
    },
  });
});

// =============================================================================
// FAILURE ANALYSIS
// =============================================================================

/**
 * GET /api/v1/analytics/failures
 * Get failure analysis and trends
 */
analytics.get("/failures", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const { start, end } = parseDateRange(
    c.req.query("start_date"),
    c.req.query("end_date"),
    30
  );
  const printerId = c.req.query("printer_id");

  // Build WHERE clause
  let whereClause = "tenant_id = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?";
  const params: (string | number)[] = [tenantId, start, end];

  if (printerId) {
    whereClause += " AND printer_id = ?";
    params.push(printerId);
  }

  // Get failures by type
  const failuresByType = await c.env.DB.prepare(
    `SELECT failure_type, COUNT(*) as count
     FROM printer_failures
     WHERE ${whereClause}
     GROUP BY failure_type
     ORDER BY count DESC`
  )
    .bind(...params)
    .all<{ failure_type: FailureType; count: number }>();

  // Get failures by printer
  const failuresByPrinter = await c.env.DB.prepare(
    `SELECT pf.printer_id, p.name as printer_name, COUNT(*) as count
     FROM printer_failures pf
     LEFT JOIN printers p ON pf.printer_id = p.id
     WHERE pf.tenant_id = ? AND DATE(pf.created_at) >= ? AND DATE(pf.created_at) <= ?
     GROUP BY pf.printer_id
     ORDER BY count DESC
     LIMIT 10`
  )
    .bind(tenantId, start, end)
    .all<{ printer_id: string; printer_name: string; count: number }>();

  // Get daily failure trend
  const dailyTrend = await c.env.DB.prepare(
    `SELECT DATE(created_at) as date, COUNT(*) as count
     FROM printer_failures
     WHERE ${whereClause}
     GROUP BY DATE(created_at)
     ORDER BY date ASC`
  )
    .bind(...params)
    .all<{ date: string; count: number }>();

  // Get recent failures with details
  const recentFailures = await c.env.DB.prepare(
    `SELECT pf.*, p.name as printer_name, pj.file_name
     FROM printer_failures pf
     LEFT JOIN printers p ON pf.printer_id = p.id
     LEFT JOIN print_jobs pj ON pf.print_job_id = pj.id
     WHERE pf.tenant_id = ? AND DATE(pf.created_at) >= ? AND DATE(pf.created_at) <= ?
     ORDER BY pf.created_at DESC
     LIMIT 20`
  )
    .bind(tenantId, start, end)
    .all<PrinterFailure & { printer_name: string; file_name: string }>();

  // Calculate totals
  const totalFailures = (failuresByType.results || []).reduce(
    (sum, f) => sum + f.count,
    0
  );

  // Get resolved vs unresolved
  const resolvedStats = await c.env.DB.prepare(
    `SELECT
      SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) as unresolved
     FROM printer_failures
     WHERE ${whereClause}`
  )
    .bind(...params)
    .first<{ resolved: number; unresolved: number }>();

  return c.json({
    success: true,
    data: {
      date_range: { start, end },
      summary: {
        total_failures: totalFailures,
        resolved: resolvedStats?.resolved || 0,
        unresolved: resolvedStats?.unresolved || 0,
        resolution_rate:
          totalFailures > 0
            ? Math.round(
                ((resolvedStats?.resolved || 0) / totalFailures) * 100 * 10
              ) / 10
            : 100,
      },
      by_type: failuresByType.results || [],
      by_printer: failuresByPrinter.results || [],
      daily_trend: dailyTrend.results || [],
      recent: recentFailures.results || [],
    },
  });
});

// =============================================================================
// INVENTORY ANALYTICS
// =============================================================================

/**
 * GET /api/v1/analytics/inventory
 * Get inventory turnover and material usage
 */
analytics.get("/inventory", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const { start, end } = parseDateRange(
    c.req.query("start_date"),
    c.req.query("end_date"),
    30
  );

  // Get low stock SKUs
  const lowStockSkus = await c.env.DB.prepare(
    `SELECT ps.*, p.name as product_name
     FROM product_skus ps
     JOIN products p ON ps.product_id = p.id
     WHERE ps.tenant_id = ? AND ps.is_active = 1
       AND ps.stock_level <= ps.low_stock_threshold
     ORDER BY ps.stock_level ASC
     LIMIT 20`
  )
    .bind(tenantId)
    .all<{
      id: string;
      sku: string;
      color: string;
      stock_level: number;
      low_stock_threshold: number;
      product_name: string;
    }>();

  // Get filament inventory status
  const filamentStatus = await c.env.DB.prepare(
    `SELECT type, color, status, remaining_grams, low_threshold
     FROM filament_inventory
     WHERE tenant_id = ?
     ORDER BY remaining_grams ASC`
  )
    .bind(tenantId)
    .all<{
      type: string;
      color: string;
      status: string;
      remaining_grams: number;
      low_threshold: number;
    }>();

  // Get material usage in date range
  const materialUsage = await c.env.DB.prepare(
    `SELECT material_type, SUM(usage_amount) as total_usage
     FROM material_usage_history
     WHERE tenant_id = ? AND DATE(usage_date) >= ? AND DATE(usage_date) <= ?
     GROUP BY material_type
     ORDER BY total_usage DESC`
  )
    .bind(tenantId, start, end)
    .all<{ material_type: string; total_usage: number }>();

  // Get daily material usage trend
  const usageTrend = await c.env.DB.prepare(
    `SELECT DATE(usage_date) as date, SUM(usage_amount) as usage
     FROM material_usage_history
     WHERE tenant_id = ? AND DATE(usage_date) >= ? AND DATE(usage_date) <= ?
     GROUP BY DATE(usage_date)
     ORDER BY date ASC`
  )
    .bind(tenantId, start, end)
    .all<{ date: string; usage: number }>();

  // Calculate summary stats
  const totalLowStock = lowStockSkus.results?.length || 0;
  const totalFilamentLow = (filamentStatus.results || []).filter(
    (f) => f.status === "low" || f.status === "out_of_stock"
  ).length;

  return c.json({
    success: true,
    data: {
      date_range: { start, end },
      summary: {
        low_stock_skus: totalLowStock,
        low_filament_spools: totalFilamentLow,
        total_material_types: materialUsage.results?.length || 0,
      },
      low_stock_items: lowStockSkus.results || [],
      filament_inventory: filamentStatus.results || [],
      material_usage: materialUsage.results || [],
      usage_trend: usageTrend.results || [],
    },
  });
});

// =============================================================================
// REVENUE ANALYTICS
// =============================================================================

/**
 * GET /api/v1/analytics/revenue
 * Get revenue and profit breakdown
 */
analytics.get("/revenue", requireAuth(), requireTenant(), async (c) => {
  const tenantId = c.get("tenantId")!;
  const { start, end } = parseDateRange(
    c.req.query("start_date"),
    c.req.query("end_date"),
    30
  );

  // Get daily revenue from analytics table
  const dailyRevenue = await c.env.DB.prepare(
    `SELECT date, revenue, profit, materials_cost, labor_cost, overhead_cost
     FROM daily_analytics
     WHERE tenant_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`
  )
    .bind(tenantId, start, end)
    .all<{
      date: string;
      revenue: number;
      profit: number;
      materials_cost: number;
      labor_cost: number;
      overhead_cost: number;
    }>();

  // Get order revenue in date range
  const orderRevenue = await c.env.DB.prepare(
    `SELECT
      SUM(total_revenue) as total_revenue,
      SUM(shipping_cost) as total_shipping,
      SUM(tax_amount) as total_tax,
      SUM(discount_amount) as total_discounts,
      COUNT(*) as order_count
     FROM orders
     WHERE tenant_id = ? AND DATE(order_date) >= ? AND DATE(order_date) <= ?
       AND status NOT IN ('cancelled', 'refunded')`
  )
    .bind(tenantId, start, end)
    .first<{
      total_revenue: number;
      total_shipping: number;
      total_tax: number;
      total_discounts: number;
      order_count: number;
    }>();

  // Get revenue by platform
  const revenueByPlatform = await c.env.DB.prepare(
    `SELECT platform, SUM(total_revenue) as revenue, COUNT(*) as orders
     FROM orders
     WHERE tenant_id = ? AND DATE(order_date) >= ? AND DATE(order_date) <= ?
       AND status NOT IN ('cancelled', 'refunded')
     GROUP BY platform
     ORDER BY revenue DESC`
  )
    .bind(tenantId, start, end)
    .all<{ platform: string; revenue: number; orders: number }>();

  // Calculate totals from daily analytics
  const analyticsRecords = dailyRevenue.results || [];
  const analyticsTotals = analyticsRecords.reduce(
    (acc, day) => ({
      revenue: acc.revenue + (day.revenue || 0),
      profit: acc.profit + (day.profit || 0),
      materials_cost: acc.materials_cost + (day.materials_cost || 0),
      labor_cost: acc.labor_cost + (day.labor_cost || 0),
      overhead_cost: acc.overhead_cost + (day.overhead_cost || 0),
    }),
    { revenue: 0, profit: 0, materials_cost: 0, labor_cost: 0, overhead_cost: 0 }
  );

  // Use order data if no analytics data
  const totalRevenue =
    analyticsRecords.length > 0
      ? analyticsTotals.revenue
      : orderRevenue?.total_revenue || 0;

  return c.json({
    success: true,
    data: {
      date_range: { start, end },
      summary: {
        total_revenue_cents: totalRevenue,
        total_profit_cents: analyticsTotals.profit,
        profit_margin:
          totalRevenue > 0
            ? Math.round((analyticsTotals.profit / totalRevenue) * 100 * 10) /
              10
            : 0,
        order_count: orderRevenue?.order_count || 0,
        average_order_value:
          (orderRevenue?.order_count || 0) > 0
            ? Math.round(
                (orderRevenue?.total_revenue || 0) /
                  (orderRevenue?.order_count || 1)
              )
            : 0,
      },
      costs: {
        materials_cents: analyticsTotals.materials_cost,
        labor_cents: analyticsTotals.labor_cost,
        overhead_cents: analyticsTotals.overhead_cost,
        total_cents:
          analyticsTotals.materials_cost +
          analyticsTotals.labor_cost +
          analyticsTotals.overhead_cost,
      },
      by_platform: revenueByPlatform.results || [],
      daily: analyticsRecords,
    },
  });
});
