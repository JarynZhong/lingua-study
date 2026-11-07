const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const langs={en:'English','zh-CN':'中文',ja:'日本語'}, fields=['title','note','examples'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();let db,api={key:'',region:''},source='en',timer,revision=0,dragId=null,lookupRevision=0,lookupRecord=null;
try{db=JSON.parse(localStorage.getItem('lingua-v1'))}catch{}if(!db||!Array.isArray(db.grammar)||!Array.isArray(db.words))db={grammar:[],words:[]};
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',3500)}
function persist(){try{localStorage.setItem('lingua-v1',JSON.stringify(db));$('#saveState').textContent='已自动保存';return true}catch{$('#saveState').textContent='保存失败，请导出备份';toast('浏览器存储不可用，请导出备份');return false}}
function view(name){if(name==='settings'&&!translatorAccess.owner)return;document.body.classList.toggle('grammar-workspace',name==='grammar');$$('.view').forEach(el=>el.hidden=el.id!==name);$$('nav button').forEach(el=>el.classList.toggle('active',el.dataset.view===name));if(name==='grammar')renderGrammar();if(name==='words')renderWords()}
$$('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
let translatorAccess = { owner: false, configured: false, shared: false };
const apiSettingsLinks = $$('[data-view="settings"]');
apiSettingsLinks.forEach(button => {
  button.hidden = true;
  button.textContent = '翻译管理';
});
$('#settings').hidden = true;

const sharingPanel = document.createElement('section');
sharingPanel.className = 'settings-card';
sharingPanel.innerHTML = '<h2>翻译共享</h2><p id="sharingState" role="status"></p><button type="button" class="primary" id="sharingToggle" disabled>开启访客翻译</button>';
$('#apiForm').before(sharingPanel);

function showTranslatorAccess() {
  apiSettingsLinks.forEach(button => button.hidden = !translatorAccess.owner);
  $('#apiForm').hidden = translatorAccess.configured;
  $('#sharingToggle').disabled = !translatorAccess.owner || !translatorAccess.configured;
  $('#sharingToggle').textContent = translatorAccess.shared ? '关闭访客翻译' : '开启访客翻译';
  $('#sharingState').textContent = !translatorAccess.configured
    ? '先在 Azure 的生产环境变量中设置 LINGUA_TRANSLATOR_KEY 和区域（如资源要求），即可开启共享。'
    : translatorAccess.shared
      ? '已开放。访客无需登录，每天共用 20,000 字符。'
      : '仅你可以使用翻译。';
}

async function translatorRequest(path, options) {
  const response = await fetch('/api/' + path, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw Error(data?.error || '翻译服务暂不可用');
  return data;
}

$('#sharingToggle').onclick = async () => {
  $('#sharingToggle').disabled = true;
  try {
    translatorAccess = await translatorRequest('translator-access', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shared: !translatorAccess.shared })
    });
  } catch (error) {
    toast(error.message);
  } finally {
    showTranslatorAccess();
  }
};

const translatorReady = translatorRequest('translator-access')
  .then(access => {
    translatorAccess = access;
    if (access.owner && !access.configured) {
      try{api=JSON.parse(sessionStorage.getItem('lingua-api')||localStorage.getItem('lingua-api')||'null')||api;$('#rememberKey').checked=!!localStorage.getItem('lingua-api')}catch{}
      $('#apiKey').value=api.key||'';$('#apiRegion').value=api.region||'';
      apiBadge();
    }
    showTranslatorAccess();
  })
  .catch(() => {});

function apiBadge(){$('#apiBadge').textContent=api.key?'Microsoft · 已配置':'配置翻译 API'}apiBadge();
function formConfig(){return {key:$('#apiKey').value.trim(),region:$('#apiRegion').value.trim()}}
$('#apiForm').onsubmit=e=>{e.preventDefault();api=formConfig();try{sessionStorage.removeItem('lingua-api');localStorage.removeItem('lingua-api');($('#rememberKey').checked?localStorage:sessionStorage).setItem('lingua-api',JSON.stringify(api));$('#apiStatus').textContent='配置已保存。';apiBadge();toast('API 配置已保存');schedule()}catch{$('#apiStatus').textContent='配置仅在本次页面打开期间有效，浏览器禁止保存。';apiBadge()}};
$('#clearKey').onclick=()=>{api={key:'',region:''};try{sessionStorage.removeItem('lingua-api');localStorage.removeItem('lingua-api')}catch{}$('#apiKey').value='';$('#apiRegion').value='';$('#rememberKey').checked=false;$('#apiStatus').textContent='密钥已清除';apiBadge();revision++;clearTimeout(timer)};
const msLang=l=>l==='zh-CN'?'zh-Hans':l;
async function microsoft(path,text,params={},config=api){
  await translatorReady;
  if(config===api && translatorAccess.configured) {
    return translatorRequest('translate-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: path, input: text, source: params.from, target: params.to })
    });
  }
  if(!translatorAccess.owner)throw Error('翻译共享目前已关闭');
