import { useState } from 'react';
import {
  Phone,
  MapPin,
  Clock,
  Sparkles,
  Search,
  ChevronRight,
  CheckCircle2,
  Link2,
  X,
  Copy,
  Check,
  ExternalLink,
  Star,
  Globe,
  Send,
  Eye,
  MousePointerClick,
  PhoneCall,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Automated Pipeline — text + site outreach queue.
//
// Phase 1: renders against the sample data below inside a `.pipeline-scope`
// wrapper so it stays visually isolated from the dark app theme.
// Phase 2 swaps sample data for `/api/pipeline/leads` fetches and wires up
// mutations. Phase 3 folds this page into the new light-mode sidebar shell.
//
// Visual spec: mockups/LeadPipelinePage.jsx (canonical). Do NOT restyle.
// ---------------------------------------------------------------------------

export type PipelineStatus =
  | 'awaiting_build'
  | 'ready_to_send'
  | 'sent_no_reply'
  | 'engaged';

interface StatusConfig {
  label: string;
  chipBg: string;
  chipText: string;
  chipBorder: string;
  icon: LucideIcon;
  iconBg: string;
  action: string;
}

const STATUS_CONFIG: Record<PipelineStatus, StatusConfig> = {
  awaiting_build: {
    label: 'No website — brief ready',
    chipBg: 'bg-blue-50',
    chipText: 'text-blue-700',
    chipBorder: 'border-blue-100',
    icon: Sparkles,
    iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
    action: 'Copy brief',
  },
  ready_to_send: {
    label: 'Site is live — ready to send',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
    chipBorder: 'border-emerald-100',
    icon: CheckCircle2,
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    action: 'Send text',
  },
  sent_no_reply: {
    label: 'Sent — no reply yet',
    chipBg: 'bg-slate-50',
    chipText: 'text-slate-600',
    chipBorder: 'border-slate-200',
    icon: Clock,
    iconBg: 'bg-gradient-to-br from-slate-400 to-slate-500',
    action: 'Follow up',
  },
  engaged: {
    label: 'Engaged — visited the site',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
    chipBorder: 'border-amber-100',
    icon: Sparkles,
    iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
    action: 'Call now',
  },
};

const AVATAR_COLORS = [
  'from-teal-400 to-emerald-500',
  'from-rose-400 to-red-500',
  'from-blue-400 to-indigo-500',
  'from-violet-400 to-purple-500',
];

// Local shape kept intentionally decoupled from the D1 `Lead` type — the
// Phase 2 fetch layer will map D1 rows into this shape so the presentation
// components stay stable across the schema.
export interface PipelineLead {
  id: number;
  name: string;
  category: string;
  rating: number;
  reviews: number;
  phone: string;
  address: string;
  hours: string;
  status: PipelineStatus;
  sessions: number;
  ownerFirst: string;
  lastAction: string;
  initials: string;
  url: string | null;
  brief: string | null;
}

const INITIAL_LEADS: PipelineLead[] = [
  {
    id: 1,
    name: 'Marcy Ave Barber Co.',
    category: 'Barber Shop',
    rating: 4.9,
    reviews: 22,
    phone: '+1 347-379-6681',
    address: '828 Marcy Ave, Brooklyn, NY 11216',
    hours: 'Closed · Opens 10 AM tomorrow',
    status: 'awaiting_build',
    sessions: 0,
    ownerFirst: 'there',
    lastAction: 'Enriched 2 hrs ago',
    initials: 'MB',
    url: null,
    brief:
      'MASTER BRIEF — Marcy Ave Barber Co.\n\n' +
      'Business type: Barber Shop, Brooklyn NY\n' +
      'Rating: 4.9 stars (22 reviews)\n\n' +
      'TARGET AUDIENCE\n' +
      'Local men aged 20-45 looking for a reliable, walk-in-friendly barber ' +
      'in the Bed-Stuy / Crown Heights area. Price-conscious but loyal once ' +
      'they find a barber they trust.\n\n' +
      'PAGE PURPOSE\n' +
      'Convert a Google search or text-link click into a booked appointment ' +
      'or phone call. This is a first-impression site — visitor has likely ' +
      'never seen this business online before.\n\n' +
      'WHAT MUST APPEAR\n' +
      '- Business name, phone number (click-to-call), and address above the fold\n' +
      '- Hours of operation\n' +
      '- Review highlight (4.9 stars, 22 reviews) near the top\n' +
      '- Services list: haircuts, fades, beard trim, lineup\n' +
      '- A clear "Call Now" or "Book" CTA repeated at least twice\n\n' +
      'WHAT TO EMPHASIZE\n' +
      'Trust and legitimacy — this business has no site today, so the goal ' +
      'is to look established and professional immediately, not flashy.\n\n' +
      'CONSTRAINTS\n' +
      "No fabricated testimonials beyond what's in the review data. Keep " +
      'copy tight — this audience does not want to read, they want to call.',
  },
  {
    id: 2,
    name: 'Harlyn Barber Shop',
    category: 'Barber Shop',
    rating: 4.8,
    reviews: 52,
    phone: '+1 347-365-5780',
    address: '742 Washington Ave, Brooklyn, NY 11238',
    hours: 'Closed · Opens 8:30 AM tomorrow',
    status: 'ready_to_send',
    sessions: 0,
    ownerFirst: 'there',
    lastAction: 'Built yesterday',
    initials: 'HB',
    url: 'https://harlynbarbershop.landingsite.ai?utm_source=sms&utm_medium=text&utm_campaign=harlyn-barber-shop',
    brief: null,
  },
  {
    id: 3,
    name: 'Eight Nine Dominican Barbershop',
    category: 'Barber Shop',
    rating: 4.7,
    reviews: 40,
    phone: '+1 929-234-3141',
    address: '1043 Nostrand Ave, Brooklyn, NY 11225',
    hours: 'Closed · Opens 8:30 AM tomorrow',
    status: 'sent_no_reply',
    sessions: 0,
    ownerFirst: 'there',
    lastAction: 'Sent 3 days ago',
    initials: 'EN',
    url: 'https://eightninedominican.landingsite.ai?utm_source=sms&utm_medium=text&utm_campaign=eight-nine-dominican',
    brief: null,
  },
  {
    id: 4,
    name: 'Yehuda Barber Shop',
    category: 'Barber Shop',
    rating: 4.6,
    reviews: 109,
    phone: '+1 718-314-2093',
    address: '1306 Nostrand Ave, Brooklyn, NY 11225',
    hours: 'Open now · Closes 8 PM',
    status: 'engaged',
    sessions: 4,
    ownerFirst: 'there',
    lastAction: 'Visited 6 hrs ago',
    initials: 'YB',
    url: 'https://yehudabarbershop.landingsite.ai?utm_source=sms&utm_medium=text&utm_campaign=yehuda-barber-shop',
    brief: null,
  },
];

const PRICING_URL = 'https://shauncarldesigns.com/pricing';

// `sms:` deep link — opens the phone's Messages app with recipient + body
// prefilled. `?&body=` is the variant most broadly honored across iOS
// and Android; body prefill is inconsistent across versions so a Copy
// fallback ships alongside every composer.
function smsLink(phone: string, body: string): string {
  const num = phone.replace(/[^\d+]/g, '');
  return `sms:${num}?&body=${encodeURIComponent(body)}`;
}

// ---------- Shared bits ----------

function EngagementDot({ sessions }: { sessions: number }) {
  if (sessions === 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        No visits
      </span>
    );
  }
  const color = sessions >= 3 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {sessions} session{sessions === 1 ? '' : 's'}
    </span>
  );
}

