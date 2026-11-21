// MCP tool definitions shared by the stdio server (app/mcp/server.cjs) and the
// bridge in the main process (app/main/bridge.js).
const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

module.exports = [
  { name: 'lintas_status', description: 'Lintas version, online state, open tab count and whether an AI key is set.', inputSchema: obj({}), annotations: RO },
  { name: 'browser_list_tabs', description: 'List the open browser tabs (id, title, URL, active, security state).', inputSchema: obj({}), annotations: RO },
  { name: 'browser_open', description: 'Open a URL or search terms in Lintas, in a new tab or in an existing one.', inputSchema: obj({ url: str('URL or search terms'), tabId: int('Existing tab to navigate; omit to open a new tab') }, ['url']), annotations: { readOnlyHint: false, openWorldHint: true } },
  { name: 'browser_read_page', description: 'Read the text of a web page open in Lintas as numbered paragraphs, with its title and URL. Defaults to the active tab.', inputSchema: obj({ tabId: int('Tab to read; omit for the active tab'), maxChars: int('Maximum characters to return (default 60000)') }), annotations: RO },
  { name: 'browser_get_selection', description: 'The text currently selected in a Lintas tab (defaults to the active tab).', inputSchema: obj({ tabId: int('Tab; omit for the active tab') }), annotations: RO },
  { name: 'browser_save_offline', description: 'Save a page in the Lintas offline library (MHTML) so it can be read without a network.', inputSchema: obj({ tabId: int('Tab; omit for the active tab') }), annotations: RW },
  { name: 'offline_list', description: 'List pages saved in the Lintas offline library.', inputSchema: obj({ q: str('Filter by title or URL') }), annotations: RO },
  { name: 'tms_list_projects', description: 'List translation projects with language pair, word counts and progress.', inputSchema: obj({}), annotations: RO },
  { name: 'tms_create_project', description: 'Create a translation project (with its own translation memory and termbase).', inputSchema: obj({ name: str('Project name'), sourceLang: str('Source language code, e.g. en'), targetLang: str('Target language code, e.g. id') }, ['name', 'sourceLang', 'targetLang']), annotations: RW },
  { name: 'tms_get_project', description: 'A project with its files, statistics, translation memories and termbases.', inputSchema: obj({ projectId: str('Project id') }, ['projectId']), annotations: RO },
  { name: 'tms_get_segments', description: 'Segments of a file: id, source, target, status, match score. Paginated.', inputSchema: obj({ projectId: str('Project id'), fileId: str('File id'), offset: int('Start index (default 0)'), limit: int('Maximum segments (default 100, max 500)'), status: str('Only this status: new, draft, translated, reviewed or approved'), q: str('Search in source, target and key') }, ['projectId', 'fileId']), annotations: RO },
  { name: 'tms_update_segment', description: 'Set the translation and/or status of a segment. Statuses translated, reviewed and approved also store the pair in the project translation memory.', inputSchema: obj({ projectId: str('Project id'), fileId: str('File id'), segmentId: str('Segment id'), target: str('New translation'), status: str('new, draft, translated, reviewed or approved'), comment: str('Translator comment') }, ['projectId', 'fileId', 'segmentId']), annotations: RW },
  { name: 'tms_lookup', description: 'Translation memory matches (with fuzzy scores) and termbase hits for a source text in a project.', inputSchema: obj({ projectId: str('Project id'), text: str('Source text') }, ['projectId', 'text']), annotations: RO },
  { name: 'tms_search_terms', description: 'Search a termbase. Statuses: preferred, admitted, forbidden.', inputSchema: obj({ termbaseId: str('Termbase id (see tms_get_project)'), q: str('Search text') }, ['termbaseId']), annotations: RO },
  { name: 'tms_add_term', description: 'Add a term to a termbase.', inputSchema: obj({ termbaseId: str('Termbase id'), source: str('Source term'), target: str('Target term'), status: str('preferred, admitted or forbidden'), note: str('Usage note') }, ['termbaseId', 'source']), annotations: RW },
  { name: 'tms_qa', description: 'Run quality checks (numbers, placeholders, tags, punctuation, spacing, terminology, consistency) on a project or one file.', inputSchema: obj({ projectId: str('Project id'), fileId: str('File id; omit for the whole project') }, ['projectId']), annotations: RO },
  { name: 'tms_import_text', description: 'Add text to a project as a new file, split into segments.', inputSchema: obj({ projectId: str('Project id'), name: str('File name'), text: str('Text to translate') }, ['projectId', 'text']), annotations: RW },
  { name: 'tms_capture_page', description: 'Add the text of a web page open in Lintas to a project as a new file.', inputSchema: obj({ projectId: str('Project id'), tabId: int('Tab; omit for the active tab') }, ['projectId']), annotations: RW },
];
