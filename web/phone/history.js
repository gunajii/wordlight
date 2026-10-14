// The parent's reading diary (pure, unit-tested): the reader's recent sessions as the server sent them
// ({ t: 'reader.history' }: counts and story ids only, newest first). Facts only — no scores, no "better/worse".

/** Local calendar day label: "Today", "Yesterday" or e.g. "Mon 12 Oct". */
export function dayLabel(iso, nowMs, L = {}) {
  const d = new Date(iso), n = new Date(nowMs);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  if (diff === 0) return L.today ?? 'Today';
  if (diff === 1) return L.yesterday ?? 'Yesterday';
  return d.toLocaleDateString(L.locale ?? 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * @param {Array<{endedAt:string, read:number, helped:number, turns:number, storyIds:string[]}>} sessions newest first
 * @param {Record<string,string>} titles story id → title
 * @returns {{ rows: Array<{day:string, title:string, read:number, helped:number, turns:number, pct:number}>, totals: {sessions:number, read:number, helped:number, days:number} }}
 */
export function historyView(sessions, titles, nowMs, L = {}) {
  const list = (Array.isArray(sessions) ? sessions : []).filter((s) => s && typeof s.endedAt === 'string' && s.turns > 0);
  const max = Math.max(1, ...list.map((s) => (s.read | 0) + (s.helped | 0)));
  const rows = list.map((s) => ({
    day: dayLabel(s.endedAt, nowMs, L),
    title: (s.storyIds ?? []).map((id) => titles?.[id] ?? id).join(', ') || (L.aStory ?? 'A story'),
    read: s.read | 0, helped: s.helped | 0, turns: s.turns | 0,
    pct: Math.round((100 * ((s.read | 0) + (s.helped | 0))) / max),
  }));
  const days = new Set(list.map((s) => new Date(s.endedAt).toDateString())).size;
  return { rows, totals: { sessions: rows.length, read: rows.reduce((n, r) => n + r.read, 0), helped: rows.reduce((n, r) => n + r.helped, 0), days } };
}
