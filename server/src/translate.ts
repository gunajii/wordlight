// The parent's summary in the parent's language, with Amazon Translate.
// Only the counts-based summary sentence is translated, for the PHONE (the TV keeps the original: its bundled fonts
// cover Latin and Devanagari only). The child's first name never leaves the server: it is replaced by a placeholder
// before the call and put back afterwards; if the placeholder does not survive translation exactly, the parent gets
// the English text instead. Any error, timeout or cap → English. Translation can never break the session.
import { usage as defaultUsage, type UsageMeter } from './usage.ts';

/** Languages a parent can choose for the summary (Amazon Translate codes). */
export const SUMMARY_LANGS: Record<string, string> = {
  en: 'English', hi: 'हिन्दी (Hindi)', mr: 'मराठी (Marathi)', bn: 'বাংলা (Bengali)', gu: 'ગુજરાતી (Gujarati)',
  kn: 'ಕನ್ನಡ (Kannada)', ta: 'தமிழ் (Tamil)', te: 'తెలుగు (Telugu)',
};
export const isSummaryLang = (x: unknown): x is string => typeof x === 'string' && Object.hasOwn(SUMMARY_LANGS, x);
// (keep in step with SUMMARY_LANGS in @wordlight/shared-protocol; a test checks they match)

/** Placeholder for the child's name: short, Latin, unlikely to be translated or transliterated. */
export const NAME_TOKEN = 'XQZ';
/** Sent in Amazon Translate's do-not-translate markup, so the placeholder comes back untouched (field test 2026-10-14:
 *  a Marathi summary fell back to English). https://docs.aws.amazon.com/translate/latest/dg/customizing-translations-tags.html */
export const NAME_TAG = `<span translate="no">${NAME_TOKEN}</span>`;
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (x: string) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
/** Translator output → plain text with the bare placeholder: the do-not-translate span unwrapped, any other markup
 *  dropped, entities decoded. */
export function fromMarkup(out: string) {
  return unesc(out.replace(/<span\b[^>]*>\s*XQZ\s*<\/span>/gi, NAME_TOKEN).replace(/<[^>]*>/g, ''));
}

export interface Translator { readonly name: string; translate(text: string, target: string, signal?: AbortSignal): Promise<string> }

type TranslateLike = { send(cmd: any, opts?: { abortSignal?: AbortSignal }): Promise<any> };
export class AwsTranslator implements Translator {
  readonly name = 'amazon-translate';
  private readonly o: { client: TranslateLike; TranslateTextCommand: any };
  constructor(o: { client: TranslateLike; TranslateTextCommand: any }) { this.o = o; }
  static async create(region: string) {
    const { TranslateClient, TranslateTextCommand } = await import('@aws-sdk/client-translate');
    return new AwsTranslator({ client: new TranslateClient({ region }), TranslateTextCommand });
  }
  async translate(text: string, target: string, signal?: AbortSignal) {
    const r = await this.o.client.send(new this.o.TranslateTextCommand({ Text: text, SourceLanguageCode: 'en', TargetLanguageCode: target }), { abortSignal: signal });
    return String(r?.TranslatedText ?? '');
  }
}

export interface TranslatedSummary { text: string; lang: string; source: 'original' | 'amazon-translate'; fallbackReason?: string }

const count = (s: string, sub: string) => s.split(sub).length - 1;

export class SummaryTranslator {
  private calls = 0;
  private readonly cache = new Map<string, string>();
  private readonly o: { translator: Translator | null; timeoutMs: number; maxCalls: number; log: (m: string) => void; usage: UsageMeter };
  constructor(o: { translator: Translator | null; timeoutMs?: number; maxCalls?: number; log?: (m: string) => void; usage?: UsageMeter }) {
    this.o = { timeoutMs: 3000, maxCalls: 200, log: () => {}, usage: defaultUsage, ...o };
  }

  /** `text` is the English summary that mentions the child as `name`. `keep`: other strings sent in do-not-translate
   *  markup, as they are (story titles: field test 2026-10-14, Translate turned the Marathi title “कामसू मुंग्या” into
   *  “महासा मंगा”). Unlike the name, these are not private and are sent. */
  async translate(text: string, name: string, target: string | undefined, keep: readonly string[] = []): Promise<TranslatedSummary> {
    const original: TranslatedSummary = { text, lang: 'en', source: 'original' };
    if (!target || target === 'en') return original;
    const fail = (reason: string): TranslatedSummary => { this.o.log(`[translate] ${target}: English instead (${reason})`); return { ...original, fallbackReason: reason }; };
    if (!isSummaryLang(target)) return fail('unsupported-language');
    if (!this.o.translator) return fail('off');
    if (!name || text.includes(NAME_TOKEN)) return fail('name');
    let masked = esc(text).split(esc(name)).join(NAME_TAG);
    for (const k of [...new Set(keep)].filter((k) => k && k !== name && !k.includes(NAME_TOKEN)).sort((a, b) => b.length - a.length))
      masked = masked.split(esc(k)).join(`<span translate="no">${esc(k)}</span>`);
    const want = count(masked, NAME_TOKEN);
    const key = `${target}\u0000${masked}`;
    let out = this.cache.get(key);
    if (out === undefined) {
      if (this.calls >= this.o.maxCalls) return fail('budget');
      try { this.o.usage.check('translateChars', masked.length); } catch { return fail('daily-cap'); }
      this.calls++; this.o.usage.add('translateChars', masked.length);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
      try { out = await this.o.translator.translate(masked, target, ctl.signal); }
      catch (e: any) { return fail(ctl.signal.aborted ? 'timeout' : `error:${String(e?.name ?? e).slice(0, 40)}`); }
      finally { clearTimeout(timer); }
      if (!out) return fail('empty');
      out = fromMarkup(out);
      this.cache.set(key, out);
    }
    if (count(out, NAME_TOKEN) !== want) return fail('placeholder-lost');
    return { text: out.split(NAME_TOKEN).join(name), lang: target, source: 'amazon-translate' };
  }
}
