import { useState, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  UserPlus, LogOut,
  Loader2, QrCode,
  PanelLeftClose, PanelLeftOpen,
  Heart,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { getAvatarShape } from '@/lib/avatarShape';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AppLogo } from '@/components/AppLogo';
import { EmojifiedText } from '@/components/CustomEmoji';
import { ProfileSearchDropdown } from '@/components/ProfileSearchDropdown';
import { SidebarNavList } from '@/components/SidebarNavItem';
import { SidebarMoreMenu } from '@/components/SidebarMoreMenu';

import LoginDialog from '@/components/auth/LoginDialog';
import { FollowQRDialog } from '@/components/FollowQRDialog';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLoggedInAccounts, type Account } from '@/hooks/useLoggedInAccounts';
import { useLoginActions } from '@/hooks/useLoginActions';

import { useFeedSettings } from '@/hooks/useFeedSettings';
import { useAppContext } from '@/hooks/useAppContext';
import { useHasUnreadNotifications } from '@/hooks/useHasUnreadNotifications';
import { useHasUnreadMessages } from '@/hooks/useHasUnreadMessages';
import { useGroupChatHasUnread } from '@/hooks/useGroupChatHasUnread';
import { VerifiedNip05Text } from '@/components/Nip05Badge';
import { useProfileUrl } from '@/hooks/useProfileUrl';
import { isItemActive } from '@/lib/sidebarItems';

import { useUserStatus } from '@/hooks/useUserStatus';
import { usePublishStatus } from '@/hooks/usePublishStatus';
import { useToast } from '@/hooks/useToast';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';


