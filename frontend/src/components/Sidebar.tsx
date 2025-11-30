import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Printer, List, Package, Bot, X, Settings, File, Layers, ShoppingCart, BarChart, ClipboardList, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';

type SidebarProps = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

const Sidebar = ({ sidebarOpen, setSidebarOpen, collapsed, setCollapsed }: SidebarProps) => {
  const { profile, tenant } = useAuth();

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/printers', label: 'Printers', icon: Printer },
    { href: '/worklist', label: 'Worklist', icon: ClipboardList },
    { href: '/queue', label: 'Print Queue', icon: List },
    { href: '/products', label: 'Products', icon: File },
    { href: '/material-inventory', label: 'Materials', icon: Layers },
    { href: '/inventory', label: 'Finished Goods', icon: Package },
    { href: '/orders', label: 'Orders', icon: ShoppingCart },
    { href: '/analytics', label: 'Analytics', icon: BarChart },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  const NavItem = ({ href, label, icon: Icon }: { href: string; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }) => {
    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <NavLink
              to={href}
              end
              className="flex items-center justify-center rounded-lg transition-all h-10 w-10"
              onClick={() => { if (window.innerWidth < 640) setSidebarOpen(false) }}
            >
              {({ isActive }) => (
                <div className={cn(
                  "flex items-center justify-center h-10 w-10 rounded-lg transition-all",
                  isActive ? "bg-primary" : "hover:bg-muted"
                )}>
                  <Icon className={cn("h-5 w-5", isActive ? "text-primary-foreground" : "text-foreground")} />
                </div>
              )}
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <NavLink
        to={href}
        end
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 rounded-lg px-3 h-10 transition-all",
            isActive
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "text-foreground hover:bg-muted hover:text-primary"
          )
        }
        onClick={() => { if (window.innerWidth < 640) setSidebarOpen(false) }}
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span className="font-medium whitespace-nowrap">
          {label}
        </span>
      </NavLink>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/60 z-30 sm:hidden",
          sidebarOpen ? "block" : "hidden"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-card transition-all duration-300 ease-in-out sm:relative sm:translate-x-0",
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? "w-[68px]" : "w-64"
        )}
      >
        {/* Header */}
        <div className={cn(
          "flex h-14 items-center border-b lg:h-[60px]",
          collapsed ? "justify-center px-2" : "justify-between px-4 lg:px-6"
        )}>
          <NavLink
            to="/"
            className={cn(
              "flex items-center gap-2 font-semibold text-foreground",
              collapsed && "justify-center"
            )}
          >
            <Bot className="h-6 w-6 text-primary shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">AutoPrintFarm</span>}
          </NavLink>

          {/* Mobile close button */}
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden shrink-0"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <nav className={cn(
            "flex flex-col p-2",
            collapsed ? "items-center gap-2" : "gap-1"
          )}>
            {navItems.map((item) => (
              <NavItem key={item.label} {...item} />
            ))}
          </nav>
        </div>

        {/* Collapse toggle - desktop only */}
        <div className={cn(
          "hidden sm:flex border-t p-2",
          collapsed ? "justify-center" : "justify-end"
        )}>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setCollapsed(!collapsed)}
              >
                <ChevronLeft className={cn(
                  "h-4 w-4 transition-transform duration-300",
                  collapsed && "rotate-180"
                )} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
