// A one-page recorder for a human narrator: shows each story page (picture + text, line by line) and records it with
// the browser's microphone. Each take is saved as a download named <id>-p<N>.webm (or .m4a in Safari).
//   node tools/content/make-recorder.ts <id>     → content/sources/<id>/record.html (open it in Chrome/Brave/Safari)
// Then: bash tools/content/prepare-recordings.sh <id> ~/Downloads "<narrator name>"
// The recording never leaves the computer; nothing is uploaded.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitLines } from './build-story.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const id = process.argv[2];
if (!id) { console.error('usage: node tools/content/make-recorder.ts <id>'); process.exit(2); }
const dir = path.join(ROOT, 'content/sources', id);
const src = JSON.parse(readFileSync(path.join(dir, 'source.json'), 'utf8'));
const pages = src.pages.map((p: any) => ({ image: p.image, lines: splitLines(p.text.normalize('NFC')) }));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const html = `<!doctype html><html lang="${esc(src.lang.slice(0, 2))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Record: ${esc(src.title)}</title>
<style>
:root{--bg:#101820;--card:#17222e;--ink:#f0f4f8;--dim:#9fb3c8;--y:#ffd166;--g:#5dd39e;--r:#ff7a6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.5 -apple-system,"Segoe UI",Roboto,"Noto Sans Devanagari",sans-serif}
main{max-width:980px;margin:0 auto;padding:20px}h1{font-size:22px;margin:0 0 4px}.dim{color:var(--dim);font-size:15px}
.page{display:flex;gap:24px;align-items:center;background:var(--card);border-radius:16px;padding:20px;margin:16px 0}
.page img{width:420px;max-width:45%;border-radius:10px;background:#fff}.text p{font-size:34px;line-height:1.45;margin:0 0 10px}
.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:12px 18px;cursor:pointer}
#rec{background:var(--r);color:#fff}#stop{background:var(--y);color:#111}#play,#next,#prev{background:#2a3a4c;color:var(--ink)}button:disabled{opacity:.4;cursor:default}
.state{font-weight:700;margin-left:8px}.saved{color:var(--g)}ol.tips{color:var(--dim);font-size:15px;margin:6px 0 0 18px;padding:0}
.done{display:inline-block;min-width:28px;text-align:center;border-radius:8px;margin:2px;padding:2px 6px;background:#2a3a4c;font-size:14px}.done.ok{background:var(--g);color:#111}
</style></head><body><main>
<h1>Record the narration: ${esc(src.title)}</h1>
<div class="dim">One take per page. The take is saved to your Downloads as <b>${esc(id)}-p&lt;N&gt;</b> when you press <b>Save &amp; next</b>. Nothing is uploaded.</div>
<ol class="tips"><li>Quiet room, phone on silent, about 20–30 cm from the microphone.</li><li>Read slowly and warmly, as to a 6-year-old. Pause briefly between sentences.</li><li>Wait one second after pressing Record before you start, and after the last word before Stop.</li><li>Not happy? Press Record again: the new take replaces the old one.</li></ol>
<div class="page"><img id="img" alt=""><div class="text" id="text"></div></div>
<div class="bar"><span id="num" class="dim"></span>
<button id="prev">← Back</button><button id="rec">● Record</button><button id="stop" disabled>■ Stop</button><button id="play" disabled>▶ Listen</button><button id="next" disabled>Save &amp; next →</button><span class="state" id="state"></span></div>
<p id="progress"></p>
</main><script>
const ID=${JSON.stringify(id)}, PAGES=${JSON.stringify(pages)};
let i=0, rec=null, chunks=[], blob=null, url=null; const saved=new Set();
const $=(x)=>document.getElementById(x);
function show(){const p=PAGES[i];$('img').src=p.image;$('text').innerHTML='';for(const l of p.lines){const e=document.createElement('p');e.textContent=l;$('text').appendChild(e);}
 $('num').textContent='Page '+(i+1)+' of '+PAGES.length;$('prev').disabled=i===0;blob=null;$('play').disabled=true;$('next').disabled=true;$('state').textContent=saved.has(i)?'saved ✓':'';$('state').className='state'+(saved.has(i)?' saved':'');
 $('progress').innerHTML=PAGES.map((_,k)=>'<span class="done'+(saved.has(k)?' ok':'')+'">'+(k+1)+'</span>').join('');}
async function start(){try{const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:true,autoGainControl:false,channelCount:1}});
 const type=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||'';
 rec=new MediaRecorder(s,type?{mimeType:type,audioBitsPerSecond:128000}:{});chunks=[];rec.ondataavailable=(e)=>chunks.push(e.data);
 rec.onstop=()=>{s.getTracks().forEach(t=>t.stop());blob=new Blob(chunks,{type:rec.mimeType});if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);$('play').disabled=false;$('next').disabled=false;$('state').textContent='recorded — listen, then Save & next';$('state').className='state';};
 rec.start();$('rec').disabled=true;$('stop').disabled=false;$('state').textContent='● recording… read the page';$('state').className='state';}catch(e){$('state').textContent='Microphone refused: '+e.message;}}
$('rec').onclick=start;$('stop').onclick=()=>{rec&&rec.state==='recording'&&rec.stop();$('rec').disabled=false;$('stop').disabled=true;};
$('play').onclick=()=>{new Audio(url).play();};
$('prev').onclick=()=>{if(i>0){i--;show();}};
$('next').onclick=()=>{const ext=blob.type.includes('mp4')?'m4a':'webm';const a=document.createElement('a');a.href=url;a.download=ID+'-p'+(i+1)+'.'+ext;document.body.appendChild(a);a.click();a.remove();saved.add(i);
 if(i<PAGES.length-1){i++;show();}else{show();$('state').textContent='All '+PAGES.length+' pages saved. Tell Claude "recorded".';$('state').className='state saved';}};
document.addEventListener('keydown',(e)=>{if(e.code==='Space'){e.preventDefault();(rec&&rec.state==='recording'?$('stop'):$('rec')).click();}});
show();
</script></body></html>`;
writeFileSync(path.join(dir, 'record.html'), html);
console.log(`wrote content/sources/${id}/record.html — open it in your browser (double-click), record each page, then run tools/content/prepare-recordings.sh`);
