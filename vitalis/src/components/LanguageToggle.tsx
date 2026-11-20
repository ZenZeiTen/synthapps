import { dictFor, LANGS, t } from '../i18n';
import { useApp } from '../state';

/**
 * A two-way switch between English and Bahasa Indonesia. Each option is
 * labelled in its own language so people can find theirs whatever is
 * showing now.
 */
export function LanguageToggle({ full = false }: { full?: boolean }) {
  const { lang, updateSettings } = useApp();
  return (
    <div className={`segmented lang-toggle${full ? '' : ' is-compact'}`} role="group" aria-label={t().common.switchLanguage}>
      {LANGS.map((l) => {
        const d = dictFor(l);
        return (
          <button
            key={l}
            lang={d.meta.htmlLang}
            aria-pressed={lang === l}
            aria-label={d.meta.languageName}
            title={d.meta.languageName}
            onClick={() => lang !== l && void updateSettings({ language: l })}
          >
            {full ? d.meta.languageName : d.meta.short}
          </button>
        );
      })}
    </div>
  );
}
