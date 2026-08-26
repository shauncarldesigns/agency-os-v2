import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Mail,
  Headphones,
  Globe,
  BookOpen,
  Library,
  Settings,
  Search as SearchIcon,
  Menu,
  X,
  MessageSquareText,
  TrendingUp,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Keyboard,
  UserRound,
  Bot,
  PhoneIncoming,
  Archive,
} from 'lucide-react';
import type { AgencySettings, Tab } from '../../lib/types';
import { endAccessSession, signBackIn } from '../../lib/accessSession';

// ---------------------------------------------------------------------------
// App shell — sidebar navigation layout (visual spec: mockups/AppShell.jsx).
// Slate-50 canvas, white sidebar with right border, blue→indigo gradient as
// the single accent. Pages render in the <main> slot. Below lg the sidebar
// collapses to a hamburger + overlay drawer.
// ---------------------------------------------------------------------------

export interface NavBadges {
  callOutreach?: number | null;
  coldCallPipeline?: number | null;
  automatedPipeline?: number | null;
  sites?: number | null;
  receptionistInterest?: number | null;
  archivedLeads?: number | null;
}

interface NavItem {
  key: Tab;
  label: string;
  icon: typeof LayoutDashboard;
  badgeKey?: keyof NavBadges;
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'Main',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'research', label: 'Research', icon: TrendingUp },
      { key: 'prospect', label: 'Lead Finder', icon: SearchIcon },
      { key: 'pipeline', label: 'Lead Pipeline', icon: Users, badgeKey: 'coldCallPipeline' },
      { key: 'archived-leads', label: 'Archived Leads', icon: Archive, badgeKey: 'archivedLeads' },
      { key: 'email-outreach', label: 'Email Outreach', icon: Mail, badgeKey: 'callOutreach' },
      { key: 'automated-pipeline', label: 'Text Outreach', icon: MessageSquareText, badgeKey: 'automatedPipeline' },
      { key: 'builder', label: 'Builder Employee', icon: Bot, badgeKey: 'automatedPipeline' },
      { key: 'call-center', label: 'Call Center', icon: Headphones },
      { key: 'receptionist-interest', label: 'Receptionist Interest', icon: PhoneIncoming, badgeKey: 'receptionistInterest' },
    ],
  },
  {
    section: 'Work',
    items: [
      { key: 'sites', label: 'Clients & Sites', icon: Globe, badgeKey: 'sites' },
      { key: 'docs', label: 'Docs', icon: Library },
      { key: 'playbook', label: 'Playbook', icon: BookOpen },
    ],
  },
];

const PAGE_TITLES: Record<Tab, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Pipeline KPIs and action queue' },
  research: { title: 'Research', subtitle: 'Keyword demand and map pack ownership per market' },
  'email-outreach': { title: 'Email Outreach', subtitle: 'Build-first email queue and follow-up board' },
  'call-center': { title: 'Call Center', subtitle: 'Select a company and run the call execution playbook' },
  'receptionist-interest': { title: 'Receptionist Interest', subtitle: 'Website declines who expressed interest in an automated receptionist' },
  pipeline: { title: 'Lead Pipeline', subtitle: 'Enrich, qualify, and convert signed leads' },
  'archived-leads': { title: 'Archived Leads', subtitle: 'Closed prospects, site cleanup, notes, and reactivation' },
  'automated-pipeline': { title: 'Text Outreach', subtitle: 'Text + site outreach — work your way down the queue' },
  builder: { title: 'Builder Employee', subtitle: 'Bulk LandingSite.ai website production' },
  prospect: { title: 'Lead Finder', subtitle: 'Search Google Places for new leads' },
  sites: { title: 'Clients & Sites', subtitle: 'Projects, briefs, and live sites' },
  docs: { title: 'Docs', subtitle: 'Agency wiki and operating checklists' },
  playbook: { title: 'Playbook', subtitle: 'Scripts, objections, and follow-ups' },
  settings: { title: 'Settings', subtitle: 'Workspace preferences, integrations, and system health' },
};