if(!config.key)throw Error('请先在 API 设置填写微软 Translator 密钥');const query=new URLSearchParams({'api-version':'3.0',...params});const headers={'Content-Type':'application/json','Ocp-Apim-Subscription-Key':config.key};if(config.region)headers['Ocp-Apim-Subscription-Region']=config.region;let response;try{response=await fetch('https://api.cognitive.microsofttranslator.com/'+path+'?'+query,{method:'POST',headers,body:JSON.stringify([{Text:text}]),signal:AbortSignal.timeout(20000)})}catch{throw Error('网络连接失败或超时，请检查网络后重试')}const data=await response.json();if(!response.ok){const msg=response.status===401||response.status===403?'密钥或区域不正确，或资源无权访问':response.status===429?'请求过快或额度已用完，请检查 Azure 资源':'微软 API 请求失败（'+response.status+'）';throw Error(msg)}return data}
async function translate(text,from,to,config=api){if(from===to)return text;const data=await microsoft('translate',text,{from:msLang(from),to:msLang(to)},config);const result=data?.[0]?.translations?.[0]?.text;if(typeof result!=='string')throw Error('微软 API 返回格式无效');return result}
$('#testApi').onclick=async()=>{const button=$('#testApi');button.disabled=true;$('#apiStatus').textContent='正在测试…';try{const result=await translate('Hello','en','zh-CN',formConfig());$('#apiStatus').textContent='连接成功：Hello → '+result+'。请保存配置。'}catch(e){$('#apiStatus').textContent=e.message}finally{button.disabled=false}};
function updateTargets(){$('#input').lang=source;$$('[data-target]').forEach(el=>el.hidden=el.dataset.target===source)}
$$('[name="source"]').forEach(box=>box.onchange=()=>{source=box.value;$$('[name="source"]').forEach(el=>el.checked=el.value===source);updateTargets();schedule()});
let completedTranslation = null;
function schedule(){revision++;clearTimeout(timer);$('#count').textContent=$('#input').value.length+' / 5000';timer=setTimeout(runTranslation,700)}
async function runTranslation(){await translatorReady;const version=++revision,text=$('#input').value.trim(),from=source;completedTranslation=null;updateTargets();if(!text){Object.keys(langs).forEach(k=>$('#out-'+k).textContent='译文将在这里呈现');$('#status').textContent='等待输入';return}if(!translatorAccess.configured&&(!translatorAccess.owner||!api.key)){
  const message=translatorAccess.owner?'请先配置翻译服务':'翻译共享目前已关闭';
  $('#status').textContent=message;
  Object.keys(langs).filter(k=>k!==from).forEach(k=>$('#out-'+k).textContent=message);
  return;
}$('#status').textContent='正在翻译…';const targets=Object.keys(langs).filter(k=>k!==from);targets.forEach(k=>$('#out-'+k).textContent='翻译中…');const results=await Promise.allSettled(targets.map(async k=>{const value=await translate(text,from,k);if(version===revision)$('#out-'+k).textContent=value}));if(version!==revision)return;results.forEach((r,i)=>{if(r.status==='rejected')$('#out-'+targets[i]).textContent=r.reason.message});const failed=results.some(r=>r.status==='rejected');
  if(!failed){
    const texts=Object.fromEntries(Object.keys(langs).map(lang=>[lang,lang===from?text:$('#out-'+lang).textContent]));
    if(Object.values(texts).every(value=>value.trim()))completedTranslation={version,text,from,texts};
  }
  $('#status').textContent=failed?'翻译失败 · 可点击重新翻译':'翻译完成'}
const sourceInput = $('#input');
sourceInput.spellcheck = true;
const cleanupLabel = document.createElement('label');
cleanupLabel.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#476578';
const cleanupEnabled = document.createElement('input');
cleanupEnabled.type = 'checkbox';
cleanupEnabled.checked = true;
cleanupLabel.append(cleanupEnabled, ' 自动整理原文格式');
$('#retry').before(cleanupLabel);

sourceInput.addEventListener('blur', () => {
  if (!cleanupEnabled.checked) return;
  let cleaned = sourceInput.value.split('\n').map(line => line.trim().replace(/ {2,}/g, ' ')).join('\n').trim();
  if (source === 'en') cleaned = cleaned.replace(/ +([,.;!?])/g, '$1');
  else cleaned = cleaned.replace(/ +([，。！？；、])/g, '$1');
  if (cleaned === sourceInput.value) return;
  sourceInput.value = cleaned;
  schedule();
});
$('#input').oninput=schedule;$('#retry').onclick=()=>{clearTimeout(timer);runTranslation()};$('#clear').onclick=()=>{$('#input').value='';schedule()};
$('#readInput').onclick=()=>speak($('#input').value,source);$$('[data-speak]').forEach(b=>b.onclick=()=>speak($('#out-'+b.dataset.speak).textContent,b.dataset.speak));
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(Object.keys(langs).filter(k=>k!==source).map(k=>langs[k]+'\n'+$('#out-'+k).textContent).join('\n\n'));toast('已复制两种译文')}catch{toast('请选中文字手动复制')}};
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;let recognition,recording=false;if(Recognition){recognition=new Recognition();recognition.onresult=e=>{$('#input').value=($('#input').value+' '+e.results[0][0].transcript).trim().slice(0,5000);schedule()};recognition.onend=()=>{recording=false;$('#mic').classList.remove('listening');$('#mic').textContent='♩ 语音输入'};recognition.onerror=e=>toast(e.error==='not-allowed'?'请允许麦克风访问后重试':'语音识别失败：'+e.error)}$('#mic').onclick=()=>{if(!recognition){toast('当前浏览器不支持语音输入');return}if(recording){recognition.stop();return}try{recognition.lang={en:'en-US',ja:'ja-JP','zh-CN':'zh-CN'}[source];recognition.start();recording=true;$('#mic').classList.add('listening');$('#mic').textContent='● 正在聆听 · 点击停止'}catch{toast('语音识别尚未就绪，请稍后再试')}};
function localLanguage(text){if(!text.trim())return '—';const ja=/[\u3040-\u30ff]/.test(text),zh=/[\u3400-\u9fff]/.test(text),en=/[A-Za-z]{2}/.test(text);return [ja?'日语':zh?'中文（初步）':'',en?'英语':''].filter(Boolean).join(' / ')||'未识别'}

