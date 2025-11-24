import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import {
  FrontendOrder,
  FrontendOrderItem,
  transformOrderFromDb,
  transformOrderToDb,
} from '@/lib/transformers';
import type { Order as ApiOrder, OrderItem as ApiOrderItem } from '@/types/api';

export type { FrontendOrder as Order, FrontendOrderItem as OrderItem };

export const useOrders = () => {
  const [orders, setOrders] = useState<FrontendOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { tenantId } = useAuth();

  const fetchOrders = useCallback(async (filters?: {
    status?: string;
    platform?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
  }) => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      // Fetch from Cloud API
      const response = await api.get<(ApiOrder & { items?: ApiOrderItem[] })[]>('/api/v1/orders', {
        params: {
          limit: 100,
          sortBy: 'order_date',
          sortOrder: 'desc',
          ...filters
        }
      });

      if (!Array.isArray(response)) {
        throw new Error('Invalid response from server');
      }

      // Transform to frontend format
      const transformedOrders = response.map(transformOrderFromDb);

      setOrders(transformedOrders);
    } catch (error) {
      console.error('Error fetching orders:', error);
      if (error instanceof ApiError && error.isAuthError()) {
        return;
      }
      toast({
        title: "Error",
        description: "Failed to load orders.",
        variant: "destructive",
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  const getOrder = async (id: string): Promise<FrontendOrder | null> => {
    try {
      const response = await api.get<ApiOrder & { items?: ApiOrderItem[] }>(`/api/v1/orders/${id}`);
      return transformOrderFromDb(response);
    } catch (error) {
      console.error('Error fetching order:', error);
      toast({
        title: "Error",
        description: "Failed to load order details.",
        variant: "destructive",
      });
      return null;
    }
  };

  const addOrder = async (orderData: {
    orderNumber?: string;
    platform?: string;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    orderDate?: string;
    totalRevenue?: number;
    shippingCost?: number;
    taxAmount?: number;
    discountAmount?: number;
    shippingStreet?: string;
    shippingCity?: string;
    shippingState?: string;
    shippingZip?: string;
    shippingCountry?: string;
    notes?: string;
    items?: Array<{
      productSkuId?: string;
      finishedGoodId?: string;
      sku: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      totalPrice?: number;
    }>;
  }) => {
    try {
      // Create via Cloud API
      const response = await api.post<ApiOrder & { items?: ApiOrderItem[] }>('/api/v1/orders', {
        order_number: orderData.orderNumber,
        platform: orderData.platform || 'manual',
        customer_name: orderData.customerName,
        customer_email: orderData.customerEmail,
        customer_phone: orderData.customerPhone,
        order_date: orderData.orderDate || new Date().toISOString(),
        total_revenue: orderData.totalRevenue || 0,
        shipping_cost: orderData.shippingCost || 0,
        tax_amount: orderData.taxAmount || 0,
        discount_amount: orderData.discountAmount || 0,
        shipping_street: orderData.shippingStreet,
        shipping_city: orderData.shippingCity,
        shipping_state: orderData.shippingState,
        shipping_zip: orderData.shippingZip,
        shipping_country: orderData.shippingCountry || 'US',
        notes: orderData.notes,
        items: orderData.items?.map(item => ({
          product_sku_id: item.productSkuId,
          finished_good_id: item.finishedGoodId,
          sku: item.sku,
          product_name: item.productName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: item.totalPrice ?? item.quantity * item.unitPrice
        }))
      });

      const newOrder = transformOrderFromDb(response);

      setOrders(prev => [newOrder, ...prev]);
      toast({
        title: "Success",
        description: `Order ${newOrder.orderNumber} has been created.`,
      });

      return newOrder;
    } catch (error) {
      console.error('Error adding order:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create order.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateOrder = async (id: string, updates: Partial<FrontendOrder>) => {
    try {
      const updateData = transformOrderToDb(updates);

      // Update via Cloud API
      const response = await api.put<ApiOrder>(`/api/v1/orders/${id}`, updateData);

      const updatedOrder = transformOrderFromDb(response);

      setOrders(prev => prev.map(order =>
        order.id === id ? { ...order, ...updatedOrder } : order
      ));

      toast({
        title: "Success",
        description: "Order updated successfully.",
      });

      return updatedOrder;
    } catch (error) {
      console.error('Error updating order:', error);
      toast({
        title: "Error",
        description: "Failed to update order.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteOrder = async (id: string) => {
    try {
      // Cancel/delete via Cloud API
      await api.delete(`/api/v1/orders/${id}`);

      setOrders(prev => prev.filter(order => order.id !== id));
      toast({
        title: "Success",
        description: "Order cancelled.",
      });
    } catch (error) {
      console.error('Error deleting order:', error);
      toast({
        title: "Error",
        description: "Failed to cancel order.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Fulfill entire order
  const fulfillOrder = async (id: string) => {
    try {
      const response = await api.post<ApiOrder & { items?: ApiOrderItem[] }>(`/api/v1/orders/${id}/fulfill`);

      const updatedOrder = transformOrderFromDb(response);

      setOrders(prev => prev.map(order =>
        order.id === id ? updatedOrder : order
      ));

      toast({
        title: "Success",
        description: "Order fulfilled.",
      });

      return updatedOrder;
    } catch (error) {
      console.error('Error fulfilling order:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fulfill order.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Fulfill single item
  const fulfillItem = async (orderId: string, itemId: string, quantity?: number) => {
    try {
      const response = await api.post<ApiOrder & { items?: ApiOrderItem[] }>(
        `/api/v1/orders/${orderId}/items/${itemId}/fulfill`,
        { quantity }
      );

      const updatedOrder = transformOrderFromDb(response);

      setOrders(prev => prev.map(order =>
        order.id === orderId ? updatedOrder : order
      ));

      toast({
        title: "Success",
        description: "Item fulfilled.",
      });

      return updatedOrder;
    } catch (error) {
      console.error('Error fulfilling item:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fulfill item.",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Get order statistics
  const getOrderStats = async () => {
    try {
      const response = await api.get<{
        by_status: Record<string, number>;
        by_platform: Record<string, number>;
        total_revenue: number;
        total_orders: number;
      }>('/api/v1/orders/stats');
      return response;
    } catch (error) {
      console.error('Error fetching order stats:', error);
      return null;
    }
  };

  useEffect(() => {
    if (tenantId) {
      fetchOrders();
    }
  }, [tenantId, fetchOrders]);

  return {
    orders,
    loading,
    getOrder,
    addOrder,
    updateOrder,
    deleteOrder,
    fulfillOrder,
    fulfillItem,
    getOrderStats,
    refetch: fetchOrders
  };
};
