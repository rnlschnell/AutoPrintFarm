import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { useState, useEffect } from "react";

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

const Layout = () => {
  console.log('Layout component rendering');

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    // Initialize from localStorage
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return stored === "true";
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <div className="h-screen overflow-hidden w-full bg-background text-foreground flex">
      <Sidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header setSidebarOpen={setSidebarOpen} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