function removeExample(grammarId,exampleId){const g=db.grammar.find(g=>g.id===grammarId);if(!g)return;g.exampleItems=normalizeExamples(g).filter(e=>e.id!==exampleId);syncExamples(g)}
function normalizeExamples(g){
  if(!Array.isArray(g.exampleItems))g.exampleItems=[{id:uid(),text:String(g.examples||''),translation:'',language:'',detectedText:''}];

  g.exampleItems=g.exampleItems.map(e=>({id:e.id||uid(),text:String(e.text||''),translation:String(e.translation||''),language:String(e.language||''),detectedText:String(e.detectedText||'')}));
  return g.exampleItems;
}
function syncExamples(g){g.examples=normalizeExamples(g).map(e=>[e.text,e.translation].filter(Boolean).join('\n')).join('\n\n')}
function speechLanguage(text){return /[\u3040-\u30ff]/.test(text)?'ja':/[\u3400-\u9fff]/.test(text)?'zh-CN':'en'}
function normalizeLanguage(language){return /^zh/.test(language)?'zh-CN':language}
async function detectExample(id,exampleId){
  const g=db.grammar.find(g=>g.id===id),example=g?.exampleItems.find(e=>e.id===exampleId);if(!example)return;
  const text=example.text.trim();example.language=speechLanguage(text);example.detectedText=text;
  if(!(translatorAccess.configured||api.key)||!text)return;
  try{const data=await microsoft('detect',text.slice(0,5000));const current=db.grammar.find(g=>g.id===id)?.exampleItems.find(e=>e.id===exampleId);if(!current||current.text.trim()!==text)return;current.language=normalizeLanguage(data?.[0]?.language||speechLanguage(text));current.detectedText=text;persist()}catch{}
}
function blankExample(){return {id:uid(),text:'',translation:'',language:'',detectedText:''}}
function blankRow(){return {id:uid(),title:'',tag:'',note:'',examples:'',exampleItems:[blankExample()]}}
function focusCell(id,col=0,exampleId){const cells=$$('#grammarList [contenteditable]').filter(el=>el.closest('tr').dataset.id===id);const cell=exampleId?cells.find(el=>el.dataset.example===exampleId&&Number(el.dataset.col)===col):cells.find(el=>Number(el.dataset.col)===col);cell?.focus()}
function addRow(focus=true){const row=blankRow();db.grammar.push(row);persist();$('#search').value='';renderGrammar();if(focus)focusCell(row.id,0);return row}
function editorCell(field,value,col,id,exampleId,placeholder,label){return `<div contenteditable="true" role="textbox" aria-label="${esc(label)}" data-field="${field}" data-col="${col}" ${exampleId?`data-example="${esc(exampleId)}"`:''} data-placeholder="${placeholder}" spellcheck="true">${esc(value)}</div>`}
function renderGrammar(){
  const q=$('#search').value.toLowerCase();db.grammar.forEach(syncExamples);
  const gs=db.grammar.filter(g=>fields.map(k=>g[k]||'').join(' ').toLowerCase().includes(q));
  $('#grammarList').innerHTML=gs.length?gs.map(g=>{
    const examples=normalizeExamples(g), links=linkedGrammars(g), name=grammarLabel(g);
    const rowCount=Math.max(1,examples.length,links.length), count=rowCount+1;
    const displayExamples=Array.from({length:rowCount},(_,i)=>examples[i]||{empty:true});
    const rows=displayExamples.map((example,i)=>{
      const label = `例句 ${i+1}，${name}`;
      const metadata = i===0 ? `<td rowspan="${count}" class="grammar-meta"><div class="grammar-title-cell"><span class="grammar-grip" draggable="true" title="拖动调整顺序" aria-hidden="true">⠿</span>${editorCell('title',g.title,0,g.id,null,'语法名称','语法名称')}</div></td><td rowspan="${count}" class="grammar-meta grammar-note">${editorCell('note',g.note,1,g.id,null,'输入说明…','语法说明')}</td>` : '';
      const content = example.empty ? (!examples.length && i===0 ? '<span class="no-examples">还没有例句</span>' : '') : `<div class="compact-example">
        <span data-example-drag="${esc(example.id)}" title="拖动调整例句顺序" aria-label="拖动调整例句顺序" style="cursor:grab;user-select:none;touch-action:none">⠿</span><span aria-hidden="true">・</span>${editorCell('text',example.text,2,g.id,example.id,'输入例句…',label)}
        <button type="button" data-delete-example="${esc(example.id)}" aria-label="删除${esc(label)}">×</button></div>`;
      const audio = example.empty ? '' : `<button type="button" data-pronounce="${esc(example.id)}" data-kind="text" aria-label="朗读${esc(label)}">◖))</button>`;
      return `<tr id="${i===0?'grammar-'+esc(g.id):'example-'+esc(example.id)}" data-id="${esc(g.id)}" data-example-id="${esc(example.id || '')}" class="${i===0?'grammar-start':''}">${metadata}<td class="example-cell">${content}${example.translation ? `<details><summary>查看已保存译文</summary><div style="white-space:pre-wrap;overflow-wrap:anywhere;padding:6px 8px">${esc(example.translation)}</div></details>` : ''} </td>${grammarLinksCell(links[i])}<td class="pronunciation-cell">${audio}</td></tr>`;
    }).join('');
    return rows+`<tr class="add-example-row" data-id="${esc(g.id)}"><td><button data-add-example="${esc(g.id)}">＋ 添加例句</button></td><td class="grammar-links"><button type="button" data-link-grammar="${esc(g.id)}">＋ 关联语法</button></td><td></td></tr>`
  }).join(''):`<tr><td colspan="5" class="empty">${q?'没有匹配记录':'点击「添加语法」开始记录。'}</td></tr>`;
  bindGrammarLinks();
  bindItemSorting();
  $$('#grammarList [contenteditable]').forEach(cell=>{
    const id=cell.closest('tr').dataset.id;
    cell.oninput=()=>{const g=db.grammar.find(g=>g.id===id);if(cell.dataset.example){const e=g.exampleItems.find(e=>e.id===cell.dataset.example);e[cell.dataset.field]=cell.innerText.replace(/\r/g,'');if(cell.dataset.field==='text'){e.language=speechLanguage(e.text);e.detectedText=e.text.trim()}syncExamples(g)}else g[cell.dataset.field]=cell.innerText.replace(/\r/g,'');persist()};
    cell.onblur=()=>{if(cell.dataset.example&&cell.dataset.field==='text')detectExample(id,cell.dataset.example)};
    cell.onpaste=e=>pasteCells(e,id,Number(cell.dataset.col),cell.dataset.example);
    cell.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Tab'){e.preventDefault();const all=$$('#grammarList [contenteditable]'),i=all.indexOf(cell),next=all[i+(e.shiftKey?-1:1)];if(next)next.focus();else if(!e.shiftKey)addRow()}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(cell.dataset.example){const g=db.grammar.find(g=>g.id===id),i=g.exampleItems.findIndex(e=>e.id===cell.dataset.example);if(!g.exampleItems[i+1]){g.exampleItems.push(blankExample());syncExamples(g);persist();renderGrammar()}focusCell(id,Number(cell.dataset.col),g.exampleItems[i+1].id)}else{const next=cell.closest('tr').querySelector('.example-cell [contenteditable]');next?.focus()}}};
  });
  $$('#grammarList [data-add-example]').forEach(button=>button.onclick=()=>{const g=db.grammar.find(g=>g.id===button.dataset.addExample),e=blankExample();g.exampleItems.push(e);syncExamples(g);persist();renderGrammar();focusCell(g.id,2,e.id)});
  $$('#grammarList [data-delete-example]').forEach(button=>button.onclick=()=>{const id=button.closest('tr').dataset.id;if(!confirm('删除这条例句及其翻译？'))return;removeExample(id,button.dataset.deleteExample);persist();renderGrammar();toast('例句已删除')});
  $$('#grammarList [data-pronounce]').forEach(button=>button.onclick=async()=>{const id=button.closest('tr').dataset.id,g=db.grammar.find(g=>g.id===id),e=g.exampleItems.find(e=>e.id===button.dataset.pronounce),kind=button.dataset.kind,text=e[kind].trim();if(!text){toast(kind==='text'?'请先填写这条例句':'请先填写这条翻译');return}button.disabled=true;try{if(kind==='text'){if(e.detectedText!==text||!e.language)await detectExample(id,e.id);speak(text,e.language||speechLanguage(text))}else speak(text,speechLanguage(text))}finally{button.disabled=false}});
  $$('#grammarList .grammar-title-cell .grammar-grip').forEach(handle=>{const id=handle.closest('tr').dataset.id;handle.ondragstart=e=>{dragId=id;e.dataTransfer.setData('text/plain',id);$$('#grammarList tr[data-id]').filter(tr=>tr.dataset.id===id).forEach(tr=>tr.classList.add('dragging'))};handle.ondragend=()=>{dragId=null;$$('#grammarList .dragging').forEach(tr=>tr.classList.remove('dragging'))}});
  bindGrammarDrops();
}