function Sidebar({
  active,
  onNavigate,
  badges,
  onClose,
  collapsed,
  profile,
  onSignOut,
}: {
  active: Tab;
  onNavigate: (t: Tab) => void;
  badges: NavBadges;
  onClose?: () => void;
  /** Icon-only rail mode (desktop collapse). The mobile drawer always
   *  renders expanded. */
  collapsed?: boolean;
  profile: AgencySettings['general'];
  onSignOut: () => void;
}) {
  const [userOpen, setUserOpen] = useState(false);
  return (
    <div
      className={`flex h-full flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${
        collapsed ? 'w-[68px]' : 'w-64'
      }`}
    >
      {/* Brand */}
      <div className={`flex items-center gap-2.5 py-5 ${collapsed ? 'justify-center px-0' : 'px-5'}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm shadow-blue-600/30">
          <span className="text-sm font-bold text-white">A</span>
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-slate-900">Agency OS</div>
            <div className="text-[11px] text-slate-400">{profile.agencyName}</div>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto py-2 ${collapsed ? 'px-2.5' : 'px-3'}`}>
        {NAV.map((group) => (
          <div key={group.section} className="mb-5">
            {collapsed ? (
              <div className="mx-2 mb-2 border-t border-slate-100" />
            ) : (
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {group.section}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.key;
                const badge = item.badgeKey ? badges[item.badgeKey] : null;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      onNavigate(item.key);
                      onClose?.();
                    }}
                    title={collapsed ? item.label : undefined}
                    className={`flex w-full items-center rounded-xl py-2 text-sm font-medium transition ${
                      collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'
                    } ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span className="relative flex shrink-0 items-center justify-center">
                      <Icon
                        className={`h-4 w-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`}
                      />
                      {/* Collapsed rail: badge becomes a mini count pinned to
                          the icon corner so the number survives the collapse. */}
                      {collapsed && badge ? (
                        <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white">
                          {badge}
                        </span>
                      ) : null}
                    </span>
                    {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                    {!collapsed && badge ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                          isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer / user */}
      <div className={`relative border-t border-slate-100 ${collapsed ? 'p-2.5' : 'p-3'}`}>
        <button
          onClick={() => { onNavigate('settings'); onClose?.(); }}
          title={collapsed ? 'Settings' : undefined}
          className={`mb-1 flex w-full items-center rounded-xl py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 ${
            collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'
          }`}
        >
          <Settings className="h-4 w-4 shrink-0 text-slate-400" />
          {!collapsed && 'Settings'}
        </button>
        <button
          onClick={() => setUserOpen((v) => !v)}
          className={`flex items-center rounded-xl py-2 ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'}`}
          title={collapsed ? profile.operatorName : undefined}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-xs font-semibold text-white">
            {profile.initials || 'SG'}
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium text-slate-800">{profile.operatorName}</div>
              <div className="truncate text-[11px] text-slate-400">{profile.operatorEmail}</div>
            </div>
          )}
        </button>
        {userOpen && (
          <div className={`absolute bottom-3 z-50 rounded-xl border border-slate-200 bg-white p-2 shadow-xl ${collapsed ? 'left-[76px] w-56' : 'left-3 w-[232px]'}`}>
            <button onClick={() => { onNavigate('settings'); setUserOpen(false); onClose?.(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"><UserRound className="h-4 w-4 text-slate-400" />Profile & preferences</button>
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-slate-500"><Keyboard className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span>Call Center: 1–4 outcomes, S skip, Esc close</span></div>
            <div className="my-1 border-t border-slate-100" />
            <button onClick={onSignOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        )}
      </div>
    </div>
  );
}

interface AppShellProps {
  active: Tab;
  onNavigate: (t: Tab) => void;
  badges: NavBadges;
  /** Optional contextual stats rendered on the right side of the top bar
   *  (e.g. clients count + MRR, previously in the dark header). */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  profile: AgencySettings['general'];
}

const COLLAPSE_KEY = 'agency-os-sidebar-collapsed';

export function AppShell({ active, onNavigate, badges, headerExtra, profile, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  // Desktop rail collapse — persisted so the operator's preference survives
  // reloads. The mobile drawer ignores it (always expanded).
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };
  const pageMeta = PAGE_TITLES[active];
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await endAccessSession();
    } finally {
      // An already-expired cookie returns Cloudflare's "No Access cookie"
      // response, which is still a successful signed-out state for our UI.
      setSignedOut(true);
      setSigningOut(false);
    }
  };

  return (
    <div className="flex h-[100dvh] bg-slate-50">
      {signedOut && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-50 px-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <LogOut className="h-5 w-5" />
            </div>
            <h1 className="mt-5 text-xl font-semibold text-slate-900">You’re signed out</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Your secure Agency OS session has ended on this device.
            </p>
            <button
              onClick={signBackIn}
              className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Sign back in
            </button>
          </div>
        </div>
      )}
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar active={active} onNavigate={onNavigate} badges={badges} collapsed={collapsed} profile={profile} onSignOut={handleSignOut} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar
              active={active}
              onNavigate={onNavigate}
              badges={badges}
              onClose={() => setMobileOpen(false)}
              profile={profile}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* Desktop-only collapse toggle — same slot the mobile hamburger
              occupies below lg. */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:block"
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
          <div className="flex-1">
            <h1 className="text-[17px] font-bold text-slate-900">{pageMeta.title}</h1>
            <p className="hidden text-xs text-slate-400 sm:block">{pageMeta.subtitle}</p>
          </div>
          {headerExtra}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
