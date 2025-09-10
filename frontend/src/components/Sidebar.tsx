
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Printer, List, Package, Bot, X, Settings, File, Layers, ShoppingCart, BarChart, Users, Store, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

type SidebarProps = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
};

const Sidebar = ({ sidebarOpen, setSidebarOpen }: SidebarProps) => {
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
    { href: '/store', label: 'Store', icon: Store },
    
    { href: '/settings', label: 'Settings', icon: Settings },
  ];
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 bg-black/60 z-30 sm:hidden",
          sidebarOpen ? "block" : "hidden"
        )}
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-card transition-transform duration-300 ease-in-out sm:relative sm:translate-x-0",
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4 lg:h-[60px] lg:px-6">
          <NavLink to="/" className="flex items-center gap-2 whitespace-nowrap font-semibold text-foreground">
            <Bot className="h-6 w-6 text-primary" />
            <span>{tenant?.company_name || 'PrintFarm OS'}</span>
          </NavLink>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <nav className="flex flex-col gap-1 p-2">
            {navItems.map(({ href, label, icon: Icon }) => (
              <NavLink
                key={label}
                to={href}
                end
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 h-10 transition-all",
                    isActive 
                      ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                      : "text-muted-foreground hover:bg-muted hover:text-primary"
                  )
                }
                onClick={() => { if (window.innerWidth < 640) setSidebarOpen(false) }}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="font-medium whitespace-nowrap">
                  {label}
                </span>
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