function bindGrammarDrops() {
  for (const row of $$('#grammarList tr[data-id]')) {
    row.ondragover = event => {
      if (!dragId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    };
    row.ondrop = event => {
      if (!dragId || dragId === row.dataset.id) return;
      event.preventDefault();
      const from = db.grammar.findIndex(item => item.id === dragId);
      const target = db.grammar.findIndex(item => item.id === row.dataset.id);
      if (from < 0 || target < 0) return;
      db.grammar.splice(target, 0, db.grammar.splice(from, 1)[0]);
      dragId = null;
      persist();
      renderGrammar();
    };
  }
}
function bindItemSorting() {
  for (const handle of $$('#grammarList [data-example-drag], #grammarList [data-link-handle]')) {
    const link = handle.hasAttribute('data-link-handle');
    const selector = link ? '[data-link-order]' : 'tr[data-example-id]:not([data-example-id=""])';
    const source = handle.closest(selector);
    const grammarId = source.closest('tr').dataset.id;
    let pointerId, target;

    function clearTarget() {
      if (target) target.style.outline = '';
      target = null;
    }

    handle.onpointerdown = event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);
      source.classList.add(link ? 'link-dragging' : 'dragging');
    };
    handle.onpointermove = event => {
      if (event.pointerId !== pointerId) return;
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest(selector);
      clearTarget();
      if (!cell || cell === source || cell.closest('tr').dataset.id !== grammarId) return;
      target = cell;
      target.style.outline = '2px solid #76b4dd';
    };
    handle.onpointerup = event => {
      if (event.pointerId !== pointerId) return;
      handle.onpointermove(event);
      const destination = target;
      reset();
      if (!destination) return;
      const grammar = db.grammar.find(item => item.id === grammarId);
      if (link) {
        const cells = $$('#grammarList [data-link-order]').filter(cell => cell.closest('tr').dataset.id === grammarId);
        const slots = cells.map(cell => cell.dataset.linkOrder);
        const from = cells.indexOf(source), to = cells.indexOf(destination);
        [slots[from], slots[to]] = [slots[to], slots[from]];
        grammar.linkExamples = Object.fromEntries(slots.flatMap((id, i) =>
          id ? [[id, cells[i].closest('tr').dataset.exampleId || null]] : []
        ));
        const visibleIds = slots.filter(Boolean);
        grammar.linkedIds = [...visibleIds, ...grammar.linkedIds.filter(id => !visibleIds.includes(id))];
      } else {
        const items = grammar.exampleItems;
        const from = items.findIndex(item => item.id === source.dataset.exampleId);
        const to = items.findIndex(item => item.id === destination.dataset.exampleId);
        if (from < 0 || to < 0) return;
        items.splice(to, 0, items.splice(from, 1)[0]);
        syncExamples(grammar);
      }
      persist();
      renderGrammar();
    };
    function reset() {
      pointerId = undefined;
      clearTarget();
      source.classList.remove(link ? 'link-dragging' : 'dragging');
    }
    handle.onlostpointercapture = reset;
  }
}
function parseTSV(text){const rows=[[]];let field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else if(quoted||field==='')quoted=!quoted;else field+=c}else if(!quoted&&(c==='\t'||c==='\n'||c==='\r')){rows.at(-1).push(field);field='';if(c!=='\t'){if(c==='\r'&&text[i+1]==='\n')i++;rows.push([])}}else field+=c}rows.at(-1).push(field);if(rows.length>1&&rows.at(-1).length===1&&rows.at(-1)[0]==='')rows.pop();return rows}
function pasteCells(event,id,col,exampleId){
  event.preventDefault();const text=event.clipboardData.getData('text/plain');
  // A plain sentence stays within the selected cell and keeps normal insertion behavior.
  if(!/[\t\r\n]/.test(text)){const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;if(range){range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);event.currentTarget.dispatchEvent(new Event('input',{bubbles:true}))}return}
  const matrix=parseTSV(text).slice(0,1000),start=db.grammar.findIndex(g=>g.id===id),changed=[];
  let current=db.grammar[start];normalizeExamples(current);
  if(col>=2){let index=Math.max(0,current.exampleItems.findIndex(e=>e.id===exampleId));matrix.forEach((values,r)=>{while(current.exampleItems.length<=index+r)current.exampleItems.push(blankExample());const e=current.exampleItems[index+r];if(col===2){e.text=values[0]||'';}else e.translation=values[0]||'';e.language=speechLanguage(e.text);e.detectedText=e.text.trim();changed.push([current.id,e.id])});syncExamples(current)}
  else{let offset=0;matrix.forEach((values,r)=>{const continuation=r>0&&col===0&&values.length>=3&&values.slice(0,2).every(v=>!v.trim());if(r>0&&!continuation){offset++;while(db.grammar.length<=start+offset)db.grammar.push(blankRow());current=db.grammar[start+offset];normalizeExamples(current)}if(continuation||!current.exampleItems.length)current.exampleItems.push(blankExample());const e=continuation?current.exampleItems.at(-1):current.exampleItems[0];values.forEach((value,c)=>{const target=col+c;if(target<2)current[fields[target]]=value;else if(target===2)e.text=value;});e.language=speechLanguage(e.text);e.detectedText=e.text.trim();syncExamples(current);changed.push([current.id,e.id])})}
  persist();renderGrammar();focusCell(id,col,exampleId);changed.forEach(args=>detectExample(...args));
}
$('#newGrammar').onclick=()=>addRow();$('#search').oninput=renderGrammar;
const sentenceCollectionTag = 'lingua-sentence-collection';
const defaultSentenceCollection = { title: '句子收藏（默认）' };



