// The parent's phone page in English, Hindi and Marathi (pure, unit-tested). The parent picks the language at the top;
// the choice is remembered on this phone. Hindi and Marathi were written for WordLight and need a native speaker's
// review before wider use (docs/MARATHI_REVIEW.md lists the Marathi strings). Consent text is never machine-translated.
// HTML in strings: only <b>…</b>, written here — never from the network.

export const UI_LANGS = ['en', 'hi', 'mr'];
export const UI_LANG_NAMES = { en: 'English', hi: 'हिन्दी', mr: 'मराठी' };

const en = {
  consentTitle: 'Before we start (for the parent)',
  consentBody: "WordLight uses the microphone <b>only during reading turns</b> to recognise the words your child reads aloud. <b>Your child's voice is not stored</b> by WordLight.",
  consentDetail: 'The microphone is off before, between and after turns, and this page always shows whether it is ON or OFF. During a turn the sound goes over an encrypted connection to the WordLight server, which passes it to Amazon Transcribe for speech recognition and keeps only which words were read.',
  consentBtn: 'I agree — use the microphone during reading turns',
  readerTitle: 'Who is reading?', readerName: 'First name (shown on the TV)', readerNamePh: 'e.g. Riya', readerAge: 'Age', readerLang: 'Reads in',
  readerSummaryLang: 'Your summary at the end, in', readerSummaryNote: "Other languages are machine-translated by Amazon Translate; your child's name is not sent for translation.",
  save: 'Save', readingAs: 'Reading as', readyHint: 'Keep this page open near your child; the TV will say when it is their turn.',
  tipSafari: "<b>iPhone tip (once):</b> so Safari doesn't ask for the microphone at every turn, tap <b>aA</b> (the page menu) in the address bar → <b>Website Settings</b> → <b>Microphone</b> → <b>Allow</b>. The microphone still only turns on during a reading turn.",
  tipOther: '<b>iPhone tip:</b> this browser may ask for the microphone at every turn. Safari can be set to allow it once (aA → Website Settings → Microphone → Allow).',
  startSession: 'Start reading session', changeReader: 'Change reader', micLabel: 'Microphone', tapToListen: 'Tap to start listening',
  wakeLabel: 'Screen kept awake', endSession: 'End reading session', tonight: 'Tonight', summaryNote: 'Translated by Amazon Translate (machine translation).',
  diary: 'Reading diary', diaryNote: 'Counts only, kept 30 days. No recordings and no words your child said are stored.',
  privacyTitle: 'Privacy', privacyBody: 'The microphone is only active during a reading turn. Audio is not stored by WordLight.',
  micListening: '● Listening…', micGetting: 'Getting the microphone ready…', micOff: 'Microphone off',
  stateEcho: 'Your turn! Say the line you just heard.', stateFree: 'Your turn! Read the line on the TV.', stateTap: 'Tap below to start listening',
  stateWellRead: (r, h) => `Well read! ${r} on your own${h ? `, ${h} with a little help` : ''}.`, stateWatch: 'The TV will say when it is your turn. Watch the TV!',
  historyTotals: (n, s, d, r, h) => `${n}: ${s} ${s === 1 ? 'session' : 'sessions'} on ${d} ${d === 1 ? 'day' : 'days'} · ${r} words on their own · ${h} with a little help`,
  historyRow: (r, h) => `${r} on own${h ? ` · ${h} helped` : ''}`, yourReader: 'Your reader', today: 'Today', yesterday: 'Yesterday', aStory: 'A story',
  wake: { on: 'on', off: 'off', requesting: 'requesting…', unsupported: 'not supported — keep the screen on manually', lost: 'lost — tap the page to restore', error: 'refused — keep the screen on manually' },
  nameMissing: 'Please type a first name.', micBlocked: 'The microphone is blocked for this page. Allow it in the browser’s site settings, then tap Start reading session again.',
};

