import { useEffect, useState } from 'react';
import { BookOpen, FileText, Home, Lightbulb, LineChart, Plus, Settings as Gear } from 'lucide-react';
import { LogSheet } from './components/LogSheet';
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

const NAV: { route: Route; label: string; Icon: typeof Home }[] = [
  { route: 'today', label: 'Today', Icon: Home },
  { route: 'trends', label: 'Trends', Icon: LineChart },
  { route: 'journal', label: 'Journal', Icon: BookOpen },
  { route: 'insights', label: 'Insights', Icon: Lightbulb },
  { route: 'report', label: 'Report', Icon: FileText },
  { route: 'settings', label: 'Settings', Icon: Gear }
];

const TITLES: Record<Route, string> = {
  today: 'Today',
  trends: 'Trends',
  journal: 'Journal',
  insights: 'Insights',
  report: 'Report',
  settings: 'Settings'
};

export function App() {
  const { ready, settings, route, go, openLog, logRequest, toast, notify } = useApp();
  const [update, setUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    void registerServiceWorker((apply) => setUpdate(() => apply));
  }, []);

  useEffect(() => {
    if (update) notify('A new version of Vitalis is ready', { label: 'Reload', run: update });
  }, [update, notify]);

  useEffect(() => {
    document.title = route === 'today' ? 'Vitalis' : `${TITLES[route]} - Vitalis`;
  }, [route]);

  if (!ready) return null;
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
      <nav className="rail" aria-label="Main">
        <a className="wordmark" {...link('today')} aria-current={undefined}>
          <Logo /> Vitalis
        </a>
        {NAV.map(({ route: r, label, Icon }) => (
          <a key={r} className="rail-link" {...link(r)}>
            <Icon size={19} /> {label}
          </a>
        ))}
        <button className="btn btn-primary" onClick={() => openLog()}>
          <Plus size={18} /> Log a reading
        </button>
        <p className="rail-foot">Stored on this device only. Not medical advice.</p>
      </nav>

      <div>
        <header className="topbar">
          <a className="wordmark" {...link('today')} aria-current={undefined}>
            <Logo size={26} /> {route === 'today' ? 'Vitalis' : TITLES[route]}
          </a>
          <a className="icon-btn" {...link('report')} aria-label="Report for your doctor">
            <FileText size={20} />
          </a>
          <a className="icon-btn" {...link('settings')} aria-label="Settings">
            <Gear size={20} />
          </a>
        </header>

        <main className="main" id="main">
          {screen}
        </main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {NAV.slice(0, 2).map(({ route: r, label, Icon }) => (
          <a key={r} className="tab" {...link(r)}>
            <Icon size={22} /> {label}
          </a>
        ))}
        <button className="tab-log" onClick={() => openLog()} aria-label="Log a reading">
          <Plus size={28} />
        </button>
        {NAV.slice(2, 4).map(({ route: r, label, Icon }) => (
          <a key={r} className="tab" {...link(r)}>
            <Icon size={22} /> {label}
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