const saveSentenceButton = document.createElement('button');
saveSentenceButton.type = 'button';
saveSentenceButton.className = 'primary';
saveSentenceButton.style.cssText = 'font-size:14px;font-weight:600;padding:10px 15px;color:white;background:#216a99;border:1px solid #216a99';
saveSentenceButton.textContent = '收藏';
const translationActions = $('#saveExample').parentElement;
translationActions.style.justifyContent = 'flex-start';
$('#saveExample').replaceWith(saveSentenceButton);
saveSentenceButton.onclick = () => {
  const snapshot = completedTranslation;
  if (!snapshot || snapshot.version !== revision ||
      snapshot.text !== $('#input').value.trim() || snapshot.from !== source) {
    toast('请等当前句子的三语翻译完成后再收藏');
    return;
  }

  const destinations = db.grammar.filter(row => row.tag !== sentenceCollectionTag);
  chooseGrammar('选择收藏位置', [defaultSentenceCollection, ...destinations], destination => {
    let row = destination;
    let created = false;
    if (destination === defaultSentenceCollection) {
      row = db.grammar.find(item => item.tag === sentenceCollectionTag);
      if (!row) {
        row = blankRow();
        row.title = '句子收藏';
        row.tag = sentenceCollectionTag;
        row.exampleItems = [];
        db.grammar.push(row);
        created = true;
      }
    }

    const previous = row.exampleItems;
    const previousExamples = row.examples;
    const example = blankExample();
    example.text = snapshot.text;
    example.language = snapshot.from;
    example.detectedText = snapshot.text;
    example.translation = Object.entries(langs)
      .map(([lang, label]) => label + '：' + snapshot.texts[lang])
      .join('\n');

    const entries = normalizeExamples(row).filter(item => item.text.trim() || item.translation.trim());
    row.exampleItems = [...entries, example];
    syncExamples(row);
    if (!persist()) {
      if (created) db.grammar.splice(db.grammar.indexOf(row), 1);
      else {
        row.exampleItems = previous;
        row.examples = previousExamples;
      }
      return;
    }

    $('#grammarLinkDialog').close();
    toast('已收藏到「' + grammarLabel(row) + '」');
  }, '保存整句原文和三语译文');
};

