
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Layout from "./components/Layout";
import Printers from "./pages/Printers";
import Worklist from "./pages/Worklist";
import PrintQueue from "./pages/PrintQueue";
import MaterialInventory from "./pages/MaterialInventory";
import Inventory from "./pages/Inventory";
import Settings from "./pages/Settings";
import Store from "./pages/Store";
import { ThemeProvider } from "./components/ThemeProvider";
import Products from "./pages/Products";
import Orders from "./pages/Orders";
import Analytics from "./pages/Analytics";
import ProductDetail from "./pages/ProductDetail";
import WikiManagement from "./pages/WikiManagement";
import WikiEditor from "./pages/WikiEditor";
import WikiView from "./pages/WikiView";
import TaskDetailPage from "./pages/TaskDetailPage";
import ErrorBoundary from "./components/ErrorBoundary";

import SimpleAuthPage from "./components/auth/SimpleAuthPage";
import { AuthProvider } from "./contexts/AuthContext";
import SimpleProtectedRoute from "./components/auth/SimpleProtectedRoute";
import { ColorPresetsProvider } from "./contexts/ColorPresetsContext";
const queryClient = new QueryClient();

const App = () => {
  console.log('=== APP COMPONENT RENDERING ===');
  
  return (
      <ErrorBoundary>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AuthProvider>
              <Routes>
                {/* Protected routes wrapped in Layout */}
                <Route path="/" element={
                  <SimpleProtectedRoute>
                    <ColorPresetsProvider>
                      <ErrorBoundary>
                        <Layout />
                      </ErrorBoundary>
                    </ColorPresetsProvider>
                  </SimpleProtectedRoute>
                }>
                <Route index element={<Index />} />
                <Route path="printers" element={<Printers />} />
                <Route path="worklist" element={<Worklist />} />
                <Route path="worklist/:taskId" element={<TaskDetailPage />} />
                <Route path="queue" element={<PrintQueue />} />
                <Route path="products" element={<Products />} />
                <Route path="material-inventory" element={<MaterialInventory />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="orders" element={<Orders />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="store" element={<Store />} />
                <Route path="store/product/:id" element={<ProductDetail />} />
                <Route path="wiki-management" element={<WikiManagement />} />
                <Route path="wiki-management/new" element={<WikiEditor />} />
                <Route path="wiki-management/:wikiId" element={<WikiEditor />} />
                <Route path="wiki/:wikiId" element={<WikiView />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              
              {/* Public auth route */}
              <Route path="/auth" element={<SimpleAuthPage />} />
              
              {/* 404 route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
              </AuthProvider>
            </BrowserRouter>
          </TooltipProvider>
        </QueryClientProvider>
        </ThemeProvider>
      </ErrorBoundary>
  );
};

export default App;
