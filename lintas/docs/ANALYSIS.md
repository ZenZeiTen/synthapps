# Opera Neon, analysed — and what Lintas does differently

Source: the Opera Neon home page, https://www.operaneon.com/, read on 2026-11-21.
Everything under "What Neon offers" restates that page; nothing there was tested.

## What Neon offers

| Area | What the page says |
|---|---|
| Positioning | "This browser is built to act." An agentic browser that "works on your tasks, interprets the web, manages tabs, acts when you command". |
| Research, shape, deliver | Reads the page, carries context across tabs, sources, notes and decisions, compares inputs and structures a result "ready to send, share, or build on". |
| Several agents | Different agents for different outcomes: a quick agenda, browsing the web, deep research, generating documents. |
| Build, connect, command | Connect your own agents through MCP and a CLI ("Opera CLI"); "the browser becomes the layer your work can run through". |
| Browser essentials | Opera's tab management, snapshots, sidebar messengers, modular browsing, built-in ad blocker and free VPN. |
| Privacy | Credentials, passwords, card details and cookies stay on the device; account data, chats and history are not used for training, personalisation or advertising. |
| Price | Agentic features and "top world LLMs" need a subscription of $19.90/month. |

## Where it falls short for a linguist who codes

1. **Generic, not language-aware.** Neon treats a page as context for a general agent. Nothing on the page mentions translation memory, termbases, segment-level work, QA checks or the file formats of the trade (XLIFF, TMX, TBX, PO).
2. **Outputs are documents, not deliverables.** A translator's deliverable is a translated file in its original format, a TM update and a QA report, with every segment's status tracked. A chat answer is not that.
3. **Online by design.** The page says nothing about working offline; agent features are tied to a subscription service.
4. **Subscription for the AI layer**, with the model choice made by the vendor.

## What Lintas does instead

| Need | Lintas |
|---|---|
| A real, fast browser | Chromium engine (Electron), sandboxed tabs, lazy session restore, tracker blocking, HTTPS-first with an HTTPS-only mode, third-party cookie stripping, Do Not Track/GPC, permission prompts, private tabs, find, zoom, downloads, bookmarks, history. |
| Works offline | Save any page as a single MHTML file; a failed load offers the saved copy; optional auto-save of every page; the whole TMS is local and needs no network. |
| Translation Management System built in | Projects with a language pair, files imported from TXT, Markdown, HTML, DOCX, SRT, VTT, PO, XLIFF, JSON, CSV and TMX — or captured straight from the open web page. Segment editor with workflow statuses (new → draft → translated → reviewed → approved), locking and comments. |
| Translation memory | Fuzzy matching with 101 % context matches, 100 %, 99 % (case/punctuation only) and edit-distance scores, word-level diff, automatic TM update on confirm, TMX import/export, pre-translation and a standard match-band analysis report. |
| Terminology | Termbases with preferred, admitted and forbidden terms; recognition in every segment (with short-suffix matching for inflected forms such as Indonesian *-nya*); TBX/CSV import and TBX export; add a term from any web page with a right-click. |
| Quality assurance | Numbers (locale-aware: 1,000.50 = 1.000,50), placeholders, tags, end punctuation, spacing, length ratio, missing and forbidden terms, inconsistent translations. |
| AI that serves the work | Claude through the user's own API key (stored encrypted with the OS keychain): segment suggestions that use TM matches, the termbase and neighbouring segments; MQM-style review; term extraction; in-place page translation that uses the TM first and enforces the termbase; questions about the open page answered with clickable paragraph citations. |
| Deliverables | Export the translated file in its original format (PO, XLIFF, JSON, CSV, SRT/VTT, DOCX, HTML, TXT/MD) or as XLIFF, TMX, PO, JSON or CSV. |
| Cost | No subscription. You pay Anthropic only for the AI requests you make; everything else is free and local. |

What Lintas does **not** try to copy: Neon's built-in VPN, sidebar messengers and its general-purpose "do tasks for me" agents. They are out of scope for a translation workstation, and a VPN is a service, not a browser feature.