const githubLogin = document.createElement('a');
githubLogin.href = '/.auth/login/github';
githubLogin.textContent = '使用 GitHub 登录';
githubLogin.style.cssText = 'font-size:12px;color:#476578;text-underline-offset:3px';
$('.language-options').after(githubLogin);
fetch('/.auth/me', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(result => {
    const user = result?.clientPrincipal;
    if (user?.identityProvider !== 'github') return;
    githubLogin.textContent = '退出 GitHub';
    githubLogin.href = '/.auth/logout';
  })
  .catch(() => {});

function renderWords(){$('#wordList').innerHTML=db.words.length?db.words.map(w=>`<article class="word-card"><div><h3>${esc(w.text)}</h3><p>${esc(w.meaning)}</p></div><button data-word-delete="${esc(w.id)}">移除</button></article>`).join(''):'<div class="empty">还没有收藏单词。去翻译页面选中一个词，开始积累吧。</div>';$$('[data-word-delete]').forEach(b=>b.onclick=()=>{db.words=db.words.filter(w=>w.id!==b.dataset.wordDelete);persist();renderWords()})}
async function lookup(text,lang){if(!text||text.length>100)return;const version=++lookupRevision;lookupRecord=null;$('#saveWord').disabled=true;$('#lookupWord').textContent=text;$('#lookupResult').textContent='查询中…';if(!$('#lookup').open)$('#lookup').showModal();try{const meaning=await translate(text,lang,lang==='zh-CN'?'en':'zh-CN');if(version!==lookupRevision)return;lookupRecord={id:uid(),text,meaning,lang};$('#lookupResult').textContent=meaning;$('#saveWord').disabled=false}catch(e){if(version===lookupRevision)$('#lookupResult').textContent=e.message}}
document.addEventListener('mouseup',e=>{if(!e.target.closest('.translation'))return;let text=window.getSelection().toString().trim(),lang=source;if(e.target===$('#input'))text=$('#input').value.slice($('#input').selectionStart,$('#input').selectionEnd).trim();const output=e.target.closest('.output');if(output)lang=output.id.slice(4);if(text)setTimeout(()=>lookup(text,lang),0)});$('#closeLookup').onclick=()=>$('#lookup').close();$('#lookup').addEventListener('close',()=>lookupRevision++);$('#saveWord').onclick=()=>{if(!lookupRecord)return;if(db.words.some(w=>w.text===lookupRecord.text)){toast('这个单词已经收藏');return}db.words.unshift(lookupRecord);persist();renderWords();$('#lookup').close();toast('已加入生词收藏')};
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lingua-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};$('#import').onclick=()=>$('#importFile').click();$('#importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5000000)throw Error();const value=JSON.parse(await file.text());if(!Array.isArray(value.grammar)||!Array.isArray(value.words)||value.grammar.some(g=>typeof g.title!=='string')||value.words.some(w=>typeof w.text!=='string'||typeof w.meaning!=='string'))throw Error();const importedIds=new Map(value.grammar.map(g=>[g,uid()]));const linkMap=new Map(value.grammar.map(g=>[g.id,importedIds.get(g)]));db.grammar.push(...value.grammar.map(g=>{const exampleIds=new Map((Array.isArray(g.exampleItems)?g.exampleItems:[]).map(e=>[e,uid()]));const exampleMap=new Map([...exampleIds].map(([e,id])=>[e.id,id]));const linkExamples=Object.fromEntries(Object.entries(g.linkExamples||{}).filter(([id])=>linkMap.has(id)).map(([id,exampleId])=>[linkMap.get(id),exampleMap.get(exampleId)||null]));return {linkExamples,id:importedIds.get(g),linkedIds:Array.isArray(g.linkedIds)?g.linkedIds.map(id=>linkMap.get(id)).filter(Boolean):[],title:g.title,tag:String(g.tag||''),note:String(g.note||''),examples:String(g.examples||''),exampleItems:Array.isArray(g.exampleItems)?g.exampleItems.map(e=>({id:exampleIds.get(e),text:String(e.text||''),translation:String(e.translation||''),language:'',detectedText:''})):undefined}}));db.words.push(...value.words.map(w=>({id:uid(),text:w.text,meaning:w.meaning,lang:String(w.lang||'en')})));persist();renderGrammar();toast('备份已合并导入')}catch{toast('文件无效，请选择语间导出的 JSON 备份')}e.target.value=''};function linkedGrammars(grammar){
  const byId=new Map(db.grammar.map(item=>[item.id,item]));
  const slots = Array(grammar.exampleItems.length).fill(null);
  const rowByExample = new Map(grammar.exampleItems.map((example, index) => [example.id, index]));
  const unplaced = [], overflow = [];
  for (const id of new Set(grammar.linkedIds || [])) {
    const item = byId.get(id);
    if (!item) continue;
    const anchor = grammar.linkExamples?.[id];
    const row = rowByExample.get(anchor);
    if (row !== undefined && !slots[row]) slots[row] = item;
    else if (anchor !== undefined) overflow.push(item);
    else unplaced.push(item);
  }
  for (const item of unplaced) {
    const empty = slots.indexOf(null);
    if (empty === -1) slots.push(item);
    else slots[empty] = item;
  }
  return slots.concat(overflow);
}
function grammarLinksCell(item){
  if(!item)return '<td class="grammar-links" data-link-order=""></td>';
  const id=esc(item.id), label=esc(grammarLabel(item));
  return `<td class="grammar-links" data-link-order="${id}"><div class="grammar-link-item">
    <span class="grammar-grip" data-link-handle style="touch-action:none" title="拖动调整关联语法顺序" aria-hidden="true">⠿</span>
    <a draggable="false" href="#grammar-${id}" data-jump-grammar="${id}">${label}</a>
    <button type="button" data-unlink-grammar="${id}" aria-label="解除关联 ${label}">×</button>
  </div></td>`;
}
function grammarLabel(item){return item.title.trim()||'未命名语法'}
function setGrammarLink(a,b,linked){
  if(!a||!b||a===b)return;
  for(const [item,other] of [[a,b],[b,a]]){
    const ids=new Set(item.linkedIds||[]);
    if(linked)ids.add(other.id);else {
      ids.delete(other.id);
      if(item.linkExamples)delete item.linkExamples[other.id];
    }
    item.linkedIds=[...ids];
  }
}
function jumpToGrammar(id){
  $('#search').value='';
  renderGrammar();
  const row=$$('#grammarList .grammar-start').find(item=>item.dataset.id===id);
  if(!row)return;
  row.classList.add('grammar-highlight');
  row.scrollIntoView({block:'center',inline:'nearest'});
  row.querySelector('[data-field="title"]').focus({preventScroll:true});
  setTimeout(()=>row.classList.remove('grammar-highlight'),1800);
}
function chooseGrammar(title, candidates, onSelect, help=''){
  const dialog=$('#grammarLinkDialog');
  const search=$('#grammarLinkSearch');
  const results=$('#grammarLinkResults');
  $('#grammarLinkTitle').textContent=title;
  $('#grammarPickerHelp').textContent=help;
  function showMatches(){
    const query=search.value.trim().toLowerCase();
    results.replaceChildren();
    for(const item of candidates){
      if(!grammarLabel(item).toLowerCase().includes(query))continue;
      const option=document.createElement('button');
      option.type='button';
      option.textContent=grammarLabel(item);
      const example=item.exampleItems?.find(entry=>entry.text.trim());
      if(example){
        const detail=document.createElement('small');
        detail.textContent=example.text.trim().slice(0,100);
        option.append(detail);
      }
      option.onclick=()=>onSelect(item);
      results.append(option);
    }
    if(!results.childElementCount)results.textContent='没有匹配的语法。';
  }
  search.value='';
  search.oninput=showMatches;
  showMatches();
  if(!dialog.open)dialog.showModal();
  search.focus();
}
function bindGrammarLinks(){
  for(const button of $$('[data-link-grammar]'))button.onclick=()=>{
    const source=db.grammar.find(item=>item.id===button.dataset.linkGrammar);
    const candidates=db.grammar.filter(item=>item!==source&&!(source.linkedIds||[]).includes(item.id));
    chooseGrammar('关联语法',candidates,target=>{
      setGrammarLink(source,target,true);
      persist();
      $('#grammarLinkDialog').close();
      jumpToGrammar(target.id);
    });
  };
  for(const link of $$('[data-jump-grammar]'))link.onclick=event=>{event.preventDefault();jumpToGrammar(link.dataset.jumpGrammar)};
  for(const button of $$('[data-unlink-grammar]'))button.onclick=()=>{
    const source=db.grammar.find(item=>item.id===button.closest('tr').dataset.id);
    const target=db.grammar.find(item=>item.id===button.dataset.unlinkGrammar);
    setGrammarLink(source,target,false);persist();renderGrammar();
  };
}
$('#closeGrammarLink').onclick=()=>$('#grammarLinkDialog').close();

