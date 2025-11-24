/**
 * PrintFarm Cloud API Client
 *
 * Centralized API client for communicating with the Cloudflare Workers backend.
 * Handles authentication, tenant headers, and standardized error handling.
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Get the API base URL from environment or default to current host */
export const getApiBaseUrl = (): string => {
  // Check for environment variable first (set during build)
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  // Fallback to current window location for same-origin deployments
  return `${window.location.protocol}//${window.location.host}`;
};

/** Get WebSocket base URL */
export const getWebSocketBaseUrl = (): string => {
  if (import.meta.env.VITE_WS_BASE_URL) {
    return import.meta.env.VITE_WS_BASE_URL;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
};

// =============================================================================
// ERROR HANDLING
// =============================================================================

/** API error response structure */
export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

/** Custom API error class with typed error response */
export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Check if error is an authentication error */
  isAuthError(): boolean {
    return this.status === 401 || this.code === 'UNAUTHORIZED';
  }

  /** Check if error is a forbidden/permission error */
  isForbiddenError(): boolean {
    return this.status === 403 || this.code === 'FORBIDDEN';
  }

  /** Check if error is a not found error */
  isNotFoundError(): boolean {
    return this.status === 404 || this.code === 'NOT_FOUND';
  }

  /** Check if error is a validation error */
  isValidationError(): boolean {
    return this.status === 400 || this.code === 'VALIDATION_ERROR';
  }

  /** Check if error is a rate limit error */
  isRateLimitError(): boolean {
    return this.status === 429 || this.code === 'RATE_LIMITED';
  }
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/** Standard API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorResponse;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

/** Paginated list response */
export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// =============================================================================
// REQUEST OPTIONS
// =============================================================================

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Request body - will be JSON stringified if object */
  body?: unknown;
  /** Query parameters to append to URL */
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to include credentials (default: true for same-origin) */
  includeCredentials?: boolean;
}

// =============================================================================
// API CLIENT STATE
// =============================================================================

/** Current tenant ID for scoping requests */
let currentTenantId: string | null = null;

/** Set the current tenant ID for API requests */
export const setCurrentTenantId = (tenantId: string | null): void => {
  currentTenantId = tenantId;
  // Also sync to localStorage for persistence across page reloads
  if (tenantId) {
    localStorage.setItem('printfarm_tenant_id', tenantId);
  }
};

/** Get the current tenant ID - checks memory first, then localStorage */
export const getCurrentTenantId = (): string | null => {
  // If we have it in memory, use that
  if (currentTenantId) {
    return currentTenantId;
  }
  // Otherwise, try to get from localStorage (for page reloads before auth init completes)
  const stored = localStorage.getItem('printfarm_tenant_id');
  if (stored) {
    currentTenantId = stored; // Cache it in memory
    return stored;
  }
  return null;
};

// =============================================================================
// API CLIENT CORE
// =============================================================================

/**
 * Build URL with query parameters
 */
const buildUrl = (endpoint: string, params?: Record<string, string | number | boolean | undefined | null>): string => {
  const baseUrl = getApiBaseUrl();
  const url = new URL(endpoint.startsWith('/') ? endpoint : `/${endpoint}`, baseUrl);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.toString();
};

/**
 * Build request headers
 */
const buildHeaders = (customHeaders?: HeadersInit): Headers => {
  const headers = new Headers(customHeaders);

  // Set default content type if not specified
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Add tenant header if available - use getCurrentTenantId() to check localStorage fallback
  const tenantId = getCurrentTenantId();
  if (tenantId) {
    headers.set('X-Tenant-ID', tenantId);
  }

  return headers;
};

/**
 * Parse API response and handle errors
 */
