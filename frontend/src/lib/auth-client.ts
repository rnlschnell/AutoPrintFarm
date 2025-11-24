/**
 * PrintFarm Auth Client
 *
 * Authentication client for Better Auth integration.
 * Handles sign in, sign up, sign out, and session management.
 */

import { getApiBaseUrl } from './api-client';
import type { User, Session } from '@/types/api';

// =============================================================================
// TYPES
// =============================================================================

export interface AuthSession {
  session: Session | null;
  user: User | null;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  company_name?: string;
}

export interface RegisterResponse {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
  session: {
    id: string;
    userId: string;
    expiresAt: string;
    token: string;
  };
  tenant: {
    id: string;
    subdomain: string;
    company_name: string;
    role: string;
  };
}

export interface AuthError {
  code: string;
  message: string;
}

export interface AuthResult<T = unknown> {
  data?: T;
  error?: AuthError;
}

// Better Auth returns 'name' but our User type expects 'full_name'
interface BetterAuthUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  isActive?: boolean;
  lastLogin?: string | null;
}

interface BetterAuthSession {
  id: string;
  userId: string;
  expiresAt: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * Transform Better Auth user to our User type
 */
function transformUser(user: BetterAuthUser): User {
  return {
    id: user.id,
    email: user.email,
    full_name: user.name, // Map 'name' to 'full_name'
    is_active: user.isActive ? 1 : 1, // Default to active
    last_login: user.lastLogin || null,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  };
}

/**
 * Transform Better Auth session response to our AuthSession type
 */
function transformAuthSession(data: { session?: BetterAuthSession; user?: BetterAuthUser }): AuthSession {
  return {
    session: data.session ? {
      id: data.session.id,
      userId: data.session.userId,
      expiresAt: data.session.expiresAt,
      user: data.user ? transformUser(data.user) : null as unknown as User,
    } : null,
    user: data.user ? transformUser(data.user) : null,
  };
}

// =============================================================================
// AUTH CLIENT
// =============================================================================

class AuthClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getApiBaseUrl();
  }

  /**
   * Update base URL (useful when environment changes)
   */
  updateBaseUrl(): void {
    this.baseUrl = getApiBaseUrl();
  }

  /**
   * Make an authenticated request to the auth API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<AuthResult<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        credentials: 'include', // Include cookies for session management
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          error: {
            code: data.error?.code || 'AUTH_ERROR',
            message: data.error?.message || data.message || 'Authentication failed',
          },
        };
      }

      return { data: data.data || data };
    } catch (error) {
      return {
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }

  /**
   * Sign in with email and password
   */
  async signIn(credentials: SignInCredentials): Promise<AuthResult<AuthSession>> {
    const result = await this.request<{
      redirect?: boolean;
      token?: string;
      user?: User;
      session?: Session;
    }>('/api/v1/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });

    if (result.error) {
      return { error: result.error };
    }

    // Better Auth sign-in returns { redirect, token, user } instead of { session, user }
    // We need to fetch the full session after sign-in
    if (result.data?.user && !result.data?.session) {
      // Fetch the session to get the full session object
      const sessionResult = await this.getSession();
      if (sessionResult.data) {
        return { data: sessionResult.data };
      }
    }

    return { data: result.data as AuthSession };
  }

  /**
   * Register a new user with atomic tenant creation
   * This is the preferred method for new user registration.
   * It atomically creates: user, account, tenant, membership, and session.
   */
  async register(data: RegisterData): Promise<AuthResult<RegisterResponse>> {
    return this.request<RegisterResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<AuthResult<void>> {
    return this.request<void>('/api/v1/auth/sign-out', {
      method: 'POST',
    });
  }

  /**
   * Get the current session
   */
  async getSession(): Promise<AuthResult<AuthSession>> {
    const result = await this.request<{ session?: BetterAuthSession; user?: BetterAuthUser }>('/api/v1/auth/get-session', {
      method: 'GET',
    });

    if (result.error) {
      return { error: result.error };
    }

    if (result.data) {
      return { data: transformAuthSession(result.data) };
    }

    return { data: { session: null, user: null } };
  }

  /**
   * Request password reset
   */
  async forgotPassword(email: string): Promise<AuthResult<{ message: string }>> {
    return this.request<{ message: string }>('/api/v1/auth/forget-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<AuthResult<{ message: string }>> {
    return this.request<{ message: string }>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const authClient = new AuthClient();

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Sign in with email and password
 */
export const signIn = (credentials: SignInCredentials) => authClient.signIn(credentials);

/**
 * Register a new user with atomic tenant creation
 * This is the preferred method for new user registration.
 */
export const register = (data: RegisterData) => authClient.register(data);

/**
 * Sign out the current user
 */
export const signOut = () => authClient.signOut();

/**
 * Get the current session
 */
export const getSession = () => authClient.getSession();

/**
 * Request password reset
 */
export const forgotPassword = (email: string) => authClient.forgotPassword(email);

/**
 * Reset password with token
 */
export const resetPassword = (token: string, newPassword: string) =>
  authClient.resetPassword(token, newPassword);

export default authClient;