updateTargets();renderGrammar();renderWords();

let voiceSettings={en:'auto:en-US','zh-CN':'auto:zh-CN',ja:'auto:ja-JP',rate:1,pitch:1};
try{const saved=JSON.parse(localStorage.getItem('lingua-voices'));if(saved&&typeof saved==='object')voiceSettings={...voiceSettings,...saved}}catch{}
voiceSettings.rate=Math.min(1.5,Math.max(.5,Number(voiceSettings.rate)||1));voiceSettings.pitch=Math.min(1.5,Math.max(.5,Number(voiceSettings.pitch)||1));
const defaultAccents={en:[['en-US','美式英语'],['en-GB','英式英语'],['en-AU','澳式英语']],'zh-CN':[['zh-CN','普通话'],['zh-TW','台湾国语'],['zh-HK','香港中文']],ja:[['ja-JP','日语']]};
function availableVoices(){return window.speechSynthesis?.getVoices()||[]}
function saveVoiceSettings(){try{localStorage.setItem('lingua-voices',JSON.stringify(voiceSettings));$('#voiceStatus').textContent='发音偏好已保存，适用于翻译与所有例句。'}catch{$('#voiceStatus').textContent='偏好仅在当前页面有效，浏览器禁止保存。'}}
function refreshVoices(){const voices=availableVoices();Object.keys(langs).forEach(lang=>{const select=$('[data-voice-select="'+lang+'"]');if(!select)return;const matches=voices.filter(v=>v.lang.toLowerCase().startsWith(lang==='zh-CN'?'zh':lang));const options=defaultAccents[lang].map(([code,name])=>`<option value="auto:${code}">自动匹配 · ${name}</option>`).join('');select.innerHTML=options+(matches.length?'<optgroup label="当前浏览器可用声音">'+matches.map(v=>`<option value="${esc('voice:'+v.voiceURI)}">${esc(v.name+' · '+v.lang+(v.localService?' · 本机':' · 在线'))}</option>`).join('')+'</optgroup>':'');const desired=voiceSettings[lang];select.value=desired;if(!select.value)select.value=defaultAccents[lang].map(v=>'auto:'+v[0])[0];select.onchange=()=>{voiceSettings[lang]=select.value;saveVoiceSettings()}});$('#voiceCount').textContent=voices.length?'浏览器已提供 '+voices.length+' 个声音，以下按语言列出。':'浏览器暂未提供声音列表。可使用自动匹配，或点击重新加载。'}
function speak(text,lang){if(!window.speechSynthesis){toast('当前浏览器不支持朗读');return}if(!text.trim()){toast('请先输入需要朗读的文字');return}const synth=window.speechSynthesis;lang=normalizeLanguage(lang);const setting=voiceSettings[lang]||('auto:'+lang),voices=availableVoices();let preferred=setting.startsWith('voice:')?voices.find(v=>v.voiceURI===setting.slice(6)):null;const code=setting.startsWith('auto:')?setting.slice(5):preferred?.lang||({en:'en-US',ja:'ja-JP','zh-CN':'zh-CN'}[lang]||lang);if(!preferred)preferred=voices.find(v=>v.lang.toLowerCase()===code.toLowerCase());synth.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=preferred?.lang||code;if(preferred)u.voice=preferred;u.rate=voiceSettings.rate;u.pitch=voiceSettings.pitch;u.onerror=e=>{if(!['interrupted','canceled'].includes(e.error))toast('无法播放这个声音，请到发音设置选择其他声音')};synth.speak(u)}
$$('[data-voice-test]').forEach(b=>b.onclick=()=>{const lang=b.dataset.voiceTest;speak({en:'Small steps lead to big changes.','zh-CN':'每天进步一点点，学习就会有新的收获。',ja:'毎日少しずつ、一緒に勉強しましょう。'}[lang],lang)});
['rate','pitch'].forEach(key=>{const input=$('#voice-'+key),output=$('#voice-'+key+'-value');input.value=voiceSettings[key];output.textContent=Number(input.value).toFixed(1)+(key==='rate'?' 倍':'');input.oninput=()=>{voiceSettings[key]=Number(input.value);output.textContent=Number(input.value).toFixed(1)+(key==='rate'?' 倍':'');saveVoiceSettings()}});
$('#reloadVoices').onclick=refreshVoices;$('#stopVoice').onclick=()=>window.speechSynthesis?.cancel();$('#resetVoices').onclick=()=>{voiceSettings={en:'auto:en-US','zh-CN':'auto:zh-CN',ja:'auto:ja-JP',rate:1,pitch:1};['rate','pitch'].forEach(key=>{$('#voice-'+key).value=1;$('#voice-'+key+'-value').textContent=key==='rate'?'1.0 倍':'1.0'});saveVoiceSettings();refreshVoices()};
window.speechSynthesis?.addEventListener('voiceschanged',refreshVoices);refreshVoices();

