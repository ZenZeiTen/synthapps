import { useEffect, useState } from 'react';
import { BookOpen, FileText, Home, Lightbulb, LineChart, Plus, Settings as Gear } from 'lucide-react';
import { LanguageToggle } from './components/LanguageToggle';
import { LogSheet } from './components/LogSheet';
import { t } from './i18n';
import { Logo } from './components/Visuals';
import { registerServiceWorker } from './pwa';
import { Insights } from './screens/Insights';
import { Journal } from './screens/Journal';
import { Report } from './screens/Report';
import { Settings } from './screens/Settings';
import { Today } from './screens/Today';
import { Trends } from './screens/Trends';
import { Welcome } from './screens/Welcome';
import { useApp, type Route } from './state';

const NAV: { route: Route; Icon: typeof Home }[] = [
  { route: 'today', Icon: Home },
  { route: 'trends', Icon: LineChart },
  { route: 'journal', Icon: BookOpen },
  { route: 'insights', Icon: Lightbulb },
  { route: 'report', Icon: FileText },
  { route: 'settings', Icon: Gear }
];

export function App() {
  const { ready, settings, lang, route, go, openLog, logRequest, toast, notify } = useApp();
  const [update, setUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    void registerServiceWorker((apply) => setUpdate(() => apply));
  }, []);

  useEffect(() => {
    if (update) notify(t().nav.updateReady, { label: t().nav.reload, run: update });
  }, [update, notify]);

  useEffect(() => {
    document.title = route === 'today' ? 'Vitalis' : `${t().nav[route]} - Vitalis`;
  }, [route, lang]);

  if (!ready) return null;
  const N = t().nav;
  if (!settings.acknowledged) return <Welcome />;

  const screen = {
    today: <Today />,
    trends: <Trends />,
    journal: <Journal />,
    insights: <Insights />,
    report: <Report />,
    settings: <Settings />
  }[route];

  const link = (r: Route) => ({
    href: `#/${r}`,
    'aria-current': route === r ? ('page' as const) : undefined,
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      go(r);
    }
  });

  return (
    <div className="shell">
      <nav className="rail" aria-label={t().common.mainNav}>
        <a className="wordmark" {...link('today')} aria-current={undefined}>
          <Logo /> Vitalis
        </a>
        {NAV.map(({ route: r, Icon }) => (
          <a key={r} className="rail-link" {...link(r)}>
            <Icon size={19} /> {N[r]}
          </a>
        ))}
        <button className="btn btn-primary" onClick={() => openLog()}>
          <Plus size={18} /> {N.logReading}
        </button>
        <LanguageToggle />
        <p className="rail-foot">{N.railFoot}</p>
      </nav>

      <div>
        <header className="topbar">
          <a className="wordmark" {...link('today')} aria-current={undefined}>
            <Logo size={26} /> {route === 'today' ? 'Vitalis' : N[route]}
          </a>
          <LanguageToggle />
          <a className="icon-btn" {...link('report')} aria-label={N.reportAria}>
            <FileText size={20} />
          </a>
          <a className="icon-btn" {...link('settings')} aria-label={N.settings}>
            <Gear size={20} />
          </a>
        </header>

        <main className="main" id="main">
          {screen}
        </main>
      </div>

      <nav className="tabbar" aria-label={t().common.mainNav}>
        {NAV.slice(0, 2).map(({ route: r, Icon }) => (
          <a key={r} className="tab" {...link(r)}>
            <Icon size={22} /> {N[r]}
          </a>
        ))}
        <button className="tab-log" onClick={() => openLog()} aria-label={N.logReading}>
          <Plus size={28} />
        </button>
        {NAV.slice(2, 4).map(({ route: r, Icon }) => (
          <a key={r} className="tab" {...link(r)}>
            <Icon size={22} /> {N[r]}
          </a>
        ))}
      </nav>

      {logRequest && <LogSheet key={logRequest.entry?.id ?? logRequest.metric ?? 'new'} />}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.text}
          {toast.action && (
            <button onClick={() => toast.action?.run()}>{toast.action.label}</button>
          )}
        </div>
      )}
    </div>
  );
}
