# Notes for a WordPress.org submission

ContextChat is distributed as a zip from GitHub releases today. These notes list what would have to change, and what to say, if it is ever submitted to the WordPress.org plugin directory.

Checked on 21 November 2026 against the [Detailed Plugin Guidelines](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/). Guideline numbers below refer to that page.

## Must change before submitting

- **Updates come from WordPress.org (guideline 8).**
  - Remove `Update URI: false` from the `contextchat.php` header.
  - Remove `includes/class-updates.php`, which drops WordPress.org update offers for the `contextchat` folder, its `init()` call in `contextchat.php`, and the matching unit check and e2e check (`tests/e2e/update-offer-check.sh`).
  - Both exist only because the plugin is *not* on WordPress.org: without them, a different directory plugin in a folder named `contextchat` could be offered as an "update".
- **Slug.** Check that `contextchat` is free in the directory. If it is taken, the folder name, text domain and the update guard above all depend on it.
- **`Tested up to`** in `readme.txt` must be the current WordPress release at submission time. It says 6.5 today, and the guidelines page itself was served by WordPress 7.2 RC2. Run the browser tests against that version first: they use the WordPress 6.5 build.
- **`Contributors`** must be WordPress.org user names; `nsxsft` must be the owner's account there.
- **Plugin Check.** Run the official Plugin Check plugin and fix what it reports. It has not been run on this code.

## Already in line

- **External service (guideline 6).** `readme.txt` has an "External services" section. It names the Anthropic API endpoint, what is sent and when, what is never sent, and links to Anthropic's terms and privacy policy. Keep it accurate when the chat changes.
- **No tracking without consent (guideline 7).**
  - Nothing is sent to Anthropic until an administrator saves an API key and either turns on the SI chat or presses "Test connection". Configuring a service counts as consent under the guideline's service exception.
  - The click analytics stay on the site and store no IP addresses, cookies or message text.
- **No outside code (guideline 8).** All scripts and styles ship in the plugin. `chat.js` is loaded from the plugin's own folder when the panel opens.
- **No credits or links on the public site (guideline 10).** The chat shows no "powered by" text. The privacy link is the site's own policy, set by the administrator.
- **Admin notices (guideline 11).**
  - The setup notice ("ContextChat is active but has no WhatsApp number yet") shows on admin screens other than the plugin's own, to administrators only. It cannot be dismissed, but it removes itself once a number is saved, which the guideline allows ("self-dismiss when resolved").
  - The Privacy tab warning is on the plugin's own screen and goes away once a policy address is set.
- **Tags (guideline 12).** 5 tags, the maximum.
- **Trademarks (guideline 17).**
  - The slug does not start with another product's name.
  - The display name uses "for WhatsApp", as the guideline's example allows.
  - The readme and header carry the WhatsApp trademark notice.
  - "Claude" and "Anthropic" appear only to name the service the plugin connects to.
- **Libraries (guideline 13).** No bundled copies of libraries WordPress ships. The API key uses PHP's sodium functions, which WordPress provides through its sodium_compat polyfill.

## Wording to keep

- **Guideline 9** forbids implying that a plugin can "create, provide, automate, or guarantee legal compliance".
  - Describe the privacy features as what they do: delete after the keep-for period, refuse ID numbers, record consent.
  - Describe the policy text as "checked against UU 27/2022 and PP 33/2026, not legal advice".
  - Do not use "compliant", "PDP-ready" or similar.
- **Guideline 5** (no trialware) is met: every feature is in the plugin. The SI chat needs the site's own Anthropic key and the site pays Anthropic directly. Say so plainly in the description.

## Readme sections to review at submission

- Description: the SI bullet, and the sentence that it is off by default and needs an Anthropic API key.
- FAQ: "What is stored about visitors?" covers both the click analytics and the SI chats.
- External services: as above.
- Privacy: WordPress shows the suggested policy text under Settings → Privacy → Policy Guide.
- Changelog: 2.0.0.
- Screenshots: none are listed in `readme.txt` yet. WordPress.org takes them from `assets/` in its SVN repository (`screenshot-1.png` …), with captions under `== Screenshots ==`.
