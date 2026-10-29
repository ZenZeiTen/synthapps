# Corbelwise: user guide

Corbelwise is a WordPress theme for any kind of business. It comes in two parts:

| File | What it is | Do you need it? |
|---|---|---|
| `corbelwise-1.0.0.zip` | The theme: how your site looks | Yes |
| `corbelwise-toolkit-1.0.0.zip` | The Corbelwise Toolkit plugin: extra features you can switch on and off | Recommended, optional |

You need WordPress 6.5 or newer and PHP 7.4 or newer. Most hosts meet both.

---

## 1. Install

1. In WordPress, go to **Appearance → Themes → Add New Theme → Upload Theme**.
2. Choose `corbelwise-1.0.0.zip`, click **Install Now**, then **Activate**.
3. Go to **Plugins → Add New Plugin → Upload Plugin**.
4. Choose `corbelwise-toolkit-1.0.0.zip`, click **Install Now**, then **Activate**.

Upload the two zip files as they are. Do not unzip them first.

## 2. Set up your site in five minutes

Open **Appearance → Corbelwise**. The page walks you through these steps:

1. **Choose a style.** Six styles suit different businesses. Each sets the colours (light and dark) and the fonts.

   | Style | Feels | Good for |
   |---|---|---|
   | Ink (default) | Calm, trustworthy, deep blue | Consultants, agencies, any business |
   | Ocean | Clean, modern, teal | Finance, technology, corporate |
   | Sage | Soft, natural, green | Health, wellness, clinics, education |
   | Ember | Warm, inviting, terracotta | Restaurants, cafés, hospitality, craft |
   | Noir | Dark and luxurious, gold accents | Studios, events, premium brands |
   | Mono | Minimal black and white, no web fonts | Law, architecture, fastest possible pages |

2. **Create your starter pages.** One click creates five finished pages: Home, About, Services, Pricing and Contact, and shows Home as your front page. The menu in the header already links to them. If you already have a page at one of these addresses (for example `/about/`), it is left alone.

3. **Add your logo and menu.** Click **Edit header and footer**. Click the site title area to add a logo; click the menu to add, remove or reorder links.

4. **Choose dark mode and the header behaviour** under **Theme options**:
   - *Follow the visitor's device and show a light/dark switch* (default): visitors whose phone or computer is set to dark mode see your dark colours, and a moon/sun button lets anyone switch.
   - *Follow the visitor's device, no switch.*
   - *Always use the light colours.*
   - *Keep the header at the top of the screen while scrolling* (on by default).

5. **Replace the sample text** with your own. Every word, number and button on the starter pages is placeholder text written to be easy to replace.

## 3. Editing pages

Open any page under **Pages** and click the text you want to change. To add a ready-made section, click the **+** button, open **Patterns** and pick a **Corbelwise** category:

| Category | Sections |
|---|---|
| Corbelwise: Full pages | Home, About, Services, Pricing, Contact |
| Corbelwise: Hero | Headline with results card, centred headline, colour band, page headings |
| Corbelwise: Sections | Services cards, six reasons, key numbers, four steps, story with promises, team, contact details |
| Corbelwise: Testimonials and pricing | Three quotes, one large quote, three pricing plans, questions and answers |
| Corbelwise: Calls to action | Colour panel, text with buttons |
| Corbelwise: Posts | Latest three posts |

When you create a new page, WordPress offers the full-page layouts straight away under **Choose a pattern**.

**Page templates.** In the page's settings sidebar, under **Template**, you can choose:

- *Pages* (default): title at the top, content below.
- *Page without title*: for pages built from sections, like the starter pages.
- *Wide page*: content uses the full wide width.
- *Landing page*: a simplified header and footer, for advertising campaigns.
- *Blank canvas*: no header or footer at all.

**Block styles.** Select a block and look under **Styles** in the sidebar for extra Corbelwise looks: *Card* and *Raised card* (groups and columns), *Eyebrow* and *Lead* (paragraphs), *Checklist* (lists), *Shadow* (images), *Text link with arrow* (buttons) and *FAQ* (details).

## 4. Changing colours and fonts

Go to **Appearance → Editor → Styles**. Pick a style, or change individual colours and fonts. Changes apply across the whole site.

Every Corbelwise colour has a light and a dark version. If you change a colour in the editor, the light version changes; the dark version stays as the style defines it.

## 5. The Corbelwise Toolkit plugin

Open the **Corbelwise** menu in the WordPress sidebar. On the **Modules** tab, tick the modules you want and click **Save Changes**. Each module that is on gets its own tab of settings. A module that is off adds nothing to your pages.

### Performance (on by default)

Removes code WordPress adds to every page that most sites never use (the emoji script, extra header tags), keeps the background "heartbeat" out of public pages, and can limit how many revisions are kept per post.

The option **Do not load jQuery Migrate** is off by default. Only switch it on if your site has no very old plugins, then check your site.

### Security (on by default)

- Protective browser headers, so other sites cannot show yours in a frame.
- Login protection: after 5 wrong passwords from the same address, logins from that address pause for 15 minutes (both numbers can be changed).
- One error message for a wrong username or a wrong password, so attackers cannot find out which usernames exist.
- Usernames hidden from visitors.
- Optional: turn off XML-RPC, turn off the file editors in the admin area, and tell browsers to always use HTTPS (only when your whole site works over HTTPS).

