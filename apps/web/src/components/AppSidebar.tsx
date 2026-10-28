import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  ChevronsUpDown,
  KeyRound,
  LayoutGrid,
  ListChecks,
  LogOut,
  Moon,
  Play,
  Shield,
  Sun,
  Terminal,
} from 'lucide-react';
import { api } from '@/api/endpoints';
import { useRequiredMe } from '@/auth';
import { applyTheme, currentTheme } from '@/lib/theme';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  end?: boolean;
  external?: boolean;
}

const WORKSPACE: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/new', label: 'Playground', icon: Play },
  { to: '/executions', label: 'Runs', icon: ListChecks },
];
const CONFIGURE: NavItem[] = [{ to: '/api-keys', label: 'API keys', icon: KeyRound }];
const ADMIN: NavItem[] = [{ to: '/admin', label: 'Platform', icon: Shield }];
const RESOURCES: NavItem[] = [{ to: '/docs', label: 'API reference', icon: BookOpen, external: true }];

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  asChild
                  isActive={!item.external && active}
                  className="data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:shadow-raised"
                >
                  {item.external ? (
                    <a href={item.to} target="_blank" rel="noreferrer">
                      <item.icon />
                      <span>{item.label}</span>
                    </a>
                  ) : (
                    <NavLink to={item.to} end={item.end} onClick={() => isMobile && setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Greeting/avatar name: profile name when set, otherwise the part of the email before the @. */
export function displayName(me: { user: { email: string; name?: string | null } }): string {
  return me.user.name?.trim() || me.user.email.split('@')[0] || 'there';
}

export function AppSidebar() {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const name = displayName(me);

  async function logout() {
    try {
      await api.logout();
    } finally {
      qc.clear();
      navigate('/login');
    }
  }

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="px-3 py-4">
        <NavLink to="/" className="flex items-center gap-2.5 rounded-md px-1">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Terminal className="size-4" aria-hidden />
          </span>
          <span className="text-sm font-semibold leading-tight">
            GigaCode
            <span className="block text-xs font-normal text-muted-foreground">{me.tenant.name}</span>
          </span>
        </NavLink>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Workspace" items={WORKSPACE} />
        <NavGroup label="Configure" items={CONFIGURE} />
        {me.user.role === 'platform_admin' && <NavGroup label="Admin" items={ADMIN} />}
        <NavGroup label="Resources" items={RESOURCES} />
      </SidebarContent>
      <SidebarFooter className="p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg text-xs uppercase">{name.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{me.user.email}</span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-56">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{me.tenant.name}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark')}>
              <Sun className="size-4 dark:hidden" aria-hidden />
              <Moon className="hidden size-4 dark:block" aria-hidden />
              Toggle theme
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void logout()}>
              <LogOut className="size-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