function moveGrammarAfter(moving,target){
  if(moving===target||!db.grammar.includes(moving)||!db.grammar.includes(target))return;
  db.grammar.splice(db.grammar.indexOf(moving),1);
  db.grammar.splice(db.grammar.indexOf(target)+1,0,moving);
}
$('#showMoveGrammar').onclick=()=>{
  if(db.grammar.length<2){toast('至少需要两条语法才能调整顺序');return}
  chooseGrammar('选择要移动的语法',db.grammar,moving=>{
    chooseGrammar('选择放在哪条语法下面',db.grammar.filter(item=>item!==moving),target=>{
      moveGrammarAfter(moving,target);
      persist();
      $('#grammarLinkDialog').close();
      jumpToGrammar(moving.id);
      toast('已移到「'+grammarLabel(target)+'」下面');
    },'正在移动「'+grammarLabel(moving)+'」');
  });
};
(() => {
  const exportButton = document.querySelector('#export');
  const saveButton = document.createElement('button');
  const loadButton = document.createElement('button');

  saveButton.type = 'button';
  saveButton.textContent = '保存到云端';
  loadButton.type = 'button';
  loadButton.textContent = '从云端加载';
  const backupKey = 'lingua-before-cloud-load';
  const backupButton = document.createElement('button');
  backupButton.type = 'button';
  backupButton.textContent = '下载加载前备份';
  backupButton.hidden = true;
  exportButton.after(saveButton, loadButton, backupButton);

  try {
    backupButton.hidden = !localStorage.getItem(backupKey);
  } catch {}

  backupButton.onclick = () => {
    try {
      const snapshot = JSON.parse(localStorage.getItem(backupKey));
      if (!snapshot?.data) throw new Error('此浏览器没有加载前备份');
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot.data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'lingua-before-cloud-load-' + snapshot.createdAt.slice(0, 10) + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      alert(error.message);
    }
  };

  // 第一次保存允许创建文件。已有文件须先加载，再修改和保存。
  let cloudVersion = null;

  async function requestCloud(options) {
    const response = await fetch('/api/study-data', options);
    if (response.status === 401 || response.status === 403) {
      throw new Error('请先用有 owner 角色的 GitHub 账号登录');
    }
    if (response.status === 409) {
      throw new Error('本次没有保存到云端，本地记录仍在。云端已有记录或版本已变化。请先导出备份，再决定是否加载云端记录。');
    }

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || `云端请求失败（${response.status}）`);
    }
    return result;
  }

  async function run(action) {
    saveButton.disabled = true;
    loadButton.disabled = true;
    try {
      await action();
    } catch (error) {
      alert(error.message);
    } finally {
      saveButton.disabled = false;
      loadButton.disabled = false;
    }
  }

  saveButton.onclick = () => run(async () => {
    const result = await requestCloud({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: { grammar: db.grammar, words: db.words },
        version: cloudVersion
      })
    });

    cloudVersion = result.version;
    alert('已保存到云端');
  });

  loadButton.onclick = () => run(async () => {
    const result = await requestCloud({ cache: 'no-store' });
    if (result.data === null) {
      alert('云端还没有记录。请先在有学习记录的设备上保存。');
      return;
    }

    const { grammar, words } = result.data;
    if (!Array.isArray(grammar) || !Array.isArray(words)) {
      throw new Error('云端记录格式不正确');
    }
    if (JSON.stringify([grammar, words]) === JSON.stringify([db.grammar, db.words])) {
      cloudVersion = result.version;
      alert('本地和云端记录一致。');
      return;
    }
    const count = data => {
      const examples = data.grammar.reduce((sum, item) => sum + (Array.isArray(item.exampleItems)
        ? item.exampleItems.filter(example => example.text?.trim()).length
        : Number(Boolean(item.examples?.trim()))), 0);
      return data.grammar.length + ' 条语法、' + examples + ' 条例句、' + data.words.length + ' 个生词';
    };
    if (!confirm('当前浏览器：' + count(db) + '\n云端：' + count(result.data) +
      '\n\n继续会用云端记录替换本地记录，并保留一份加载前备份。确定加载吗？')) return;

    try {
      localStorage.setItem(backupKey, JSON.stringify({ createdAt: new Date().toISOString(), data: db }));
    } catch {
      throw new Error('无法保存加载前备份，本次没有替换本地记录。请先导出备份。');
    }
    backupButton.hidden = false;

    const previous = db;
    db = { grammar, words };
    if (!persist()) {
      db = previous;
      throw new Error('浏览器保存失败，本地记录已恢复');
    }

    cloudVersion = result.version;
    renderGrammar();
    renderWords();
    alert('已从云端加载');
  });
})();


let dictationPrompt = null;
const dictationInput = $('#dictationInput');
const dictationStatus = $('#dictationStatus');
const dictationOriginal = $('#dictationOriginal');

function resetDictationAnswer() {
  dictationInput.value = '';
  dictationOriginal.textContent = '';
  dictationOriginal.hidden = true;
  for (const id of ['dictationInput', 'dictationCheck', 'dictationReplay', 'dictationReveal']) {
    $('#' + id).disabled = !dictationPrompt;
  }
  $('#dictationNext').textContent = dictationPrompt ? '下一题' : '抽取并播放';
}

function dictationKey(text, language) {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
    .trim().replace(/[.!?。！？]+$/u, '').trim();
  return language === 'en' ? normalized.replace(/\s+/g, ' ') : normalized.replace(/\s+/g, '');
}

$('#dictationLanguage').onchange = () => {
  dictationPrompt = null;
  resetDictationAnswer();
  dictationStatus.textContent = '点击「抽取并播放」开始。';
};
$('#dictationNext').onclick = () => {
  const lang = $('#dictationLanguage').value;
  const pool = new Set();
  for (const grammar of db.grammar) {
    for (const example of normalizeExamples(grammar)) {
      const text = example.text.trim();
      const language = example.detectedText === text && example.language
        ? normalizeLanguage(example.language) : speechLanguage(text);
      if (language === lang && /\p{L}/u.test(text)) pool.add(text);
    }
  }
  if (pool.size > 1) pool.delete(dictationPrompt?.text);
  const choices = [...pool];
  dictationPrompt = choices.length ? { text: choices[Math.floor(Math.random() * choices.length)], lang } : null;
  resetDictationAnswer();
  dictationStatus.textContent = dictationPrompt ? '听完后输入原句，再点击「检查答案」。' : '暂无这种语言的例句，请在「我的语法」里添加。';
  if (dictationPrompt) {
    speak(dictationPrompt.text, dictationPrompt.lang);
    dictationInput.focus();
  }
};
$('#dictationReplay').onclick = () => {
  if (dictationPrompt) speak(dictationPrompt.text, dictationPrompt.lang);
};
$('#dictationForm').onsubmit = event => {
  event.preventDefault();
  if (!dictationPrompt) return;
  const {text, lang} = dictationPrompt;
  const answer = dictationKey(dictationInput.value, lang);
  const correct = answer === dictationKey(text, lang);
  dictationStatus.textContent = !answer ? '请先输入你听到的原句。' : correct ? '正确！' : '还有出入，可以重听后再试。';
  if (correct) $('#dictationReveal').click();
};
$('#dictationReveal').onclick = () => {
  if (!dictationPrompt) return;
  dictationOriginal.textContent = dictationPrompt.text;
  dictationOriginal.hidden = false;
};
