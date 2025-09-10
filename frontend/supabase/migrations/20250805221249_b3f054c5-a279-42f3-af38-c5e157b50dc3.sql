-- Update existing orders to calculate total_revenue from subtotal + shipping_cost
UPDATE orders 
SET total_revenue = COALESCE(subtotal, 0) + COALESCE(shipping_cost, 0)
WHERE total_revenue IS NULL;