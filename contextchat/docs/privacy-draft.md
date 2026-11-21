# SI chat and Indonesian data protection law: check and draft

**Status: draft for legal review. Not legal advice.**

Checked on 21 November 2026 for ContextChat 2.0, against:

- **UU 27/2022 on Personal Data Protection (UU PDP).** Official text from the BPK legal database: <https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022>. In force since 17 October 2022, and the two-year adjustment period (Pasal 74) ended on 17 October 2024.
- **PP 33/2026, the implementing regulation of UU PDP.**
  - Official certified copy ("Salinan"), as published by the Purbalingga regency government: <http://ppid.purbalinggakab.go.id/wp-content/uploads/2026/09/peraturan_pemerintah_no._33_tahun_2026_100926115902.pdf>.
  - Signed and promulgated on 16 July 2026. It takes effect six months later (Pasal 225), on **16 January 2027**.
  - Until the data protection authority ("Lembaga") issues its own regulations, processing may continue as long as it does not conflict with the PP (Pasal 223).
- **Anthropic's own statement on API data retention:** <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data> (dated 1 July 2026).

Not checked:

- whether the Lembaga has been set up;
- whether it has published its list of countries with equal protection, its standard contract clauses, or other Peraturan Lembaga.

Several items below depend on these.

## What the plugin now does

