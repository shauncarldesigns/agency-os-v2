import { ArrowRight, ArrowUpRight, AudioLines, Globe, Layers3, Monitor, ShoppingBag, Sparkles, Users } from 'lucide-react';

const ventures = [
  { name: 'Signalhouse', category: 'Content & media', description: 'Your YouTube production workspace. Plan channels and turn ideas into videos.', detail: 'YouTube Builder', status: 'Local', icon: AudioLines, detailIcon: AudioLines, href: 'signalhouse://open', action: 'Open Signalhouse', note: 'Starts your local server and opens Signalhouse. Requires the Mac launcher.', local: true, upcoming: false },
  { name: 'Lead Engine', category: 'Agency & growth', description: 'Find opportunities, connect with prospects, and build websites that turn leads into clients.', detail: 'Lead generation & website building', status: 'Available', icon: Users, detailIcon: Globe, href: '#/lead-engine/dashboard', action: 'Open Lead Engine', note: 'Your agency tools, pipeline, and client work in one workspace.', local: false, upcoming: false },
  { name: 'AI Dropshipping', category: 'Commerce', description: 'A future workspace for your AI dropshipping business.', detail: 'The next opportunity', status: 'Coming soon', icon: ShoppingBag, detailIcon: Sparkles, href: undefined, action: 'Coming soon', note: 'Not built yet. This space is ready for when it is.', local: false, upcoming: true },
];

export function BusinessHub() {
  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-10">
          <a href="#/" className="flex items-center gap-3" aria-label="Agency OS home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-600/20"><Layers3 className="h-5 w-5" /></span>
            <span className="text-base font-semibold tracking-tight">Agency OS</span>
          </a>
          <span className="text-xs font-medium text-slate-500">Business hub</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-12 pt-14 sm:px-10 sm:pt-20">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-blue-600"><span className="h-px w-7 bg-blue-600" />Your business portfolio</div>
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">One home.<br />Every opportunity.</h1>
        <p className="mt-5 max-w-xl text-sm leading-7 text-slate-500">Create content, grow your pipeline, and build what comes next. Choose a workspace to get to work.</p>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {ventures.map(venture => {
            const Icon = venture.icon;
            const DetailIcon = venture.detailIcon;
            return (
              <article key={venture.name} className={`flex flex-col rounded-2xl border p-6 sm:p-7 ${venture.upcoming ? 'border-dashed border-slate-300 bg-slate-100/50' : venture.local ? 'border-slate-200 bg-white shadow-sm' : 'border-blue-200 bg-white shadow-sm shadow-blue-100/40'}`}>
                <div className="flex items-center justify-between">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${venture.upcoming ? 'bg-white text-slate-400' : venture.local ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-blue-600'}`}><Icon className="h-6 w-6" /></span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${venture.upcoming ? 'border border-slate-200 bg-white text-slate-500' : venture.local ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                    {venture.local && <Monitor className="h-3 w-3" />}{!venture.local && !venture.upcoming && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{venture.status}
                  </span>
                </div>
                <p className="mt-7 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{venture.category}</p>
                <h2 className={`mt-2 text-xl font-semibold tracking-tight ${venture.upcoming ? 'text-slate-600' : ''}`}>{venture.name}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-500">{venture.description}</p>
                <div className="mb-7 mt-5 flex items-center gap-2 text-xs text-slate-400"><DetailIcon className="h-3.5 w-3.5 shrink-0" />{venture.detail}</div>
                <div className="mt-auto border-t border-slate-200/70 pt-5">
                  {venture.href ? (
                    <a href={venture.href} aria-label={venture.action} className={`flex items-center justify-between rounded-xl px-4 py-3 text-xs font-semibold text-white transition ${venture.local ? 'bg-slate-900 hover:bg-slate-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                      {venture.action}{venture.local ? <ArrowUpRight className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                    </a>
                  ) : <button disabled className="flex w-full cursor-not-allowed items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-400">Coming soon<ShoppingBag className="h-4 w-4" /></button>}
                  <p className="mt-3 text-[11px] leading-5 text-slate-500">{venture.note}</p>
                  {venture.local && <a href="http://127.0.0.1:3000" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[11px] text-slate-500 underline hover:text-slate-900">Already running? Open in browser</a>}
                </div>
              </article>
            );
          })}
        </div>
        <footer className="mt-10 flex items-center gap-2 border-t border-slate-200 pt-6 text-xs text-slate-400"><Layers3 className="h-3.5 w-3.5" />Agency OS<span className="mx-1 text-slate-300">/</span>Three ventures. One place to start.</footer>
      </main>
    </div>
  );
}