const hi = {
  consentTitle: 'शुरू करने से पहले (माता-पिता के लिए)',
  consentBody: 'आपका बच्चा जो शब्द ज़ोर से पढ़ता है, उन्हें पहचानने के लिए WordLight माइक्रोफ़ोन का इस्तेमाल <b>सिर्फ़ पढ़ने की बारी के दौरान</b> करता है। <b>WordLight आपके बच्चे की आवाज़ सेव नहीं करता।</b>',
  consentDetail: 'बारी से पहले, बारियों के बीच और बाद में माइक्रोफ़ोन बंद रहता है, और यह पेज हमेशा दिखाता है कि वह चालू है या बंद। बारी के दौरान आवाज़ एन्क्रिप्टेड कनेक्शन से WordLight सर्वर तक जाती है, जो उसे शब्द पहचानने के लिए Amazon Transcribe को देता है और सिर्फ़ यह रखता है कि कौन-से शब्द पढ़े गए।',
  consentBtn: 'मैं सहमत हूँ — पढ़ने की बारी में माइक्रोफ़ोन इस्तेमाल करें',
  readerTitle: 'कौन पढ़ रहा है?', readerName: 'पहला नाम (टीवी पर दिखेगा)', readerNamePh: 'जैसे Riya', readerAge: 'उम्र', readerLang: 'पढ़ने की भाषा',
  readerSummaryLang: 'आख़िर में आपका सारांश इस भाषा में', readerSummaryNote: 'दूसरी भाषाओं में अनुवाद Amazon Translate मशीन से करता है; आपके बच्चे का नाम अनुवाद के लिए नहीं भेजा जाता।',
  save: 'सेव करें', readingAs: 'पाठक:', readyHint: 'यह पेज अपने बच्चे के पास खुला रखें; बारी आने पर टीवी बताएगा।',
  tipSafari: '<b>iPhone सुझाव (एक बार):</b> ताकि Safari हर बारी में माइक्रोफ़ोन के लिए न पूछे, एड्रेस बार में <b>aA</b> दबाएँ → <b>Website Settings</b> → <b>Microphone</b> → <b>Allow</b>। माइक्रोफ़ोन फिर भी सिर्फ़ पढ़ने की बारी में ही चालू होगा।',
  tipOther: '<b>iPhone सुझाव:</b> यह ब्राउज़र हर बारी में माइक्रोफ़ोन के लिए पूछ सकता है। Safari में इसे एक बार की अनुमति दी जा सकती है (aA → Website Settings → Microphone → Allow)।',
  startSession: 'पढ़ना शुरू करें', changeReader: 'पाठक बदलें', micLabel: 'माइक्रोफ़ोन', tapToListen: 'सुनना शुरू करने के लिए दबाएँ',
  wakeLabel: 'स्क्रीन चालू रखी गई', endSession: 'पढ़ना ख़त्म करें', tonight: 'आज', summaryNote: 'Amazon Translate द्वारा अनुवादित (मशीन अनुवाद)।',
  diary: 'पढ़ने की डायरी', diaryNote: 'सिर्फ़ गिनती, 30 दिन तक रखी जाती है। कोई रिकॉर्डिंग नहीं, और आपके बच्चे के बोले शब्द सेव नहीं होते।',
  privacyTitle: 'निजता', privacyBody: 'माइक्रोफ़ोन सिर्फ़ पढ़ने की बारी में चालू होता है। WordLight आवाज़ सेव नहीं करता।',
  micListening: '● सुन रहे हैं…', micGetting: 'माइक्रोफ़ोन तैयार हो रहा है…', micOff: 'माइक्रोफ़ोन बंद',
  stateEcho: 'तुम्हारी बारी! जो पंक्ति अभी सुनी, उसे बोलो।', stateFree: 'तुम्हारी बारी! टीवी पर लिखी पंक्ति पढ़ो।', stateTap: 'सुनना शुरू करने के लिए नीचे दबाएँ',
  stateWellRead: (r, h) => `बहुत बढ़िया! ${r} शब्द ख़ुद पढ़े${h ? `, ${h} थोड़ी मदद से` : ''}।`, stateWatch: 'बारी आने पर टीवी बताएगा। टीवी देखो!',
  historyTotals: (n, s, d, r, h) => `${n}: ${d} दिन में ${s} बार पढ़ा · ${r} शब्द ख़ुद पढ़े · ${h} थोड़ी मदद से`,
  historyRow: (r, h) => `${r} ख़ुद${h ? ` · ${h} मदद से` : ''}`, yourReader: 'आपका पाठक', today: 'आज', yesterday: 'कल', aStory: 'एक कहानी',
  wake: { on: 'चालू', off: 'बंद', requesting: 'अनुरोध…', unsupported: 'समर्थित नहीं — स्क्रीन ख़ुद चालू रखें', lost: 'छूट गया — पेज पर टैप करें', error: 'मना किया गया — स्क्रीन ख़ुद चालू रखें' },
  nameMissing: 'कृपया पहला नाम लिखें।', micBlocked: 'इस पेज के लिए माइक्रोफ़ोन बंद है। ब्राउज़र की साइट सेटिंग में अनुमति दें, फिर “पढ़ना शुरू करें” दोबारा दबाएँ।',
};

