-- Temporarily disable RLS for development on products tables
ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_skus DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_components DISABLE ROW LEVEL SECURITY;