- **No notice in the chat window, by the site owner's decision (21 November 2026).** The window shows only the business name: no notice, no mention of SI or of Anthropic, and the chat introduces itself only as the business. It still never claims to be a person, and says honestly that the chat is answered automatically when a visitor asks. A notice can be added on the Voice tab ("Privacy notice before the first message"); `{retention}` in it shows the keep-for period. The information about Anthropic and the transfer is now only in the privacy policy.
- **Privacy policy address** (Privacy tab), shown with the "Agree and start" button when that option is on. Administrators get a warning when the SI chat is on without one.
- **References.** Visitors see an estimate reference (EST-…) on the estimate card and in the WhatsApp or email summary. The Conversations screen finds a chat by it, or by the chat's own reference (CC-…).
- **Optional "Ask visitors to agree first".**
  - Shows a button before the chat, with the notice and the policy link when they are set. It reads **Agree and start** when there is a notice, and **Mulai ngobrol / Start chatting** when there is none (owner's request). ⚠ A "Start chatting" click with no notice beside it is unlikely to count as explicit consent (UU Pasal 22; PP Pasal 32: free, informed, specific, unambiguous). If the legal review picks consent as the basis, set a notice so the button asks for agreement.
  - The server refuses to start a chat without it.
  - It records a `consent` event with the time and a fingerprint of the notice and policy link that were shown.
- **Suggested privacy policy text** in WordPress under Settings → Privacy → Policy Guide (English source, Indonesian translation). It fills in:
  - the business name;
  - the contact email;
  - the keep-for period;
  - the legal-basis paragraph, which depends on the consent setting.
- **Conversations screen** (administrators only):
  - transcript;
  - processing record (events, without message text);
  - JSON export, which includes the processing record;
  - delete.
- **Deletion records** that hold no message text: `admin_deleted:<reference>` for each manual deletion, and `retention_deleted:<count>` for each daily clean-up. They are kept when other old events are removed.
- **Unchanged from earlier parts:**
  - ID numbers, documents and file-sharing links are refused before anything is stored or sent;
  - only the page path is kept;
  - no IP address is stored (rate limits use a hash with a daily secret);
  - chats are deleted after the keep-for period.

## Requirement by requirement

Legend:

- **Done**: the plugin covers it.
- **Owner**: the site owner has to act.
- **Review**: needs a legal decision; open questions are marked ⚠.

| # | Requirement | Source | Plugin | Status |
|---|---|---|---|---|
| 1 | A basis for processing, decided before processing starts: consent, a request before a contract, legitimate interest, and so on. | UU Pasal 20; PP Pasal 30 | Consent is available as an option. The other bases are the owner's choice. | **Review.** ⚠ If legitimate interest is chosen, PP Pasal 53–54 require a written balancing analysis. If "request before a contract" is chosen, PP Pasal 42 asks for a written or recorded request and a contract that follows; it is unclear whether an enquiry chat qualifies. |
| 2 | Information before processing, under every basis: legality, purpose, data types and relevance, retention, details collected, processing period, rights. It must be easy to find and stay available while processing lasts. | UU Pasal 21; PP Pasal 62 | No notice in the chat window by default. The Policy Guide text covers all seven items. | **Review.** ⚠ PP Pasal 62(3)–(4) asks for the information before processing, through a notice that is easy to reach. With nothing in the chat window, this rests on the privacy policy being easy to find, for example linked in the site footer. Publish the policy, set its address on the Privacy tab, and consider "Ask visitors to agree first", which shows the link before the chat starts. |
| 3 | Tell visitors before the information changes. | UU Pasal 21(2); PP Pasal 62(5) | The policy text shows the new period at once. | **Owner:** update the policy before changing the keep-for period or the basis. |
| 4 | Consent must be written or recorded, and the controller must be able to show proof. Consent must be free, specific and unambiguous. | UU Pasal 22, 24; PP Pasal 32, 34, 36 | A `consent` event with the time and notice version is recorded and exported. | **Done** when the option is on. |
| 5 | Withdrawal of consent: stop processing within 3 × 24 hours, then delete. | UU Pasal 40, 43; PP Pasal 37 | Delete from the Conversations screen. | **Owner** handles requests. |
| 6 | Children (under 18): take steps to identify them; a parent or guardian consents. | UU Pasal 25; PP Pasal 1 angka 21, Pasal 38 | Nothing specific. | **Review.** ⚠ The chat does not ask for age. The policy text has a placeholder. |
| 7 | Collect only what the purpose needs (minimisation). | UU Pasal 16(2)(a), 27; PP Pasal 58–59 | Refuses IDs, documents and file links; page path only; no IP address. | **Done.** |
| 8 | Delete when the retention period ends. | UU Pasal 16(2)(g), 42–44; PP Pasal 80–86 | Daily clean-up after the keep-for period; deletion record kept. | **Done.** |
| 9 | Notify the person before and after a deletion at the end of retention, within 3 × 24 hours. | PP Pasal 87(3), (5) | Not possible: the plugin holds no contact details for visitors. | **Review.** ⚠ Is the period stated in the notice and the policy enough? If not, the only practical answer is a shorter policy statement or not deleting automatically, both worse for privacy. |
| 10 | Access and a copy within 3 × 24 hours, with the processing record. | UU Pasal 7, 32; PP Pasal 76–78 | JSON export including events. | **Owner** handles requests. |
| 11 | Deletion on request; notify within 3 × 24 hours after. | UU Pasal 8, 43, 45; PP Pasal 82, 87 | Delete button; deletion record by reference. | **Owner** notifies the visitor. |
| 12 | Correction within 3 × 24 hours. | UU Pasal 6, 30 | Chat text is a record of what was said and is not edited; the team corrects details in its own order records. | **Owner.** |
| 13 | Requests come through a recorded electronic channel. The controller verifies them in proportion to the request; the request includes identity. | UU Pasal 14; PP Pasal 20–25 | The policy text names the contact email and asks for the time and topic of the chat or the estimate reference; the Conversations screen finds a chat by either reference. | **Review.** ⚠ PP Pasal 24(2) asks for proof of identity, but the chat holds none. Verification would rest on the reference plus details only the visitor knows. |
| 14 | Objection to decisions made only by automated means. | UU Pasal 10 | Estimates only; the team confirms every price; the SI hands off on request. | **Done.** Stated in the policy text. |
| 15 | Record of all processing activities. | UU Pasal 31 | Per-chat events. | **Owner:** keep the site-wide record. |
| 16 | Data protection impact assessment (DPIA) for high-risk processing, which includes "use of new technology". | UU Pasal 34(2)(f); PP Bagian Ketujuh Belas | — | **Review.** ⚠ An AI chat likely counts as new technology, so a DPIA is probably needed. |
| 17 | Security, confidentiality, preventing unauthorised access. | UU Pasal 35–39 | Admin-only screens; tokens stored as hashes; nonces; no message text in logs. | **Owner:** hosting, backups, administrator accounts. |
| 18 | Breach: written notice to the people affected and the Lembaga within 3 × 24 hours of finding out. | UU Pasal 46; PP Pasal 114–116 | The plugin cannot reach visitors. | **Owner:** incident procedure. ⚠ How to notify visitors without contact details. PP Pasal 115 adds a public notice only when a breach disrupts public services or seriously affects the public; it does not replace notice to the people affected. |
| 19 | Processor (Anthropic) acts on documented instructions under an agreement; any sub-processor needs written approval. | UU Pasal 51; PP Pasal 139–141 | — | **Owner.** Anthropic's Data Processing Addendum with SCCs is part of its Commercial Terms (Anthropic privacy center). Confirm the API account is on Commercial Terms and keep a copy. |
| 20 | **Transfer outside Indonesia** (to Anthropic): one of (a) the destination has equal or higher protection, on the Lembaga's list; (b) adequate, binding safeguards, meaning Lembaga standard clauses, binding corporate rules or another instrument the Lembaga recognises; or (c) consent, which is only for one-off transfers involving a limited number of people. | UU Pasal 56; PP Pasal 160–174 | The policy text names Anthropic and the United States, with a placeholder for the safeguard. The chat window does not mention it (owner's decision). | **Review: highest priority.** ⚠ As far as we know, the United States has no comprehensive national data protection law with a supervisory authority, which are the PP Pasal 168 criteria, so (a) looks unlikely. Confirm this, and check whether the Lembaga has published its list. (c) does not fit an always-on chat. That leaves (b), and whether Anthropic's DPA and SCCs count depends on the Lembaga. PP Pasal 161–163 also require a documented transfer assessment. Pasal 164 requires telling visitors before the transfer: purpose, safeguard, how they keep their rights, risks and mitigation. With nothing in the chat window, that rests on the privacy policy. |
| 21 | Data protection officer (PPDP): required for public services, large-scale regular monitoring, or large-scale specific data. | UU Pasal 53; PP Pasal 142–146 | — | **Review.** Probably not required for a translation agency's enquiry chat; confirm. |
| 22 | Specific (sensitive) data: health, biometrics, children, finances and so on. | UU Pasal 4(2) | ID numbers are refused. Visitors may still describe health or financial documents in words. | **Review.** ⚠ Medical and financial translations are common; the guard does not detect these topics. |