const parseResponse = async <T>(response: Response): Promise<T> => {
  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return undefined as T;
  }

  // Try to parse as JSON
  let data: ApiResponse<T>;
  try {
    data = await response.json();
  } catch {
    // If JSON parsing fails, throw a generic error
    throw new ApiError(
      `Request failed: ${response.statusText}`,
      'PARSE_ERROR',
      response.status
    );
  }

  // Handle error responses
  if (!response.ok || data.success === false) {
    const error = data.error || {
      code: 'UNKNOWN_ERROR',
      message: response.statusText || 'An unknown error occurred',
    };
    throw new ApiError(error.message, error.code, response.status, error.details);
  }

  // Return the data payload
  return data.data as T;
};

/**
 * Core request function
 */
const request = async <T>(
  method: string,
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> => {
  const {
    body,
    params,
    timeout = 30000,
    includeCredentials = true,
    headers: customHeaders,
    ...fetchOptions
  } = options;

  const url = buildUrl(endpoint, params);
  const headers = buildHeaders(customHeaders);

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: includeCredentials ? 'include' : 'same-origin',
      signal: controller.signal,
      ...fetchOptions,
    });

    return await parseResponse<T>(response);
  } catch (error) {
    // Handle abort/timeout
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Request timed out', 'TIMEOUT', 408);
    }

    // Re-throw ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    // Handle network errors
    throw new ApiError(
      error instanceof Error ? error.message : 'Network error',
      'NETWORK_ERROR',
      0
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

// =============================================================================
// API CLIENT METHODS
// =============================================================================

export const api = {
  /**
   * GET request
   */
  get: <T>(endpoint: string, options?: RequestOptions): Promise<T> => {
    return request<T>('GET', endpoint, options);
  },

  /**
   * POST request
   */
  post: <T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> => {
    return request<T>('POST', endpoint, { ...options, body });
  },

  /**
   * PUT request
   */
  put: <T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> => {
    return request<T>('PUT', endpoint, { ...options, body });
  },

  /**
   * PATCH request
   */
  patch: <T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> => {
    return request<T>('PATCH', endpoint, { ...options, body });
  },

  /**
   * DELETE request
   */
  delete: <T>(endpoint: string, options?: RequestOptions): Promise<T> => {
    return request<T>('DELETE', endpoint, options);
  },

  /**
   * Upload file using multipart/form-data
   */
  upload: async <T>(endpoint: string, file: File, fieldName: string = 'file', additionalData?: Record<string, string>): Promise<T> => {
    const formData = new FormData();
    formData.append(fieldName, file);

    if (additionalData) {
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });
    }

    const url = buildUrl(endpoint);
    const headers = new Headers();

    // Add tenant header if available (don't set Content-Type, let browser set it with boundary)
    const tenantId = getCurrentTenantId();
    if (tenantId) {
      headers.set('X-Tenant-ID', tenantId);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    return parseResponse<T>(response);
  },

  /**
   * Download file as blob
   */
  download: async (endpoint: string, options?: RequestOptions): Promise<Blob> => {
    const { params, timeout = 60000 } = options || {};
    const url = buildUrl(endpoint, params);
    const headers = buildHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ApiError(
          `Download failed: ${response.statusText}`,
          'DOWNLOAD_ERROR',
          response.status
        );
      }

      return await response.blob();
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

// =============================================================================
// CONVENIENCE HELPERS
// =============================================================================

/**
 * Build pagination query params
 */
export const buildPaginationParams = (
  page: number = 1,
  limit: number = 20,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc'
): Record<string, string | number> => {
  const params: Record<string, string | number> = { page, limit };
  if (sortBy) params.sortBy = sortBy;
  if (sortOrder) params.sortOrder = sortOrder;
  return params;
};

/**
 * Build filter query params (removes undefined/null values)
 */
export const buildFilterParams = (filters: Record<string, unknown>): Record<string, string | number | boolean> => {
  const params: Record<string, string | number | boolean> = {};

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        params[key] = value;
      } else if (Array.isArray(value)) {
        params[key] = value.join(',');
      } else {
        params[key] = String(value);
      }
    }
  });

  return params;
};

export default api;