const mr = {
  consentTitle: 'सुरू करण्यापूर्वी (पालकांसाठी)',
  consentBody: 'तुमचं मूल मोठ्याने वाचत असलेले शब्द ओळखण्यासाठी WordLight मायक्रोफोन <b>फक्त वाचनाच्या पाळीतच</b> वापरतं. <b>WordLight तुमच्या मुलाचा आवाज जतन करत नाही.</b>',
  consentDetail: 'पाळीच्या आधी, दोन पाळ्यांच्या मध्ये आणि नंतर मायक्रोफोन बंद असतो, आणि हे पान नेहमी दाखवतं की तो चालू आहे की बंद. पाळीच्या वेळी आवाज एन्क्रिप्टेड कनेक्शनने WordLight सर्व्हरकडे जातो; सर्व्हर शब्द ओळखण्यासाठी तो Amazon Transcribe कडे पाठवतो आणि फक्त कोणते शब्द वाचले गेले एवढंच ठेवतो.',
  consentBtn: 'मला मान्य आहे — वाचनाच्या पाळीत मायक्रोफोन वापरा',
  readerTitle: 'कोण वाचत आहे?', readerName: 'पहिलं नाव (टीव्हीवर दिसेल)', readerNamePh: 'उदा. Riya', readerAge: 'वय', readerLang: 'वाचनाची भाषा',
  readerSummaryLang: 'शेवटी तुमचा सारांश या भाषेत', readerSummaryNote: 'इतर भाषांतील भाषांतर Amazon Translate यंत्राद्वारे करतं; तुमच्या मुलाचं नाव भाषांतरासाठी पाठवलं जात नाही.',
  save: 'जतन करा', readingAs: 'वाचक:', readyHint: 'हे पान तुमच्या मुलाजवळ उघडं ठेवा; पाळी आली की टीव्ही सांगेल.',
  tipSafari: '<b>iPhone टीप (एकदाच):</b> Safari ने प्रत्येक पाळीला मायक्रोफोनबद्दल विचारू नये म्हणून ॲड्रेस बारमधील <b>aA</b> दाबा → <b>Website Settings</b> → <b>Microphone</b> → <b>Allow</b>. तरीही मायक्रोफोन फक्त वाचनाच्या पाळीतच चालू होईल.',
  tipOther: '<b>iPhone टीप:</b> हा ब्राउझर प्रत्येक पाळीला मायक्रोफोनबद्दल विचारू शकतो. Safari मध्ये एकदाच परवानगी देता येते (aA → Website Settings → Microphone → Allow).',
  startSession: 'वाचन सुरू करा', changeReader: 'वाचक बदला', micLabel: 'मायक्रोफोन', tapToListen: 'ऐकणं सुरू करण्यासाठी दाबा',
  wakeLabel: 'स्क्रीन चालू ठेवली आहे', endSession: 'वाचन संपवा', tonight: 'आज', summaryNote: 'Amazon Translate ने केलेलं भाषांतर (यांत्रिक भाषांतर).',
  diary: 'वाचनाची डायरी', diaryNote: 'फक्त आकडे, 30 दिवस ठेवले जातात. कोणतंही रेकॉर्डिंग नाही, आणि तुमच्या मुलाने बोललेले शब्द जतन होत नाहीत.',
  privacyTitle: 'गोपनीयता', privacyBody: 'मायक्रोफोन फक्त वाचनाच्या पाळीतच चालू असतो. WordLight आवाज जतन करत नाही.',
  micListening: '● ऐकत आहे…', micGetting: 'मायक्रोफोन तयार होत आहे…', micOff: 'मायक्रोफोन बंद',
  stateEcho: 'तुझी पाळी! आत्ता ऐकलेली ओळ म्हण.', stateFree: 'तुझी पाळी! टीव्हीवरची ओळ वाच.', stateTap: 'ऐकणं सुरू करण्यासाठी खाली दाबा',
  stateWellRead: (r, h) => `छान! ${r} शब्द स्वतः वाचले${h ? `, ${h} थोड्या मदतीने` : ''}.`, stateWatch: 'पाळी आली की टीव्ही सांगेल. टीव्हीकडे बघ!',
  historyTotals: (n, s, d, r, h) => `${n}: ${d} दिवसांत ${s} वेळा वाचन · ${r} शब्द स्वतः · ${h} थोड्या मदतीने`,
  historyRow: (r, h) => `${r} स्वतः${h ? ` · ${h} मदतीने` : ''}`, yourReader: 'तुमचा वाचक', today: 'आज', yesterday: 'काल', aStory: 'एक गोष्ट',
  wake: { on: 'चालू', off: 'बंद', requesting: 'विनंती…', unsupported: 'उपलब्ध नाही — स्क्रीन स्वतः चालू ठेवा', lost: 'सुटली — पानावर टॅप करा', error: 'नाकारली — स्क्रीन स्वतः चालू ठेवा' },
  nameMissing: 'कृपया पहिलं नाव लिहा.', micBlocked: 'या पानासाठी मायक्रोफोन बंद आहे. ब्राउझरच्या साइट सेटिंग्जमध्ये परवानगी द्या, मग “वाचन सुरू करा” पुन्हा दाबा.',
};

export const STRINGS = { en, hi, mr };

/** The page language: a saved choice, else the browser's language if Hindi or Marathi, else English. */
export function pickUiLang(saved, navigatorLangs = []) {
  if (UI_LANGS.includes(saved)) return saved;
  for (const l of navigatorLangs) { const b = String(l).slice(0, 2).toLowerCase(); if (b === 'hi' || b === 'mr') return b; }
  return 'en';
}

/** Strings for a language; any key missing there falls back to English. */
export function strings(lang) { return { ...en, ...(STRINGS[lang] ?? {}) }; }

/** The summary language to preselect for a new reader: the page language (English stays English). */
export const defaultSummaryLang = (uiLang) => (uiLang === 'hi' || uiLang === 'mr' ? uiLang : 'en');