## Draft texts

The full privacy policy section is in WordPress under **Settings → Privacy → Policy Guide**, written by `includes/si/class-privacy.php`, and translated in `languages/contextchat-id_ID.po`.

The notice above the chat is empty by default (owner's decision). If the legal review asks for one, this text was used before and can be pasted on the Voice tab:

> Teks chat diproses oleh Anthropic, penyedia model bahasa di luar Indonesia, dan disimpan di situs ini selama {retention} untuk layanan pelanggan. Jangan kirim nomor identitas atau dokumen di sini; gunakan WhatsApp atau email.

> Chat text is processed by Anthropic, a language-model provider outside Indonesia, and kept on this site for {retention} for customer service. Don't send ID numbers or documents here; use WhatsApp or email.

The parts of the policy text in square brackets are for the site owner and the legal review:

- the company address;
- the legal basis (unless consent is on);
- the transfer safeguard and its risks;
- how children are handled.

## For the legal review, in order

1. Transfer to Anthropic: which PP Pasal 165 route applies, the transfer assessment of Pasal 161–163, and whether the privacy policy alone meets Pasal 164 now that the chat window does not mention it (rows 2 and 20).
2. Basis for processing, and the written analysis if legitimate interest is used (row 1).
3. Whether a DPIA is required, and if so, carry it out (row 16).
4. Notifying deletion at the end of retention when there are no contact details (row 9).
5. Verifying requests from visitors who are only identified by a chat reference (row 13).
6. Children and specific data (rows 6 and 22).
7. Breach procedure without visitor contact details (row 18).
8. Whether a PPDP is needed (row 21).
