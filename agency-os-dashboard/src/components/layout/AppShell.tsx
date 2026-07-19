import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  PhoneCall,
  Globe,
  BookOpen,
  Settings,
  Search as SearchIcon,
  Menu,
  X,
  BarChart3,
  MessageSquareText,
} from 'lucide-react';
import type { Tab } from '../../lib/types';

// ---------------------------------------------------------------------------
// App shell — sidebar navigation layout (visual spec: mockups/AppShell.jsx).
// Slate-50 canvas, white sidebar with right border, blue→indigo gradient as
// the single accent. Pages render in the <main> slot. Below lg the sidebar
// collapses to a hamburger + overlay drawer.
// ---------------------------------------------------------------------------

export interface NavBadges {
  coldCallPipeline?: number | null;
  automatedPipeline?: number | null;
  sites?: number | null;
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
      { key: 'call-sessions', label: 'Call Sessions', icon: PhoneCall },
      { key: 'pipeline', label: 'Cold Call Pipeline', icon: Users, badgeKey: 'coldCallPipeline' },
      { key: 'automated-pipeline', label: 'Automated Pipeline', icon: MessageSquareText, badgeKey: 'automatedPipeline' },
      { key: 'prospect', label: 'Lead Finder', icon: SearchIcon },
    ],
  },
  {
    section: 'Work',
    items: [
      { key: 'sites', label: 'Clients & Sites', icon: Globe, badgeKey: 'sites' },
      { key: 'playbook', label: 'Playbook', icon: BookOpen },
      { key: 'reports', label: 'Reports', icon: BarChart3 },
    ],
  },
];

const PAGE_TITLES: Record<Tab, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: "Today's calling snapshot" },
  'call-sessions': { title: 'Call Sessions', subtitle: 'Past, present, and upcoming sessions' },
  pipeline: { title: 'Cold Call Pipeline', subtitle: 'Enrich, qualify, and book demos' },
  'automated-pipeline': { title: 'Automated Pipeline', subtitle: 'Text + site outreach — work your way down the queue' },
  prospect: { title: 'Lead Finder', subtitle: 'Search Google Places for new leads' },
  sites: { title: 'Clients & Sites', subtitle: 'Projects, briefs, and live sites' },
  playbook: { title: 'Playbook', subtitle: 'Scripts, objections, and follow-ups' },
  reports: { title: 'Reports', subtitle: 'Monthly client reporting' },
};

function Sidebar({
  active,
  onNavigate,
  badges,
  onClose,
}: {
  active: Tab;
  onNavigate: (t: Tab) => void;
  badges: NavBadges;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full w-64 flex-col border-r border-slate-200 bg-white">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm shadow-blue-600/30">
          <span className="text-sm font-bold text-white">A</span>
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-slate-900">Agency OS</div>
          <div className="text-[11px] text-slate-400">Shaun Carl Designs</div>
        </div>
        <button
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {NAV.map((group) => (
          <div key={group.section} className="mb-5">
            <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {group.section}
            </div>
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
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`}
                    />
                    <span className="flex-1 text-left">{item.label}</span>
                    {badge ? (
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
      <div className="border-t border-slate-100 p-3">
        <button className="mb-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <Settings className="h-4 w-4 text-slate-400" />
          Settings
        </button>
        <div className="flex items-center gap-2.5 rounded-xl px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-xs font-semibold text-white">
            SG
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium text-slate-800">Shaun Gehrke</div>
            <div className="truncate text-[11px] text-slate-400">info@shauncarldesigns.com</div>
          </div>
        </div>
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
}

export function AppShell({ active, onNavigate, badges, headerExtra, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageMeta = PAGE_TITLES[active];

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar active={active} onNavigate={onNavigate} badges={badges} />
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
