-- Enable real-time updates for product_skus table
ALTER TABLE product_skus REPLICA IDENTITY FULL;
ALTER publication supabase_realtime ADD TABLE product_skus;

-- Enable real-time updates for finished_goods table  
ALTER TABLE finished_goods REPLICA IDENTITY FULL;
ALTER publication supabase_realtime ADD TABLE finished_goods;