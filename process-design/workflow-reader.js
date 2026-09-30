(() => {
  'use strict';
  const packed = document.getElementById('workflow-data');
  if (!packed) return;
  const bundle = JSON.parse(packed.textContent), catalog = bundle.catalog, assets = bundle.assets || {};
  const workflows = new Map(catalog.workflows.map(w => [w.id, w]));
  const model = JSON.parse(document.getElementById('model-data').textContent);
  const overallNodes = new Map(model.pools.flatMap(p => p.nodes).map(n => [n.id, n]));
  const modes = { asis: '현재 업무', tobe: '도입 후 업무', compare: '변경점 / 기능' };
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const lines = v => Array.isArray(v) ? v.filter(Boolean).join('\n') : v == null ? '' : String(v);
  let current = null, mode = 'asis', stepId = null, parentId = null, returnView = null, zoom = 1, box = [0, 0, 100, 100], svg = null, roleRows = [];
  const shell = el('section', undefined, 'workflow-shell'); shell.id = 'workflow-shell'; shell.hidden = true; shell.setAttribute('aria-label', '하위 업무 흐름');
  shell.innerHTML = `<header class="wf-header"><nav class="wf-breadcrumb" aria-label="현재 위치"><button id="wf-back">전체 업무 흐름</button><span>›</span><button id="wf-crumb"></button><span id="wf-step-crumb"></span></nav><div class="wf-title-row"><div><h1 id="wf-title"></h1><p id="wf-purpose"></p></div><div class="wf-file-actions"><button id="wf-download">이 흐름 BPMN 내려받기</button><button id="wf-edit" class="primary">이 흐름 편집하기</button></div></div></header><div class="wf-tabs" role="tablist" aria-label="현재와 도입 후 비교"><button id="wf-tab-asis" role="tab">현재 업무</button><button id="wf-tab-tobe" role="tab">도입 후 업무</button><button id="wf-tab-compare" role="tab">변경점 / 기능</button><select id="wf-choose" class="wf-choose" aria-label="다른 하위 업무 흐름 선택"></select></div><div class="wf-toolbar" id="wf-toolbar"><div class="wf-search-wrap"><input id="wf-search" type="search" placeholder="이 흐름의 단계 · 담당 · 설명 검색" aria-label="하위 업무 검색"><div id="wf-results" class="wf-search-results" hidden></div></div><button id="wf-fit">전체 구조</button><button id="wf-read">읽기 크기</button><button id="wf-minus" aria-label="하위 흐름 축소">−</button><span id="wf-zoom" class="zoom-readout">100%</span><button id="wf-plus" aria-label="하위 흐름 확대">＋</button><span class="wf-help">잡아 끌어 이동 · 단계 또는 연결선 선택</span></div><div class="wf-context" id="wf-context"></div><div class="wf-main" id="wf-main"><div class="wf-viewport" id="wf-viewport" tabindex="0" aria-label="하위 순서도"><div class="wf-map" id="wf-map"></div></div><div id="wf-role-labels" class="wf-role-labels" aria-hidden="true"></div><aside class="wf-panel" id="wf-panel" hidden><div class="wf-panel-head"><span id="wf-panel-mode"></span><button id="wf-close-step" aria-label="단계 설명 닫기">×</button></div><div id="wf-step-detail"></div></aside></div><div class="wf-compare" id="wf-compare" hidden></div><div class="wf-status" id="wf-status" role="status"></div>`;
  document.body.append(shell);
  for (const w of workflows.values()) { const o = el('option', w.title); o.value = w.id; $('wf-choose').append(o); }
  function params() { return new URLSearchParams(location.hash.slice(1)); }
  function hash(replace = true) {
    const p = new URLSearchParams({ workflow: current.id, mode });
    if (stepId) p.set('step', stepId); if (parentId) p.set('parent', parentId);
    history[replace ? 'replaceState' : 'pushState'](null, '', location.pathname + location.search + '#' + p);
  }
  function setOverallInert(value) { for(const element of document.body.children)if(element!==shell&&element.matches('header,main,footer,.controls,.stages,.read-hint,.reader-flow-legend'))element.inert=value; }
  function saveReturn() { try { sessionStorage.setItem('artwork-workflow-return-v4', JSON.stringify({ parentId, view: returnView })); } catch {} }
  function rememberOverall() {
    if (shell.hidden) {
      parentId = window.artworkReader.selected();
      returnView = window.artworkReader.getView?.() || { left: $('viewport').scrollLeft, top: $('viewport').scrollTop };
      saveReturn();
    }
  }
  function displayContext() {
    const target = $('wf-context'); target.replaceChildren();
    target.append(el('strong', mode === 'asis' ? '현재 업무 · 현행 업무 정리 기준' : mode === 'tobe' ? '도입 후 업무 · 개발 완료 표시가 아닙니다' : '현재 업무와 도입 후 업무에서 달라지는 부분'));
    target.append(el('p', mode === 'compare' ? current.purpose : current[mode]?.summary || current.purpose));
  }
  function setStatus(text) { $('wf-status').textContent = text; }
  function assetKey(which = mode) { return current.id + '-' + which; }
  function xmlAsset(which = mode) { return assets[assetKey(which)]?.bpmn; }
  function modeData() { return current?.[mode]; }
  function open(id, which = 'asis', selected = null, options = {}) {
    const w = workflows.get(id); if (!w) return false;
    const entering = shell.hidden;
    if (!options.restore) rememberOverall();
    current = w; mode = modes[which] ? which : 'asis'; stepId = null;
    if (options.parent) parentId = options.parent;
    shell.hidden = false; document.body.classList.add('workflow-open'); setOverallInert(true);
    $('wf-title').textContent = w.title; $('wf-crumb').textContent = w.title; $('wf-purpose').textContent = w.purpose;
    $('wf-choose').value = w.id;
    for (const key of Object.keys(modes)) { $('wf-tab-' + key).setAttribute('aria-selected', String(mode === key)); $('wf-tab-' + key).disabled = key !== 'compare' && !!w[key]?.steps?.length && !assets[w.id+'-'+key]?.svg; }
    $('wf-step-crumb').textContent = ''; $('wf-panel').hidden = true; $('wf-search').value = ''; $('wf-results').hidden = true;
    $('wf-main').hidden = mode === 'compare'; $('wf-toolbar').hidden = mode === 'compare'; $('wf-compare').hidden = mode !== 'compare';
    $('wf-download').hidden = mode === 'compare' || !xmlAsset(); $('wf-edit').hidden = mode === 'compare' || !xmlAsset() || location.protocol === 'file:';
    displayContext();
    if (mode === 'compare') renderCompare(); else renderGraph();
    if (selected && mode !== 'compare') selectStep(selected);
    if (options.history !== false) hash(!(options.push === true || entering));
    return true;
  }
  function back() {
    shell.hidden = true; document.body.classList.remove('workflow-open'); setOverallInert(false); current = null; stepId = null;
    if(parentId&&!overallNodes.has(parentId)){parentId=[...overallNodes.values()].find(n=>n.includedNodeIds?.includes(parentId))?.id||parentId;}
    if (parentId && overallNodes.has(parentId)) window.artworkReader.select(parentId, { navigate: false });
    else { history.replaceState(null, '', location.pathname + location.search); }
    requestAnimationFrame(() => {
      if (returnView && window.artworkReader.setView) window.artworkReader.setView(returnView);
      else if (returnView) $('viewport').scrollTo(returnView.left, returnView.top);
    });
  }
  function setSize() {
    $('wf-map').style.width = box[2] * zoom + 'px'; $('wf-map').style.height = box[3] * zoom + 'px';
    $('wf-zoom').textContent = Math.round(zoom * 100) + '%'; updateRoles();
  }
  function updateRoles() {
    const layer=$('wf-role-labels'),v=$('wf-viewport');layer.replaceChildren();layer.style.height=v.clientHeight+'px';if(zoom<.45)return;
    for(const row of roleRows){const y=(row.y-box[1])*zoom-v.scrollTop,bottom=y+row.height*zoom;if(bottom>26&&y<v.clientHeight-25){const badge=el('span',row.name,'wf-role-label');badge.style.top=Math.max(5,y+5)+'px';layer.append(badge);}}
  }
  function firstTask() { return modeData()?.steps?.find(s=>/task$/i.test(s.type)) || modeData()?.steps?.find(s=>s.type!=='start'&&s.type!=='event') || modeData()?.steps?.[0]; }
  function readSize() { if(!svg)return;zoom=1;setSize();const c=nodeCenter(stepId||firstTask()?.id);if(c)center(c.x,c.y); }
  function worldCenter() { const v = $('wf-viewport'); return { x: box[0] + (v.scrollLeft + v.clientWidth / 2) / zoom, y: box[1] + (v.scrollTop + v.clientHeight / 2) / zoom }; }
  function center(x, y) { const v = $('wf-viewport'); v.scrollTo(Math.max(0, (x - box[0]) * zoom - v.clientWidth / 2), Math.max(0, (y - box[1]) * zoom - v.clientHeight / 2)); }
  function scale(value) { if (!svg) return; const c = worldCenter(); zoom = Math.max(.12, Math.min(2.5, value)); setSize(); center(c.x, c.y); }
  function elementFor(id) { return svg?.querySelector('[data-element-id="' + CSS.escape(id) + '"]'); }
  function nodeCenter(id) { const g = elementFor(id); if (!g) return null; const b = g.getBBox(), m = g.transform.baseVal.consolidate()?.matrix; return { x: b.x + b.width / 2 + (m?.e || 0), y: b.y + b.height / 2 + (m?.f || 0) }; }
  function renderGraph() {
    const map = $('wf-map'), data = modeData(), source = assets[assetKey()]?.svg;
    map.replaceChildren(); svg = null; roleRows=[]; $('wf-role-labels').replaceChildren(); box = [0, 0, 100, 100]; zoom = 1;
    if (!data?.steps?.length || data.applicable === false) {
      map.style.width = '100%'; map.style.height = 'auto'; map.append(el('div', data?.summary || '이 Workflow는 솔루션 도입 후 새로 수행하는 업무입니다.', 'wf-empty-current'));
      $('wf-fit').disabled = $('wf-read').disabled = $('wf-minus').disabled = $('wf-plus').disabled = true;
      setStatus('도입 후 업무 탭에서 새로 수행하는 업무를 볼 수 있습니다.'); return;
    }
    if (!source) { map.append(el('p', '이 흐름의 도면 파일을 불러오지 못했습니다.')); setStatus('도면 파일 확인이 필요합니다.'); return; }
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml'); svg = document.importNode(doc.documentElement, true); map.append(svg);
    box = (svg.getAttribute('viewBox') || '0 0 ' + parseFloat(svg.getAttribute('width')) + ' ' + parseFloat(svg.getAttribute('height'))).split(/[ ,]+/).map(Number);
    svg.setAttribute('viewBox', box.join(' ')); svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('aria-label', current.title + ' · ' + modes[mode]);
    $('wf-fit').disabled = $('wf-read').disabled = $('wf-minus').disabled = $('wf-plus').disabled = false;
    for (const s of data.steps) {
      const groups = [elementFor(s.id), elementFor(s.id + '_label')].filter(Boolean);
      for (const g of groups) { g.dataset.wfStep = s.id; g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0'); g.setAttribute('aria-label', (s.actor || '') + ' ' + s.name); g.addEventListener('click', e => { e.stopPropagation(); selectStep(s.id, false); }); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStep(s.id); } }); }
    }
    for (const f of data.flows || []) {
      const groups = [elementFor(f.id), elementFor(f.id + '_label')].filter(Boolean);
      for (const g of groups) { g.dataset.wfEdge = f.id; g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0'); g.setAttribute('aria-label', (f.label || '연결선') + ' · 이어진 단계로 이동'); const move = () => selectStep(stepId === f.target ? f.source : f.target); g.addEventListener('click', e => { e.stopPropagation(); move(); }); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); move(); } }); }
    }
    const semantic = new DOMParser().parseFromString(xmlAsset(), 'application/xml');
    for(const lane of semantic.getElementsByTagNameNS('*','lane')){const g=elementFor(lane.getAttribute('id')),rect=g?.querySelector(':scope>.djs-visual>rect'),m=g?.transform.baseVal.consolidate()?.matrix;if(rect)roleRows.push({name:lane.getAttribute('name')||'담당',y:(m?.f||0)+(+rect.getAttribute('y')||0),height:+rect.getAttribute('height')});}
    for (const gateway of [...semantic.getElementsByTagNameNS('*','exclusiveGateway'), ...semantic.getElementsByTagNameNS('*','inclusiveGateway'), ...semantic.getElementsByTagNameNS('*','parallelGateway')]) {
      const group=elementFor(gateway.id||gateway.getAttribute('id')),visual=group?.querySelector(':scope > .djs-visual'),polygon=visual?.querySelector(':scope > polygon');
      if(!polygon)continue;
      const count=name=>[...semantic.getElementsByTagNameNS('*','sequenceFlow')].filter(f=>f.getAttribute(name==='incoming'?'targetRef':'sourceRef')===gateway.getAttribute('id')).length;
      let context={};try{context=JSON.parse([...gateway.children].find(e=>e.localName==='documentation'&&e.getAttribute('textFormat')==='application/vnd.artwork.review-context+json')?.textContent||'{}');}catch{}
      const merge=gateway.getAttribute('gatewayDirection')==='Converging'||count('outgoing')<=1&&count('incoming')>1;
      const meaning=context.gatewayMeaning||(gateway.localName==='parallelGateway'?(merge?'모두 대기':'함께 진행'):gateway.localName==='inclusiveGateway'?(merge?'조건 합류':'해당 경로'):(merge?'경로 합류':'하나 선택'));
      group.classList.add('wf-korean-gateway');group.dataset.gatewayMeaning=meaning;
      const bounds=polygon.getBBox(),ns='http://www.w3.org/2000/svg',text=document.createElementNS(ns,'text');
      text.setAttribute('x',bounds.x+bounds.width/2);text.setAttribute('y',bounds.y+bounds.height/2-2);text.setAttribute('text-anchor','middle');text.setAttribute('class','wf-gateway-meaning');
      meaning.split(' ').forEach((line,i)=>{const span=document.createElementNS(ns,'tspan');span.setAttribute('x',bounds.x+bounds.width/2);span.setAttribute('dy',i?12:0);span.textContent=line;text.append(span);});visual.append(text);
    }
    const meta = bundle.diagramMeta?.diagrams?.[assetKey()] || {};
    for (const [id, aux] of Object.entries(meta.auxiliaryNodes || {})) {
      const group = elementFor(id); if (!group || !aux.targetStepId) continue;
      group.dataset.wfAux = id; group.setAttribute('role','button'); group.setAttribute('tabindex','0');
      group.setAttribute('aria-label', (aux.kind === 'merge' ? '경로 합류' : '업무 연결') + ' · 이어진 단계로 이동');
      const move = () => selectStep(aux.targetStepId);
      group.addEventListener('click',e=>{e.stopPropagation();move();});group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();move();}});
    }
    for (const [id, aux] of Object.entries(meta.auxiliaryEdges || {})) {
      const group = elementFor(id); if (!group || !aux.targetStepId) continue;
      group.dataset.wfAux = id; group.setAttribute('role','button'); group.setAttribute('tabindex','0');
      group.setAttribute('aria-label','이어진 단계로 이동');
      group.addEventListener('click',e=>{e.stopPropagation();selectStep(aux.targetStepId);});group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectStep(aux.targetStepId);}});
    }
    setSize(); requestAnimationFrame(readSize);
    setStatus(modes[mode] + ' · 단계를 선택하면 입력 · 행동 · 산출물 · 규칙을 읽을 수 있습니다.');
  }
  function focus(id) {
    if (!svg) return;
    const data = modeData(), steps = new Set(data.steps.map(s => s.id)), flows = new Set((data.flows || []).map(f => f.id));
    const direct = (data.flows || []).filter(f => f.source === id || f.target === id), active = new Set([id, ...direct.flatMap(f => [f.id, f.source, f.target])]);
    const meta = bundle.diagramMeta?.diagrams?.[assetKey()] || {};
    for (const [auxId, aux] of Object.entries(meta.auxiliaryNodes || {})) { steps.add(auxId); if(active.has(aux.targetStepId))active.add(auxId); }
    for (const [auxId, aux] of Object.entries(meta.auxiliaryEdges || {})) { flows.add(auxId); if(active.has(aux.targetStepId))active.add(auxId); }
    for (const g of svg.querySelectorAll('[data-element-id]')) { const raw = g.dataset.elementId, base = raw.endsWith('_label') ? raw.slice(0, -6) : raw; if (!steps.has(base) && !flows.has(base)) continue; g.classList.toggle('wf-muted', !!id && !active.has(base)); g.classList.toggle('wf-related', !!id && active.has(base)); g.classList.toggle('wf-selected', base === id); }
  }
  function selectStep(id, navigate = true) {
    const data = modeData(), s = data?.steps?.find(s => s.id === id); if (!s) return false;
    stepId = id; $('wf-panel').hidden = false; $('wf-panel').scrollTop = 0; $('wf-panel-mode').textContent = modes[mode] + ' · Step';
    $('wf-step-crumb').textContent = '› ' + s.name; const body = $('wf-step-detail'); body.replaceChildren(el('h2', s.name));
    const phase = s.phase || current.phase; if (phase) body.append(el('span', lines(phase), 'wf-phase'));
    const dl = el('dl');
    for (const [key, raw] of [['담당',s.actor],['입력값',s.input],['하는 일',s.action],['산출물',s.output],['업무 규칙',s.rules],['관련 기능',s.functionIds]]) { dl.append(el('dt',key),el('dd',lines(raw)||'—')); }
    body.append(dl);
    for(const questionId of s.approvedQuestionIds||[]){const question=(model.questionsApproved||[]).find(q=>q.id===questionId);if(!question?.text)continue;const note=el('section',undefined,'customer-question-note');note.dataset.approvedQuestion=question.id;note.append(el('strong',question.label),el('p',question.text),el('small',question.status||''));body.append(note);}
    focus(id); $('wf-results').hidden = true;
    if (navigate) requestAnimationFrame(() => { if (zoom < .7) { zoom = 1; setSize(); } const c = nodeCenter(id); if (c) center(c.x, c.y); });
    requestAnimationFrame(updateRoles); hash(); setStatus(modes[mode] + ' · ' + s.name); return true;
  }
  function clearStep() { stepId = null; $('wf-panel').hidden = true; $('wf-step-crumb').textContent = ''; focus(null); requestAnimationFrame(updateRoles); hash(); }
  function renderCompare() {
    const body = $('wf-compare'); body.replaceChildren();
    for (const [i, c] of (current.comparisons || []).entries()) {
      const card = el('article', undefined, 'wf-change'); card.append(el('h2', (i + 1) + '. ' + c.change));
      if (c.reason) card.append(el('p', c.reason)); const pair = el('div', undefined, 'wf-change-pair');
      for (const [which, ids] of [['asis',c.asisStepIds],['tobe',c.tobeStepIds]]) { const part = el('div'); part.append(el('h3',modes[which])); for (const id of ids || []) { const step = current[which]?.steps?.find(s=>s.id===id); if (!step) continue; const b = el('button',step.name,'wf-step-link'); b.disabled=!!current[which]?.steps?.length&&!assets[current.id+'-'+which]?.svg; b.onclick = () => open(current.id,which,id); part.append(b); } if (part.children.length===1) part.append(el('p',which==='asis'?'현행 대응 단계 없음':'기존 업무 유지')); pair.append(part); }
      card.append(pair); if(c.phase) card.append(el('span',lines(c.phase),'wf-phase')); if(c.functionIds?.length) card.append(el('p','관련 기능 · '+c.functionIds.join(', '))); body.append(card);
    }
    for (const note of current.routeNotes || []) { const card=el('article',undefined,'wf-change');card.append(el('h2','업무 경로별 적용'),el('p',note.text));body.append(card); }
    setStatus('단계 이름을 누르면 해당 현재 또는 도입 후 Step으로 이동합니다.');
  }
  function updateEntries() {
    const node = window.artworkReader?.selected(); const host = document.querySelector('#detail-content .business-detail');
    if (!host || host.querySelector('.workflow-entry-section')) return;
    const aliases=new Set([node,...(overallNodes.get(node)?.includedNodeIds||[])]);const matches = [...workflows.values()].filter(w => w.parentNodeIds?.some(id=>aliases.has(id)));  if (!matches.length) return;
    const section = el('section',undefined,'workflow-entry-section'); section.append(el('h3','관련 Workflow'));
    for (const w of matches) { const b = el('button',w.title,'workflow-entry'); b.dataset.workflow = w.id; b.append(el('small','현재 업무 · 도입 후 업무 · 변경점과 기능')); b.onclick=()=>open(w.id); section.append(b); } host.prepend(section);
  }
  document.addEventListener('reader:selection',updateEntries); new MutationObserver(updateEntries).observe($('detail-content'),{childList:true,subtree:true}); updateEntries();
  for(const key of Object.keys(modes)) $('wf-tab-'+key).onclick=()=>open(current.id,key);
  $('wf-back').onclick=back; $('wf-crumb').onclick=()=>mode==='compare'?open(current.id,'asis'):clearStep(); $('wf-close-step').onclick=clearStep;
  $('wf-choose').onchange=()=>open($('wf-choose').value,mode);
  $('wf-fit').onclick=()=>{if(svg){const v=$('wf-viewport');zoom=Math.min(v.clientWidth/box[2],v.clientHeight/box[3])*.94;setSize();v.scrollTo(0,0);}};
  $('wf-read').onclick=readSize;$('wf-plus').onclick=()=>scale(zoom*1.2);$('wf-minus').onclick=()=>scale(zoom/1.2);
  $('wf-search').oninput=()=>{const q=$('wf-search').value.trim().toLowerCase(),body=$('wf-results');body.replaceChildren();body.hidden=!q;if(!q)return;const found=(modeData()?.steps||[]).filter(s=>[s.name,s.actor,s.input,s.action,s.output,...(s.rules||[])].join(' ').toLowerCase().includes(q));body.append(el('p',found.length+'개 단계'));for(const s of found){const b=el('button',s.name);b.append(el('small',s.actor||''));b.onclick=()=>selectStep(s.id);body.append(b);}};
  $('wf-search').onkeydown=e=>{if(e.key==='Enter')$('wf-results').querySelector('button')?.click();if(e.key==='Escape')$('wf-results').hidden=true;};
  $('wf-download').onclick=()=>{const xml=xmlAsset();if(!xml)return;const url=URL.createObjectURL(new Blob([xml],{type:'application/xml;charset=utf-8'})),a=el('a');a.href=url;a.download=assetKey()+'.bpmn';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);setStatus('현재 선택한 '+modes[mode]+' BPMN을 내려받습니다.');};
  $('wf-edit').onclick=()=>{const target=new URL('./editor/',location.href);target.searchParams.set('v','flow-4');target.searchParams.set('xml','../workflows/'+assetKey()+'.bpmn');target.searchParams.set('return',location.hash.slice(1));if(stepId)target.hash=new URLSearchParams({node:stepId});saveReturn();location.assign(target.href);};
  let drag=null,suppress=0;const viewport=$('wf-viewport');viewport.addEventListener('scroll',updateRoles,{passive:true});window.addEventListener('resize',updateRoles);new ResizeObserver(updateRoles).observe(viewport);
  viewport.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||e.button!==0)return;suppress=0;drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,moved:false};});
  window.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;if(!(e.buttons&1)){finish(e);return;}const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<5)return;if(!drag.moved){drag.moved=true;viewport.setPointerCapture(e.pointerId);viewport.classList.add('is-dragging');}e.preventDefault();viewport.scrollLeft=drag.left-dx;viewport.scrollTop=drag.top-dy;});
  function finish(e){if(!drag||e.pointerId!==drag.id)return;if(drag.moved)suppress=performance.now()+250;const id=drag.id;drag=null;viewport.classList.remove('is-dragging');if(viewport.hasPointerCapture(id))viewport.releasePointerCapture(id);}
  window.addEventListener('pointerup',finish);viewport.addEventListener('pointercancel',finish);viewport.addEventListener('lostpointercapture',finish);
  viewport.addEventListener('click',e=>{if(performance.now()<suppress){e.preventDefault();e.stopImmediatePropagation();}},true);
  function closestEdge(event) {
    let best=null,bestDistance=13;
    for(const group of svg?.querySelectorAll('.djs-connection[data-element-id]')||[]){
      const path=group.querySelector('.djs-visual>path');if(!path)continue;
      const bounds=path.getBoundingClientRect();if(event.clientX<bounds.left-13||event.clientX>bounds.right+13||event.clientY<bounds.top-13||event.clientY>bounds.bottom+13)continue;
      const matrix=path.getScreenCTM(),length=path.getTotalLength();let previous=null;
      for(let d=0;d<=length+8;d+=8){const point=path.getPointAtLength(Math.min(d,length)),p={x:point.x*matrix.a+point.y*matrix.c+matrix.e,y:point.x*matrix.b+point.y*matrix.d+matrix.f};
        if(previous){const dx=p.x-previous.x,dy=p.y-previous.y,t=Math.max(0,Math.min(1,((event.clientX-previous.x)*dx+(event.clientY-previous.y)*dy)/(dx*dx+dy*dy||1))),distance=Math.hypot(event.clientX-(previous.x+t*dx),event.clientY-(previous.y+t*dy));if(distance<bestDistance){bestDistance=distance;best=group.dataset.elementId;}}
        previous=p;
      }
    }return best;
  }
  viewport.addEventListener('click',event=>{
    if(event.detail===0||!svg||event.target.closest('[data-wf-step]')||event.target.closest('[data-wf-aux].djs-shape'))return;
    const label=event.target.closest('[data-element-id]')?.dataset.elementId;if(label?.endsWith('_label'))return;
    const id=closestEdge(event);if(!id)return;
    const edge=modeData().flows.find(f=>f.id===id),aux=bundle.diagramMeta?.diagrams?.[assetKey()]?.auxiliaryEdges?.[id];
    if(!edge&&!aux)return;event.preventDefault();event.stopImmediatePropagation();selectStep(aux?.targetStepId||(stepId===edge.target?edge.source:edge.target));
  },true);
  viewport.addEventListener('click',e=>{if(!e.target.closest('[data-wf-step],[data-wf-edge],[data-wf-aux]'))clearStep();});
  function restore(){const p=params();if(p.has('workflow')){if(!returnView){try{const saved=JSON.parse(sessionStorage.getItem('artwork-workflow-return-v4')||'null');returnView=saved?.view;parentId=p.get('parent')||saved?.parentId;}catch{parentId=p.get('parent');}}open(p.get('workflow'),p.get('mode')||'asis',p.get('step'),{restore:true,history:false,parent:p.get('parent')});}else if(!shell.hidden){shell.hidden=true;document.body.classList.remove('workflow-open');setOverallInert(false);current=null;if(returnView)requestAnimationFrame(()=>window.artworkReader.setView?.(returnView));}}
  window.addEventListener('hashchange',restore);window.addEventListener('popstate',restore);
  window.workflowReader={open,selectStep,back,getState:()=>({workflow:current?.id,mode,step:stepId,parent:parentId,zoom}),catalog};
  window.workflowReaderReady=true;restore();
})();
