import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  FrontendOrder, 
  FrontendOrderItem,
  transformOrderFromDb, 
  transformOrderItemFromDb, 
  transformOrderToDb,
  DbOrder,
  DbOrderItem
} from '@/lib/transformers';

export type { FrontendOrder as Order, FrontendOrderItem as OrderItem };

export const useOrders = () => {
  const [orders, setOrders] = useState<FrontendOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchOrders = async () => {
    try {
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .order('order_date', { ascending: false });

      if (ordersError) throw ordersError;

      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*');

      if (itemsError) throw itemsError;

      // Combine orders with their items
      const ordersWithItems: FrontendOrder[] = (ordersData || []).map(order => {
        const orderItems = (itemsData || []).filter(item => item.order_id === order.id);
        // Fix total_revenue type conversion
        const orderWithNumericRevenue = {
          ...order,
          total_revenue: typeof order.total_revenue === 'string' ? parseFloat(order.total_revenue) || 0 : order.total_revenue || 0
        };
        const transformedOrder = transformOrderFromDb(orderWithNumericRevenue as DbOrder);
        return {
          ...transformedOrder,
          items: orderItems.map(item => transformOrderItemFromDb(item as DbOrderItem))
        };
      });

      setOrders(ordersWithItems);
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast({
        title: "Error",
        description: "Failed to load orders from database.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addOrder = async (orderData: {
    orderNumber: string;
    platform: string;
    customerName: string;
    customerEmail?: string;
    orderDate: string;
    status?: string;
    totalRevenue: number;
    shippingStreet?: string;
    shippingCity?: string;
    shippingState?: string;
    shippingZip?: string;
    shippingCountry?: string;
    items: Array<{
      sku: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      finishedGoodId?: string;
    }>;
  }) => {
    try {
      const insertData = {
        order_number: orderData.orderNumber,
        platform: orderData.platform,
        customer_name: orderData.customerName,
        customer_email: orderData.customerEmail,
        order_date: orderData.orderDate,
        status: orderData.status || 'pending',
        total_revenue: orderData.totalRevenue.toString(),
        shipping_street: orderData.shippingStreet,
        shipping_city: orderData.shippingCity,
        shipping_state: orderData.shippingState,
        shipping_zip: orderData.shippingZip,
        shipping_country: orderData.shippingCountry || 'USA',
        tenant_id: '550e8400-e29b-41d4-a716-446655440000' // Using demo tenant
      };

      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert(insertData)
        .select()
        .single();

      if (orderError) throw orderError;

      const { data: newItems, error: itemsError } = await supabase
        .from('order_items')
        .insert(
          orderData.items.map(item => ({
            order_id: newOrder.id,
            sku: item.sku,
            product_name: item.productName,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            finished_good_id: item.finishedGoodId,
            tenant_id: '550e8400-e29b-41d4-a716-446655440000' // Using demo tenant
          }))
        )
        .select();

      if (itemsError) throw itemsError;

      // Fix total_revenue type conversion
      const orderWithNumericRevenue = {
        ...newOrder,
        total_revenue: typeof newOrder.total_revenue === 'string' ? parseFloat(newOrder.total_revenue) || 0 : newOrder.total_revenue || 0
      };
      const transformedOrder = transformOrderFromDb(orderWithNumericRevenue as DbOrder);
      const orderWithItems: FrontendOrder = {
        ...transformedOrder,
        items: (newItems || []).map(item => transformOrderItemFromDb(item as DbOrderItem))
      };

      setOrders(prev => [orderWithItems, ...prev]);
      toast({
        title: "Success",
        description: `Order ${orderData.orderNumber} has been created.`,
      });

      return orderWithItems;
    } catch (error) {
      console.error('Error adding order:', error);
      toast({
        title: "Error",
        description: "Failed to create order.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateOrder = async (id: string, updates: Partial<FrontendOrder>) => {
    try {
      const updateData: any = transformOrderToDb(updates);
      // Convert total_revenue to string if it's a number for database storage
      if (typeof updateData.total_revenue === 'number') {
        updateData.total_revenue = updateData.total_revenue.toString();
      }

      const { data, error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Fix total_revenue type conversion
      const orderWithNumericRevenue = {
        ...data,
        total_revenue: typeof data.total_revenue === 'string' ? parseFloat(data.total_revenue) || 0 : data.total_revenue || 0
      };
      const transformedOrder = transformOrderFromDb(orderWithNumericRevenue as DbOrder);
      setOrders(prev => prev.map(order => 
        order.id === id ? { ...order, ...transformedOrder } : order
      ));

      toast({
        title: "Success",
        description: "Order updated successfully.",
      });

      return data;
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
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setOrders(prev => prev.filter(order => order.id !== id));
      toast({
        title: "Success",
        description: "Order deleted successfully.",
      });
    } catch (error) {
      console.error('Error deleting order:', error);
      toast({
        title: "Error",
        description: "Failed to delete order.",
        variant: "destructive",
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  return {
    orders,
    loading,
    addOrder,
    updateOrder,
    deleteOrder,
    refetch: fetchOrders
  };
};