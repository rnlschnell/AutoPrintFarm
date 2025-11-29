import { Menu, Search, Settings, LogOut, ArrowLeft, Bluetooth, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useNavigate, useLocation } from 'react-router-dom';
type HeaderProps = {
  setSidebarOpen: (open: boolean) => void;
};
const Header = ({
  setSidebarOpen
}: HeaderProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    tenant,
    profile,
    signOut
  } = useAuth();
  const handleSignOut = async () => {
    await signOut();
  };
  const handleSettingsClick = () => {
    navigate('/settings');
  };
  const initials = profile?.first_name || profile?.last_name ? `${profile.first_name?.[0] || ''}${profile.last_name?.[0] || ''}`.toUpperCase().slice(0, 2) : 'U';
  return <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-card px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6 py-2">
      <Button variant="outline" size="icon" className="sm:hidden" onClick={() => setSidebarOpen(true)}>
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle Menu</span>
      </Button>
      {location.pathname.startsWith('/wiki/') && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/wiki-management')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>
      )}
      <div className="ml-auto flex-1 md:grow-0">
        <h2 className="font-medium text-foreground whitespace-nowrap text-base text-center">
          Howdy, {profile?.first_name || 'there'}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/hub-management')}
          title="Hub Management"
        >
          <HardDrive className="h-5 w-5" />
          <span className="sr-only">Hub Management</span>
        </Button>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="overflow-hidden rounded-full h-9 w-9">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {profile?.first_name} {profile?.last_name}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {tenant?.company_name || 'Demo Mode'}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/hub-management')}>
              <Bluetooth className="mr-2 h-4 w-4" />
              <span>Hub Management</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSettingsClick}>
              <Settings className="mr-2 h-4 w-4" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>;
};
export default Header;