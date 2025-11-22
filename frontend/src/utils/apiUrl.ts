/**
 * Central utility for determining API base URL
 * Eliminates hardcoded IP addresses and makes the app location-independent
 */

export const getApiBaseUrl = (): string => {
  // Always use current window location - no hardcoded IPs
  // This ensures the app works regardless of what IP the Pi gets assigned
  return `${window.location.protocol}//${window.location.host}`;
};

/**
 * Get WebSocket URL for real-time connections
 */
export const getWebSocketBaseUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
};