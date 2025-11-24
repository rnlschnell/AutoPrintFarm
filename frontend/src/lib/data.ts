/**
 * Legacy mock data file - kept for backwards compatibility during migration.
 * These should be replaced with API calls using the hooks in src/hooks/
 */

// Empty orders array - Analytics page should be updated to use useOrders hook
export const orders: Array<{
  id: string;
  orderDate: string;
  status: string;
  total: number;
  platform: string;
  items: Array<{
    productName: string;
    quantity: number;
    price: number;
  }>;
}> = [];

// Empty printers array - pages should use usePrinters hook
export const printers: Array<{
  id: string;
  name: string;
  status: string;
}> = [];

// Empty products array - pages should use useProductsNew hook
export const products: Array<{
  id: string;
  name: string;
  category: string;
}> = [];
