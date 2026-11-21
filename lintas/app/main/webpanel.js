// Pages docked in the side panel, beside the page:
// - web panels: Gmail and Google Calendar, like the sidebar apps in Opera and Edge. Each keeps its
//   own view, so switching between them keeps their state. They use the normal browsing profile:
//   signing in to Gmail here signs in to Google in tabs too;
// - Chrome extension side panels (chrome.sidePanel), keyed 'ext:tab:<tab>' or 'ext:win:<extension>'.
//   The Extensions class says what each loads (resolve) and hears when one closes itself (onGone).
import { WebContentsView } from 'electron';
import { applySignInIdentity, guardNavigation } from './tabs.js';

export const WEB_APPS = [
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/mail/u/0/', icon: 'mail' },
  { id: 'calendar', name: 'Calendar', url: 'https://calendar.google.com/calendar/u/0/r', icon: 'calendar' },
];

export class WebPanels {
  constructor({ win, ses, tabs, resolve, onGone, commandKey }) {
    this.commandKey = commandKey || (() => false);
    this.win = win; this.ses = ses; this.tabs = tabs;
    this.resolve = resolve || (() => null);
    this.onGone = onGone || (() => {});
    this.views = new Map();   // app id -> WebContentsView
    this.shown = null;        // app id currently attached
    this.bounds = null;
    this.visible = true;      // false while an overlay in the browser interface covers the page area
    this.want = null;         // app the side panel is showing
  }

  view(id) {
    let v = this.views.get(id);
    if (v && !v.webContents.isDestroyed()) return v;
    const app = WEB_APPS.find(a => a.id === id);
    const ext = app ? null : this.resolve(id);
    if (!app && !ext) throw new Error('Unknown web panel.');
    v = new WebContentsView({ webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: true, safeDialogs: true, navigateOnDragDrop: false } });
    const wc = v.webContents;
    if (app) applySignInIdentity(wc);
    guardNavigation(wc);
    // Popups (sign-in, attachments, "open in new window") follow the same rules as in tabs
    this.tabs.handleWindowOpen(wc, { private: false });
    // Extension shortcuts work while the panel has focus too (Claude's Ctrl+E closes its panel)
    wc.on('before-input-event', (e, input) => { if (this.commandKey(input)) e.preventDefault(); });
    // An extension's panel page may close itself (window.close()), which ends the panel.
    wc.once('destroyed', () => {
      if (this.views.get(id) !== v) return;
      this.views.delete(id);
      if (this.shown === id) { try { this.win.contentView.removeChildView(v); } catch {} this.shown = null; }
      if (this.want === id) this.want = null;
      if (!app) this.onGone(id);
    });
    wc.loadURL(app ? app.url : ext.url).catch(() => {});
    this.views.set(id, v);
    return v;
  }

  /** Loads another page in an open panel. */
  navigate(id, url) { const v = this.views.get(id); if (v && !v.webContents.isDestroyed()) v.webContents.loadURL(url).catch(() => {}); }

  /** Ends a panel's page. */
  drop(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    if (this.shown === id) { try { this.win.contentView.removeChildView(v); } catch {} this.shown = null; }
    if (this.want === id) this.want = null;
    if (!v.webContents.isDestroyed()) v.webContents.close();
  }

  /** Shows app `id` at `bounds` (in window coordinates), or hides web panels when id is null. */
  show(id, bounds) {
    if (bounds) this.bounds = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(0, Math.round(bounds.width)), height: Math.max(0, Math.round(bounds.height)) };
    const known = id && (WEB_APPS.some(a => a.id === id) || this.views.has(id) || this.resolve(id));
    this.want = known && this.bounds && this.bounds.width > 0 && this.bounds.height > 0 ? id : null;
    this.apply();
    const v = this.want && this.views.get(this.want);
    return { id: this.want, url: v && !v.webContents.isDestroyed() ? v.webContents.getURL() : null };
  }

  setVisible(visible) { this.visible = !!visible; this.apply(); }

  apply() {
    const target = this.visible ? this.want : null;
    if (this.shown && this.shown !== target) { const old = this.views.get(this.shown); if (old) try { this.win.contentView.removeChildView(old); } catch {} this.shown = null; }
    if (!target) return;
    const v = this.view(target);
    if (this.shown !== target) { this.win.contentView.addChildView(v); this.shown = target; }
    v.setBounds(this.bounds);
  }

  reload(id) { const v = this.views.get(id); if (v && !v.webContents.isDestroyed()) v.webContents.reload(); }
  home(id) { const app = WEB_APPS.find(a => a.id === id); const v = this.views.get(id); if (app && v && !v.webContents.isDestroyed()) v.webContents.loadURL(app.url).catch(() => {}); }
  openInTab(id) { const v = this.views.get(id); const url = v && !v.webContents.isDestroyed() ? v.webContents.getURL() : WEB_APPS.find(a => a.id === id)?.url; if (url) this.tabs.create({ url, raw: true }); }
}