If your site sits behind Cloudflare or another proxy, all visitors may appear to come from the same address. Ask your developer to set the `cwtk_client_ip` filter described in the developer notes.

### SEO and sharing (on by default)

- A **Search description** box in the editor sidebar of every page and post. Leave it empty to use the excerpt.
- Preview cards when your pages are shared on social networks and messaging apps.
- Structured data that tells search engines your business name, address, opening hours and social profiles (from the Business details module), plus articles and breadcrumbs.
- Search results and "page not found" pages are kept out of search engines.

If you use Yoast SEO, Rank Math, All in One SEO, SEOPress, The SEO Framework or Slim SEO, this module steps aside automatically so nothing is printed twice. The descriptions you wrote are kept.

### Business details (on by default)

Enter your name, address, phone, email, opening hours and social profiles once. Show them anywhere with a **Shortcode** block:

| Shortcode | Shows |
|---|---|
| `[corbelwise_business field="phone"]` | Your phone number, tappable on phones |
| `[corbelwise_business field="email"]` | Your email address, protected from spam robots |
| `[corbelwise_business field="address"]` | Your address |
| `[corbelwise_business field="hours"]` | Your opening hours as a list |
| `[corbelwise_business field="map"]` | A "View on map" link |
| `[corbelwise_business]` | Your business name |
| `[corbelwise_social_links]` | Links to your social profiles |

### Announcement bar (off by default)

A slim message at the top of every page: offers, holiday hours, news. You can add a button, choose colours, let visitors close it, and set start and end dates. A closed bar stays closed for that visitor until you change the message.

### AI assistant (off by default)

Powered by Claude from Anthropic. It has two parts, and you choose which to use.

**Writing assistant** (for you and your editors). In the page or post editor, click the sparkle icon in the top bar. You can:

- write a first draft from a few lines describing the page;
- rewrite selected paragraphs: clearer, shorter, longer, friendlier, more formal, or with spelling fixed;
- write an excerpt, a search description, or five title ideas.

Every result appears as a preview first. Nothing changes in your page until you click **Use**, **Insert** or **Replace**. Always read AI-written text before you publish it.

**Visitor chat** (for your visitors). A chat button in the corner of your pages, or only where you place the `[corbelwise_ai_chat]` shortcode. It answers questions using your business details, the instructions you write, and your published pages. When it does not know, it says so and points visitors to your contact details.

**Setting it up:**

1. Create an account at [console.anthropic.com](https://console.anthropic.com), add a payment method, and create an API key.
2. In **Corbelwise → Modules**, tick **AI assistant** and save.
3. In **Corbelwise → AI assistant**, paste the key and save. Click **Send a test request** to check it works.
4. Write a few lines under **What the assistant should know**: common questions and their answers, policies, and anything it must not say.
5. Tick **Turn on the visitor chat** if you want it.

**Costs.** The plugin is included; Anthropic bills AI usage to your own account. Every visitor message is one request. To keep costs predictable:

- choose **Claude Haiku 5.5** for the visitor chat; it costs far less per message than Claude Opus 5.5;
- set **Messages per visitor per hour** (default 20) and **Messages per day for the whole site** (default 300). When the daily cap is reached, the chat tells visitors to contact you directly and starts again the next day.

The AI tab shows how many chat messages and writing requests were made today.

**Privacy.** When the chat is used, the visitor's messages, together with your business details, your instructions and excerpts of your public pages, are sent to Anthropic to write an answer. Your site does not store the conversation. The plugin adds suggested text for your privacy policy under **Settings → Privacy**. The note under the chat tells visitors not to share personal or payment details; you can change its wording.

**Keeping your key safe.** The key is stored encrypted with your site's secret keys. For extra safety, your developer can put it in `wp-config.php` instead: `define( 'CWTK_ANTHROPIC_API_KEY', 'your-key' );`

## 6. Updating

1. Download the new version.
2. **Theme:** Appearance → Themes → Add New Theme → Upload Theme, choose the new `corbelwise-x.y.z.zip`, then **Replace active with uploaded**.
3. **Plugin:** Plugins → Add New Plugin → Upload Plugin, choose the new `corbelwise-toolkit-x.y.z.zip`, then **Replace current with uploaded**.

Your pages, styles and settings are kept.

WordPress will never offer a Corbelwise update by itself. If WordPress ever shows "a new version is available" for Corbelwise or the Corbelwise Toolkit, it would be a different product with the same folder name: do not accept it. Both Corbelwise files block such offers.

## 7. Questions

**My front page shows a list of posts.** Open Appearance → Corbelwise and click **Create my pages**, or choose a front page under Settings → Reading.

**I deleted the toolkit plugin. Are my settings gone?** No. Settings are kept unless you ticked **Delete all toolkit settings and data** under Corbelwise → Advanced before deleting it.

**Can I use the toolkit with another theme?** Yes. It works with any theme. The chat and the announcement bar use the Corbelwise colours when the Corbelwise theme is active, and neutral colours otherwise.

**Can I translate the theme?** Yes. Both parts are translation-ready; the translation templates are in each `languages` folder.

**Where are the fonts loaded from?** From your own site. Nothing is loaded from Google or other font services, which is faster and better for your visitors' privacy.