interface LeftSidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function LeftSidebar({ collapsed = false, onToggleCollapse }: LeftSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, metadata, event: currentUserEvent, isLoading: isProfileLoading } = useCurrentUser();
  const currentUserAvatarShape = getAvatarShape(metadata);
  const { currentUser, otherUsers, setLogin } = useLoggedInAccounts();
  const { logout } = useLoginActions();

  const {
    orderedItems, hiddenItems, updateSidebarOrder, addToSidebar, addDividerToSidebar, removeFromSidebar,
  } = useFeedSettings();
  const { config } = useAppContext();

  const visibleItems = orderedItems;
  const visibleHiddenItems = hiddenItems;

  const hasUnread = useHasUnreadNotifications();
  const hasUnreadMessages = useHasUnreadMessages();
  const { hasUnread: hasUnreadGroups } = useGroupChatHasUnread();
  const userProfileUrl = useProfileUrl(user?.pubkey ?? '', metadata);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const { startSignup } = useOnboarding();
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  const [followQROpen, setFollowQROpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // NIP-38 status
  const userStatus = useUserStatus(user?.pubkey);
  const publishStatus = usePublishStatus();
  const { toast } = useToast();
  const [statusEditing, setStatusEditing] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');

  const homePage = config.homePage;

  const scrollToTopIfCurrent = useCallback((to: string) => (e: React.MouseEvent) => {
    if (location.pathname === to) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [location.pathname]);

  const getDisplayName = (account: Account) => account.metadata.name || account.metadata.display_name || 'Anonymous';

  const handleLogout = async () => {
    setAccountPopoverOpen(false);
    await logout();
    navigate('/');
  };

  return (
    <aside
      className={cn(
        'hidden sidebar:flex flex-col h-screen sticky top-0 py-3 shrink-0 transition-all',
        collapsed ? 'w-[72px] px-2 items-center' : 'px-4 w-[300px] lg:w-1/4 lg:max-w-[300px]',
      )}
    >
      {/* Logo + collapse toggle */}
      <div className={cn('flex mb-1', collapsed ? 'flex-col items-center gap-2 px-1' : 'items-center justify-between px-3')}>
        <Link to="/" onClick={scrollToTopIfCurrent('/')}>
          <div className="bg-background/85 rounded-full">
            <AppLogo size={collapsed ? 36 : 48} />
          </div>
        </Link>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-2 py-4">
          <ProfileSearchDropdown
            placeholder="Search..."
            inputClassName="py-3.5 bg-muted text-foreground placeholder:text-muted-foreground border-0"
            enableTextSearch
          />
        </div>
      )}

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <SidebarNavList
          items={visibleItems}
          editing={editing}
          onRemove={removeFromSidebar}
          onReorder={updateSidebarOrder}
          isActive={(id) => isItemActive(id, location.pathname, location.search, userProfileUrl, homePage)}
          getOnClick={(id) => id === homePage ? scrollToTopIfCurrent('/') : undefined}
          getProfilePath={(id) => id === 'profile' ? userProfileUrl : undefined}
          getShowIndicator={(id) => {
            if (id === 'notifications') return hasUnread;
            if (id === 'messages') return hasUnreadMessages.hasUnread || hasUnreadGroups;
            return undefined;
          }}
          homePage={homePage}
          compact={collapsed}
          minimal
        />

        <SidebarMoreMenu
          editing={editing}
          hiddenItems={visibleHiddenItems}
          onDoneEditing={() => setEditing(false)}
          onStartEditing={() => setEditing(true)}
          onAdd={addToSidebar}
          onAddDivider={addDividerToSidebar}
          open={moreMenuOpen}
          onOpenChange={setMoreMenuOpen}
          homePage={homePage}
          compact={collapsed}
        />
      </nav>

      {/* Logged-out join pill — same position as account button, pushed up from bottom */}
      {!user && (
        <div className={cn('pt-2 pb-1', collapsed && 'px-1')}>
          <button
            onClick={() => setLoginDialogOpen(true)}
            className={cn(
              'flex items-center justify-center rounded-full bg-[var(--2140-bitcoin)] text-black font-semibold hover:bg-[var(--2140-bitcoin-hover)] transition-colors cursor-pointer',
              collapsed ? 'w-10 h-10' : 'w-full h-11 text-sm gap-2',
            )}
            title="Join"
          >
            <UserPlus className="size-4" />
            {!collapsed && <span>Join</span>}
          </button>
        </div>
      )}

      {/* User profile at bottom */}
      {user && currentUser && (
        <div className="pt-2">
          <Popover open={accountPopoverOpen} onOpenChange={setAccountPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'flex items-center rounded-full hover:bg-secondary/60 transition-colors cursor-pointer bg-background/85',
                  collapsed ? 'justify-center p-2' : 'gap-3 p-3 w-full text-left',
                )}
              >
                {isProfileLoading ? (
                  <Skeleton className={cn('shrink-0 rounded-full', collapsed ? 'size-9' : 'size-10')} />
                ) : (
                  <Avatar shape={currentUserAvatarShape} className={cn('shrink-0', collapsed ? 'size-9' : 'size-10')}>
                    <AvatarImage src={metadata?.picture} alt={metadata?.name} />
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                      {(metadata?.name || metadata?.display_name || 'Anonymous')[0]?.toUpperCase() ?? '?'}
                    </AvatarFallback>
                  </Avatar>
                )}
                {!collapsed && (
                  <div className="flex flex-col min-w-0 flex-1 gap-1">
                    {isProfileLoading ? (
                      <><Skeleton className="h-3.5 w-24" /><Skeleton className="h-3 w-16" /></>
                    ) : (
                      <>
                        <span className="font-semibold text-sm truncate">
                          {currentUserEvent && (metadata?.name || metadata?.display_name)
                            ? <EmojifiedText tags={currentUserEvent.tags}>{metadata.name || metadata.display_name || ''}</EmojifiedText>
                            : (metadata?.name || metadata?.display_name || 'Anonymous')}
                        </span>
                        {metadata?.nip05 && (
                          <VerifiedNip05Text nip05={metadata.nip05} pubkey={user.pubkey} className="text-xs text-muted-foreground truncate" />
                        )}
                      </>
                    )}
                  </div>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" sideOffset={8} className="w-[260px] p-0 rounded-2xl shadow-xl border border-border overflow-hidden">
              {/* Current user */}
              <Link to={userProfileUrl} onClick={() => setAccountPopoverOpen(false)} className="block p-4 border-b border-border hover:bg-secondary/60 transition-colors">
                <div className="flex items-center gap-3">
                  <Avatar shape={currentUserAvatarShape} className="size-11 shrink-0">
                    <AvatarImage src={currentUser.metadata.picture} alt={getDisplayName(currentUser)} />
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">{getDisplayName(currentUser).charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-sm truncate">
                      {currentUser.event ? <EmojifiedText tags={currentUser.event.tags}>{getDisplayName(currentUser)}</EmojifiedText> : getDisplayName(currentUser)}
                    </span>
                    {currentUser.metadata.nip05 && (
                      <VerifiedNip05Text nip05={currentUser.metadata.nip05} pubkey={currentUser.pubkey} className="text-xs text-muted-foreground truncate" />
                    )}
                  </div>
                </div>
              </Link>

              {/* Status editor */}
              <div className="border-b border-border">
                {statusEditing ? (
                  <div className="p-3 space-y-2">
                    <Input
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value.slice(0, 80))}
                      placeholder="What are you up to?"
                      className="h-8 text-base md:text-sm"
                      maxLength={80}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (publishStatus.isPending) return;
                          const text = statusDraft.trim();
                          publishStatus.mutateAsync({ status: text }).then(() => {
                            setStatusEditing(false);
                            setStatusDraft('');
                            toast({ title: text ? 'Status updated' : 'Status cleared' });
                          }).catch((err) => console.error('Failed to publish status:', err));
                        } else if (e.key === 'Escape') {
                          setStatusEditing(false);
                          setStatusDraft('');
                        }
                      }}
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          if (publishStatus.isPending) return;
                          const text = statusDraft.trim();
                          publishStatus.mutateAsync({ status: text }).then(() => {
                            setStatusEditing(false);
                            setStatusDraft('');
                            toast({ title: text ? 'Status updated' : 'Status cleared' });
                          }).catch((err) => console.error('Failed to publish status:', err));
                        }}
                        disabled={publishStatus.isPending}
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                      >
                        {publishStatus.isPending ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
                      </button>
                      {userStatus.status && (
                        <button
                          onClick={() => {
                            publishStatus.mutateAsync({ status: '' }).then(() => {
                              setStatusEditing(false);
                              setStatusDraft('');
                              toast({ title: 'Status cleared' });
                            }).catch((err) => console.error('Failed to clear status:', err));
                          }}
                          disabled={publishStatus.isPending}
                          className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        onClick={() => { setStatusEditing(false); setStatusDraft(''); }}
                        className="text-xs text-muted-foreground hover:underline ml-auto"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setStatusEditing(true);
                      setStatusDraft(userStatus.status ?? '');
                    }}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-secondary/60 transition-colors"
                  >
                    {userStatus.status ? (
                      <span className="truncate text-muted-foreground italic text-xs pr-1">{userStatus.status}</span>
                    ) : (
                      <span className="text-muted-foreground">Set a status</span>
                    )}
                  </button>
                )}
              </div>

              {/* Other accounts */}
              {otherUsers.length > 0 && (
                <div className="border-b border-border">
                  {otherUsers.map((account) => (
                    <button key={account.id} onClick={() => { setLogin(account.id); setAccountPopoverOpen(false); }} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-secondary/60 transition-colors">
                      <Avatar shape={getAvatarShape(account.metadata)} className="size-9 shrink-0">
                        <AvatarImage src={account.metadata.picture} alt={getDisplayName(account)} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">{getDisplayName(account).charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">
                          {account.event ? <EmojifiedText tags={account.event.tags}>{getDisplayName(account)}</EmojifiedText> : getDisplayName(account)}
                        </span>
                        {account.metadata.nip05 && <VerifiedNip05Text nip05={account.metadata.nip05} pubkey={account.pubkey} className="text-xs text-muted-foreground truncate" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="py-1">
                <button onClick={() => { setAccountPopoverOpen(false); setFollowQROpen(true); }} className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium hover:bg-secondary/60 transition-colors">
                  <QrCode className="size-4 text-muted-foreground" />
                  <span>Share profile</span>
                </button>
                <button onClick={() => { setAccountPopoverOpen(false); navigate('/settings/profile#donations'); }} className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium text-orange-500 hover:text-orange-400 hover:bg-orange-500/10 transition-colors">
                  <Heart className="size-4 text-orange-500" />
                  <span>Accept donations</span>
                </button>
                <button onClick={() => { setAccountPopoverOpen(false); setLoginDialogOpen(true); }} className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium hover:bg-secondary/60 transition-colors">
                  <UserPlus className="size-4 text-muted-foreground" />
                  <span>Add another account</span>
                </button>
                <button onClick={handleLogout} className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
                  <LogOut className="size-4" />
                  <span>Log out @{metadata?.name || metadata?.display_name || 'Anonymous'}</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      <LoginDialog isOpen={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} onLogin={() => setLoginDialogOpen(false)} onSignupClick={startSignup} />
      <FollowQRDialog open={followQROpen} onOpenChange={setFollowQROpen} />
    </aside>
  );
}