interface ModalShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function ModalShell({ title, subtitle, onClose, children, footer }: ModalShellProps) {
  // z-[200] beats the dark app's sticky header/nav (z:100 from global.css).
  // Phase 3 removes global.css and this can revert to z-50.
  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[90vh] rounded-t-2xl sm:rounded-2xl bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
        {footer && <div className="border-t border-slate-100 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Card ----------

function StatusChip({ lead, onAction }: { lead: PipelineLead; onAction: (l: PipelineLead) => void }) {
  const cfg = STATUS_CONFIG[lead.status];
  const Icon = cfg.icon;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border ${cfg.chipBorder} ${cfg.chipBg} px-3 py-2.5`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${cfg.iconBg}`}
        >
          <Icon className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
        </span>
        <span className={`text-sm font-medium truncate ${cfg.chipText}`}>{cfg.label}</span>
      </div>
      <button
        onClick={() => onAction(lead)}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20 transition hover:shadow-md hover:shadow-blue-600/30 active:scale-[0.98]"
      >
        {cfg.action}
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

interface LeadCardProps {
  lead: PipelineLead;
  index: number;
  onAction: (l: PipelineLead) => void;
  onViewLead: (l: PipelineLead) => void;
}

function LeadCard({ lead, index, onAction, onViewLead }: LeadCardProps) {
  const avatarColor = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60 transition hover:shadow-md hover:shadow-slate-200/80">
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${avatarColor} text-sm font-semibold text-white shadow-sm`}
          >
            {lead.initials}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold text-slate-900">{lead.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
              <span>{lead.category}</span>
              <span className="text-slate-300">·</span>
              <span className="flex items-center gap-1 text-amber-500 font-medium">
                ★ {lead.rating}
                <span className="text-slate-400 font-normal">({lead.reviews})</span>
              </span>
            </div>
          </div>
          <EngagementDot sessions={lead.sessions} />
        </div>
      </div>

      <div className="px-4 pb-3">
        <StatusChip lead={lead} onAction={onAction} />
      </div>

      <div className="space-y-2 px-4 pb-3 text-sm text-slate-600">
        <div className="flex items-center gap-2">
          <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>{lead.phone}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{lead.address}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>{lead.hours}</span>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
        <span className="text-xs text-slate-400">{lead.lastAction}</span>
        <button
          onClick={() => onViewLead(lead)}
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          View lead
          <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ---------- Brief modal (awaiting_build) ----------

function BriefModal({
  lead,
  onClose,
  onSaveUrl,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onSaveUrl: (leadId: number, url: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [saved, setSaved] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(lead.brief ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleSave = () => {
    if (!urlInput.trim()) return;
    onSaveUrl(lead.id, urlInput.trim());
    setSaved(true);
    setTimeout(() => onClose(), 700);
  };

  return (
    <ModalShell
      title="Site brief"
      subtitle={lead.name}
      onClose={onClose}
      footer={
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Live site URL</label>
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://yourbusiness.landingsite.ai"
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={handleSave}
              disabled={!urlInput.trim()}
              className="shrink-0 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20 disabled:opacity-40 disabled:shadow-none"
            >
              {saved ? <Check className="h-4 w-4" /> : 'Save'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Saving auto-tags the link with UTM + Clarity tracking and moves this lead to "Ready to
            send."
          </p>
        </div>
      }
    >
      <div className="px-5 py-4">
        <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-100 p-4 text-[13px] leading-relaxed text-slate-700 font-sans">
          {lead.brief}
        </pre>
        <button
          onClick={handleCopy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-emerald-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy brief to clipboard
            </>
          )}
        </button>
        <p className="mt-3 text-xs text-slate-400">
          Paste this into landingsite.ai to build the site. Once it's live, drop the URL below —
          this tags it for tracking and unlocks the text to send.
        </p>
      </div>
    </ModalShell>
  );
}

// ---------- Text composer (ready_to_send) ----------

function TextComposerModal({
  lead,
  onClose,
  onSent,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onSent: (leadId: number) => void;
}) {
  const defaultMsg =
    `Hey ${lead.ownerFirst}, this is Shaun — I put together a homepage for ` +
    `${lead.name}, no charge, just wanted you to see it: ${lead.url}\n\n` +
    `Take a look when you get a sec, curious what you think.`;

  const [msg, setMsg] = useState(defaultMsg);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <ModalShell
      title="Send intro text"
      subtitle={`${lead.name} · ${lead.phone}`}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-500" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy
              </>
            )}
          </button>
          <a
            href={smsLink(lead.phone, msg)}
            onClick={() => onSent(lead.id)}
            className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
          >
            <Send className="h-4 w-4" />
            Open in Messages
          </a>
        </div>
      }
    >
      <div className="px-5 py-4">
        <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <span className="font-semibold">Text 1 — the reveal.</span> No pricing, no ask. It should
          feel like a gift so they click. Pricing goes in the follow-up.
        </div>

        <label className="mb-1.5 block text-xs font-medium text-slate-500">Message</label>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={7}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Tracked link included</p>
            <p className="truncate text-[11px] text-slate-400">{lead.url}</p>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-slate-400">
          "Open in Messages" launches your texting app with this message and number prefilled — you
          review and hit send from your own phone.
        </p>
      </div>
    </ModalShell>
  );
}

// ---------- Follow-up composer (sent_no_reply / engaged) ----------

function FollowUpModal({
  lead,
  onClose,
  onSent,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onSent: (leadId: number) => void;
}) {
  const engaged = lead.sessions > 0;

  const variantWarm =
    `Hey ${lead.ownerFirst}, saw you had a chance to check out the site — ` +
    `if you like the direction, here's what it'd cost to make it live and ` +
    `keep it maintained: ${PRICING_URL}\n\nNo pressure either way.`;
  const variantCold =
    `Hey ${lead.ownerFirst}, following up on that homepage I sent for ` +
    `${lead.name}. If you like it, here's what it'd cost to make it live: ` +
    `${PRICING_URL}\n\nAnd if it's not the right time, no worries at all — ` +
    `just let me know.`;

  const [msg, setMsg] = useState(engaged ? variantWarm : variantCold);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <ModalShell
      title="Follow-up text"
      subtitle={`${lead.name} · ${lead.phone}`}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-500" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy
              </>
            )}
          </button>
          <a
            href={smsLink(lead.phone, msg)}
            onClick={() => onSent(lead.id)}
            className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
          >
            <Send className="h-4 w-4" />
            Open in Messages
          </a>
        </div>
      }
    >
      <div className="px-5 py-4">
        <div
          className={`mb-3 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs ${
            engaged
              ? 'border-amber-100 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          {engaged ? (
            <>
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-semibold">
                  {lead.sessions} site visit{lead.sessions === 1 ? '' : 's'}
                </span>{' '}
                — this is a warm lead. Lead with the pricing, they've already seen the work.
              </span>
            </>
          ) : (
            <>
              <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-semibold">No visits yet.</span> Softer re-touch — remind them
                the site exists before pushing price.
              </span>
            </>
          )}
        </div>

        <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <span className="font-semibold">Text 2 — the pricing.</span> This is where the pricing
          link goes. Keep the "not-right-now" door open.
        </div>

        <label className="mb-1.5 block text-xs font-medium text-slate-500">Message</label>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={7}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Pricing link</p>
            <p className="truncate text-[11px] text-slate-400">{PRICING_URL}</p>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------- Call prep (engaged) ----------

function CallPrepModal({
  lead,
  onClose,
  onLogged,
}: {
  lead: PipelineLead;
  onClose: () => void;
  onLogged: (leadId: number) => void;
}) {
  return (
    <ModalShell
      title="Call prep"
      subtitle={lead.name}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <a
            href={`tel:${lead.phone}`}
            className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
          >
            <PhoneCall className="h-4 w-4" />
            Call {lead.phone}
          </a>
          <button
            onClick={() => onLogged(lead.id)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Log call
          </button>
        </div>
      }
    >
      <div className="px-5 py-4">
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span>
            Warm lead — visited the site{' '}
            <span className="font-semibold">
              {lead.sessions} time{lead.sessions === 1 ? '' : 's'}
            </span>
            . Open on that.
          </span>
        </div>

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Suggested opener
        </h4>
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm leading-relaxed text-slate-700">
          "Hey, is this the owner of {lead.name}? This is Shaun — I actually built you a homepage
          and texted it over, and I saw you took a look at it. Wanted to see what you thought?"
        </div>

        <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
          On the call
        </h4>
        <ul className="space-y-1.5 text-sm text-slate-600">
          <li className="flex gap-2">
            <span className="text-slate-300">·</span>They've seen it — skip the pitch, ask what
            they'd change
          </li>
          <li className="flex gap-2">
            <span className="text-slate-300">·</span>Walk them to pricing: build vs. build +
            maintain
          </li>
          <li className="flex gap-2">
            <span className="text-slate-300">·</span>Assumed close — "want me to make it live?"
          </li>
        </ul>
      </div>
    </ModalShell>
  );
}

// ---------- Lead detail ----------

function LeadDetailModal({ lead, onClose }: { lead: PipelineLead; onClose: () => void }) {
  const cfg = STATUS_CONFIG[lead.status];
  return (
    <ModalShell title="Lead details" onClose={onClose}>
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 text-sm font-semibold text-white">
            {lead.initials}
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">{lead.name}</h3>
            <div className="flex items-center gap-1.5 text-sm text-slate-500">
              <span>{lead.category}</span>
              <span className="text-slate-300">·</span>
              <span className="flex items-center gap-1 text-amber-500 font-medium">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {lead.rating}
                <span className="text-slate-400 font-normal">({lead.reviews})</span>
              </span>
            </div>
          </div>
        </div>

        <div
          className={`mt-4 rounded-xl border ${cfg.chipBorder} ${cfg.chipBg} px-3 py-2.5 text-sm font-medium ${cfg.chipText}`}
        >
          {cfg.label}
        </div>

        <div className="mt-4 space-y-3 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 shrink-0 text-slate-400" />
            <a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">
              {lead.phone}
            </a>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
            <span>{lead.address}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-slate-400" />
            <span>{lead.hours}</span>
          </div>
          {lead.url && (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 shrink-0 text-slate-400" />
              <a
                href={lead.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-blue-600 hover:underline truncate"
              >
                {lead.url.replace('https://', '').split('?')[0]}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Activity
          </h4>
          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>Last action</span>
              <span className="font-medium text-slate-700">{lead.lastAction}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Site sessions</span>
              <span className="font-medium text-slate-700">{lead.sessions}</span>
            </div>
          </div>
        </div>

        {lead.url && (
          <a
            href={lead.url}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-600/20"
          >
            View live site
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </ModalShell>
  );
}

// ---------- Page ----------

type FilterKey = 'all' | PipelineStatus;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_build', label: 'Awaiting build' },
  { key: 'ready_to_send', label: 'Ready to send' },
  { key: 'sent_no_reply', label: 'Sent — no reply' },
  { key: 'engaged', label: 'Engaged' },
];

type ModalType = 'brief' | 'text' | 'followup' | 'call' | 'detail';
type ModalState = { type: ModalType; lead: PipelineLead } | null;

const STATUS_TO_MODAL: Record<PipelineStatus, ModalType> = {
  awaiting_build: 'brief',
  ready_to_send: 'text',
  sent_no_reply: 'followup',
  engaged: 'call',
};

export default function AutomatedPipelinePanel() {
  const [leads, setLeads] = useState<PipelineLead[]>(INITIAL_LEADS);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  const openFor = (lead: PipelineLead) => {
    setModal({ type: STATUS_TO_MODAL[lead.status], lead });
  };

  const handleSaveUrl = (leadId: number, url: string) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? {
              ...l,
              url: `${url}?utm_source=sms&utm_medium=text&utm_campaign=${encodeURIComponent(
                l.name.toLowerCase().replace(/\s+/g, '-'),
              )}`,
              status: 'ready_to_send',
              lastAction: 'Built just now',
              brief: null,
            }
          : l,
      ),
    );
  };

  const markSent = (leadId: number) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId ? { ...l, status: 'sent_no_reply', lastAction: 'Sent just now' } : l,
      ),
    );
    setModal(null);
  };

  const markFollowedUp = (leadId: number) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, lastAction: 'Followed up just now' } : l)),
    );
    setModal(null);
  };

  const logCall = (leadId: number) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, lastAction: 'Called just now' } : l)),
    );
    setModal(null);
  };

  const filtered = leads.filter((l) => {
    const matchesFilter = filter === 'all' || l.status === filter;
    const matchesQuery = l.name.toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  });

  const counts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="pipeline-scope min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-slate-900">Automated Pipeline</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Text + site outreach — work your way down the queue
          </p>
        </div>

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 shadow-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                filter === f.key
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {f.label}
              {f.key !== 'all' && counts[f.key] ? (
                <span
                  className={`ml-1.5 ${filter === f.key ? 'text-slate-300' : 'text-slate-400'}`}
                >
                  {counts[f.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map((lead, i) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              index={i}
              onAction={openFor}
              onViewLead={(l) => setModal({ type: 'detail', lead: l })}
            />
          ))}
          {filtered.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-10 text-center text-sm text-slate-400">
              No leads match this filter.
            </div>
          )}
        </div>
      </div>

      {modal?.type === 'brief' && (
        <BriefModal lead={modal.lead} onClose={() => setModal(null)} onSaveUrl={handleSaveUrl} />
      )}
      {modal?.type === 'text' && (
        <TextComposerModal lead={modal.lead} onClose={() => setModal(null)} onSent={markSent} />
      )}
      {modal?.type === 'followup' && (
        <FollowUpModal
          lead={modal.lead}
          onClose={() => setModal(null)}
          onSent={markFollowedUp}
        />
      )}
      {modal?.type === 'call' && (
        <CallPrepModal lead={modal.lead} onClose={() => setModal(null)} onLogged={logCall} />
      )}
      {modal?.type === 'detail' && (
        <LeadDetailModal lead={modal.lead} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
