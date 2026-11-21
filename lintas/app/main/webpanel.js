// Web panels: Gmail and Google Calendar docked in the side panel, like the sidebar apps in
// Opera and Edge. Each app keeps its own view, so switching between them keeps their state.
// They use the normal browsing profile: signing in to Gmail here signs in to Google in tabs too.
import { WebContentsView } from 'electron';
import { applySignInIdentity, guardNavigation } from './tabs.js';

export const WEB_APPS = [
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/mail/u/0/', icon: 'mail' },
  { id: 'calendar', name: 'Calendar', url: 'https://calendar.google.com/calendar/u/0/r', icon: 'calendar' },
];

export class WebPanels {
  constructor({ win, ses, tabs }) {
    this.win = win; this.ses = ses; this.tabs = tabs;
    this.views = new Map();   // app id -> WebContentsView
    this.shown = null;        // app id currently attached
    this.bounds = null;
    this.visible = true;      // false while an overlay in the browser interface covers the page area
    this.want = null;         // app the side panel is showing
  }

  view(id) {
    const app = WEB_APPS.find(a => a.id === id);
    if (!app) throw new Error('Unknown web panel.');
    let v = this.views.get(id);
    if (v && !v.webContents.isDestroyed()) return v;
    v = new WebContentsView({ webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: true, safeDialogs: true, navigateOnDragDrop: false } });
    const wc = v.webContents;
    applySignInIdentity(wc);
    guardNavigation(wc);
    // Popups (sign-in, attachments, "open in new window") follow the same rules as in tabs
    this.tabs.handleWindowOpen(wc, { private: false });
    wc.loadURL(app.url).catch(() => {});
    this.views.set(id, v);
    return v;
  }

  /** Shows app `id` at `bounds` (in window coordinates), or hides web panels when id is null. */
  show(id, bounds) {
    if (bounds) this.bounds = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(0, Math.round(bounds.width)), height: Math.max(0, Math.round(bounds.height)) };
    this.want = id && this.bounds && this.bounds.width > 0 && this.bounds.height > 0 ? id : null;
    this.apply();
    const v = this.want && this.views.get(this.want);
    return { id: this.want, url: v && !v.webContents.isDestroyed() ? v.webContents.getURL() : null };
  }

  setVisible(visible) { this.visible = !!visible; this.apply(); }

  apply() {
    const target = this.visible ? this.want : null;
    if (this.shown && this.shown !== target) { try { this.win.contentView.removeChildView(this.views.get(this.shown)); } catch {} this.shown = null; }
    if (!target) return;
    const v = this.view(target);
    if (this.shown !== target) { this.win.contentView.addChildView(v); this.shown = target; }
    v.setBounds(this.bounds);
  }

  reload(id) { const v = this.views.get(id); if (v && !v.webContents.isDestroyed()) v.webContents.reload(); }
  home(id) { const app = WEB_APPS.find(a => a.id === id); const v = this.views.get(id); if (app && v && !v.webContents.isDestroyed()) v.webContents.loadURL(app.url).catch(() => {}); }
  openInTab(id) { const v = this.views.get(id); const url = v && !v.webContents.isDestroyed() ? v.webContents.getURL() : WEB_APPS.find(a => a.id === id)?.url; if (url) this.tabs.create({ url, raw: true }); }
}
