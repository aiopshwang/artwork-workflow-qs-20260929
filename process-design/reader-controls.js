(() => {
  'use strict';
  const viewport = document.getElementById('viewport');
  let drag = null;
  let suppressClickUntil = 0;

  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    suppressClickUntil = 0;
    const box = viewport.getBoundingClientRect();
    // Keep the native scrollbars usable.
    if (event.clientX - box.left >= viewport.clientWidth ||
        event.clientY - box.top >= viewport.clientHeight) return;
    drag = {
      id: event.pointerId,
      x: event.clientX, y: event.clientY,
      left: viewport.scrollLeft, top: viewport.scrollTop,
      moved: false,
    };
  });

  window.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) { finish(event); return; }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    }
    event.preventDefault();
    viewport.scrollLeft = drag.left - dx;
    viewport.scrollTop = drag.top - dy;
  });

  function finish(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.moved) suppressClickUntil = performance.now() + 250;
    const id = drag.id;
    drag = null;
    viewport.classList.remove('is-dragging');
    if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  }
  window.addEventListener('pointerup', finish);
  viewport.addEventListener('pointercancel', finish);
  viewport.addEventListener('lostpointercapture', finish);
  viewport.addEventListener('click', event => {
    // Dragging over a task should move the page, not open its description.
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.getElementById('edit-workflow').addEventListener('click', () => {
    const target = new URL('./editor/', location.href);
    target.searchParams.set('v', new URLSearchParams(location.search).get('v') || 'flow-6');
    const node = new URLSearchParams(location.hash.slice(1)).get('node');
    if (node) target.hash = new URLSearchParams({ node }).toString();
    location.assign(target.href);
  });
})();

// Reading aids only. The embedded BPMN / SVG / business model remain unchanged.
(() => {
  'use strict';
  const data = document.getElementById('model-data');
  const svg = document.querySelector('#map > svg');
  const panel = document.getElementById('detail-content');
  if (!data || !svg || !panel) return;
  const jumps = window.ArtworkLineJumps.install(svg);
  const model = JSON.parse(data.textContent);
  const approvedQuestions = new Map((model.questionsApproved || []).map(question => [question.id, question]));
  const nodes = new Map(model.pools.flatMap(pool => pool.nodes.map(node => [node.id, { ...node, pool: pool.name }])));
  const sequence = model.pools.flatMap(pool => pool.edges || []);
  const messages = model.messageFlows || [];
  const related = model.associations || [];
  const isReturn = edge => edge.kind === 'return';
  const normal = sequence.filter(edge => !isReturn(edge));
  const returns = sequence.filter(isReturn);
  const clean = text => String(text || '').replace(/\n/g, ' ');
  const allEdges = [...sequence, ...messages, ...related];
  const allEdgeIds = new Set(allEdges.map(edge => edge.id));
  function sequenceRelations(id, incoming) {
    const direct = sequence.filter(edge => incoming ? edge.target === id : edge.source === id);
    return direct.flatMap(edge => {
      const middle = nodes.get(incoming ? edge.source : edge.target);
      if (middle?.gatewayDirection !== 'Converging') return [{ ...edge, path: [edge.id] }];
      const beyond = sequence.filter(next => incoming ? next.target === middle.id : next.source === middle.id);
      if (!beyond.length) return [{ ...edge, path: [edge.id] }];
      return beyond.map(next => {
        const ordered = incoming ? [next, edge] : [edge, next];
        return {
          id: ordered.map(part => part.id).join(' '),
          source: incoming ? next.source : id,
          target: incoming ? id : next.target,
          name: [...new Set(ordered.map(part => part.name).filter(Boolean))].join(' · '),
          kind: ordered.some(isReturn) ? 'return' : undefined,
          returnReason: [...new Set(ordered.map(part => part.returnReason).filter(Boolean))].join(' · '),
          path: ordered.map(part => part.id), via: middle.id,
        };
      });
    });
  }

  function focusSelection(id) {
    const direct = [...messages, ...related].filter(edge => edge.source === id || edge.target === id);
    const business = [...sequenceRelations(id, true), ...sequenceRelations(id, false)];
    const activeEdges = new Set([...direct.map(edge => edge.id), ...business.flatMap(edge => edge.path)]);
    const activeNodes = new Set(id ? [id, ...direct.flatMap(edge => [edge.source, edge.target]), ...business.flatMap(edge => [edge.source, edge.target, edge.via].filter(Boolean))] : []);
    for (const group of svg.querySelectorAll('[data-element-id]')) {
      const rawId = group.getAttribute('data-element-id');
      const elementId = rawId.endsWith('_label') ? rawId.slice(0, -6) : rawId;
      const isTask = nodes.has(elementId), isEdge = allEdgeIds.has(elementId);
      if (!isTask && !isEdge) continue;
      const active = isTask ? activeNodes.has(elementId) : activeEdges.has(elementId);
      group.classList.toggle('reader-muted-element', !!id && !active);
      group.classList.toggle('reader-related-element', !!id && active);
      group.classList.toggle('reader-selected-element', !!id && elementId === id);
      if (isEdge && group.hasAttribute('data-reader-edge')) group.setAttribute('tabindex', !id || active ? '0' : '-1');
    }
    jumps.schedule();
  }
  function clearSelection() {
    if (window.artworkReader?.clear) { window.artworkReader.clear(); return; }
    document.getElementById('close-detail').click();
    document.getElementById('reader-highlight')?.setAttribute('hidden', '');
    focusSelection(null);
    const url = new URL(location.href);
    const params = new URLSearchParams(url.hash.slice(1));
    params.delete('node');
    url.hash = params.toString();
    history.replaceState(null, '', url);
  }
  document.getElementById('viewport').addEventListener('click', event => {
    const labelId = event.target.closest('[data-element-id]')?.getAttribute('data-element-id');
    if (labelId?.endsWith('_label') && nodes.has(labelId.slice(0, -6))) { navigate(labelId.slice(0, -6)); return; }
    if (event.target.closest('[data-reader-node], .djs-connection')) return;
    clearSelection();
  });
  document.getElementById('close-detail').addEventListener('click', () => {
    document.getElementById('reader-highlight')?.setAttribute('hidden', '');
    focusSelection(null);
  });
  new MutationObserver(() => {
    const selected = document.getElementById('map').classList.contains('flow-focused')
      ? new URLSearchParams(location.hash.slice(1)).get('node') : null;
    focusSelection(selected);
  }).observe(document.getElementById('map'), { attributes: true, attributeFilter: ['class'] });

  function make(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  const elements = new Map([...svg.querySelectorAll('[data-element-id]')].map(element => [element.getAttribute('data-element-id'), element]));
  function decorate(list, kind, label) {
    for (const edge of list) {
      const group = elements.get(edge.id);
      if (!group) continue;
      group.classList.add('reader-flow-' + kind);
      group.dataset.flowKind = kind;
      const edgeLabel = elements.get(edge.id + '_label');
      if (edgeLabel) edgeLabel.classList.add('reader-flow-label-' + kind);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = label + (edge.name ? ' · ' + edge.name : '') + '\n' + clean(nodes.get(edge.source)?.name) + ' → ' + clean(nodes.get(edge.target)?.name);
      group.prepend(title);
    }
  }
  decorate(normal, 'sequence', '업무 순서');
  decorate(messages, 'message', '회사 간 자료 전달');
  decorate(returns, 'return', '수정 후 복귀');
  decorate(related, 'related', '관련 확인 · 진행 순서가 아님');

  const legend = make('section', undefined, 'reader-flow-legend');
  legend.setAttribute('aria-label', '연결선 읽는 법');
  const types = [
    ['sequence', '업무 순서', '실선 화살표를 따라 다음 업무로 진행합니다.'],
    ['message', '회사 간 자료 전달', '파란 점선은 다른 회사와 주고받는 자료입니다. 다음 업무의 순서와 구분해서 봅니다.'],
    ['return', '수정 후 복귀', '주황 실선은 수정 후 앞선 검토나 업무로 돌아가는 경로입니다.'],
  ];
  if (related.length) types.push(['related', '관련 확인', '회색 점선은 함께 확인할 관계이며 업무 순서가 아닙니다.']);
  for (const [kind, text, description] of types) {
    const item = make('div', undefined, 'flow-legend-item');
    const sample = make('span', undefined, 'flow-legend-line flow-legend-' + kind);
    sample.setAttribute('aria-hidden', 'true');
    item.append(sample, make('span', text));
    item.title = description;
    legend.append(item);
  }
  const help = make('span', '연결선을 누르면 이어진 업무로 이동합니다. 교차점의 작은 끊김은 서로 연결되지 않았다는 뜻입니다.', 'flow-legend-help');
  legend.append(help);
  document.getElementById('hint').after(legend);

  function navigate(id) {
    if (window.artworkReader?.select) { window.artworkReader.select(id); return; }
    const hash = new URLSearchParams({ node: id }).toString();
    if (location.hash.slice(1) === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = hash;
  }
  function plainValue(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join('\n');
    return value === undefined || value === null ? '' : String(value);
  }
  function supportLabel(support) {
    return support.phase === 'Phase 2' ? 'Phase 2 개발' : support.label || '솔루션 지원';
  }
  function updatePanel() {
    const id = window.artworkReader?.selected?.() || new URLSearchParams(location.hash.slice(1)).get('node');
    const node = nodes.get(id);
    if (!node || panel.querySelector('[data-six-fields]')) return;
    if (!panel.querySelector(':scope > .actor')) return;
    focusSelection(id);
    const copy = panel.querySelector(':scope > .node-link');
    const wrapper = make('div', undefined, 'business-detail');
    wrapper.dataset.sixFields = id;
    const list = make('dl', undefined, 'business-fields');
    const fields = [
      ['담당', node.actor || node.pool], ['업무명', node.name], ['업무 설명', node.description],
      ['입력값', node.inputs], ['산출물', node.outputs], ['업무 규칙', node.businessRules],
    ];
    for (const [label, raw] of fields) {
      const row = make('div', undefined, 'business-field');
      row.dataset.businessField = label;
      row.append(make('dt', label));
      const value = plainValue(raw);
      const content = make('dd', value || '—', value ? '' : 'not-recorded');
      if (label === '업무명') content.classList.add('business-name');
      row.append(content); list.append(row);
    }
    wrapper.append(list);
    for (const questionId of node.approvedQuestionIds || []) {
      const question = approvedQuestions.get(questionId);
      if (!question?.text) continue;
      const note = make('section', undefined, 'customer-question-note');
      note.dataset.approvedQuestion = question.id;
      note.append(make('strong', question.label || '고객사 질문'));
      note.append(make('p', question.text));
      if (question.status) note.append(make('small', question.status));
      wrapper.append(note);
    }
    if (node.solutionSupport) {
      const note = make('section', undefined, 'solution-note');
      note.append(make('strong', supportLabel(node.solutionSupport)));
      if (node.solutionSupport.description) note.append(make('p', node.solutionSupport.description));
      note.append(make('small', node.solutionSupport.phase === 'Phase 2' ? 'Phase 2 개발 범위입니다. 구현 완료를 뜻하지 않습니다.' : '기존 설계에 정의된 지원 범위입니다. 구현 완료를 뜻하지 않습니다.'));
      wrapper.append(note);
    }
    wrapper.append(make('p', '이어진 업무는 순서도의 연결선을 눌러 볼 수 있습니다.', 'edge-navigation-note'));
    panel.replaceChildren(wrapper);
    if (copy) panel.append(copy);
  }
  function moveAlongEdge(edge) {
    const selected = window.artworkReader?.selected?.() ||
      (document.getElementById('map').classList.contains('flow-focused') ? new URLSearchParams(location.hash.slice(1)).get('node') : null);
    const target = selected === edge.target ? edge.source : edge.target;
    if (!nodes.has(target)) return;
    navigate(target);
    requestAnimationFrame(() => {
      document.querySelector('[data-reader-node="' + CSS.escape(target) + '"]')?.focus({ preventScroll: true });
    });
  }
  for (const edge of allEdges) {
    const group = elements.get(edge.id);
    if (!group) continue;
    const targets = [group, elements.get(edge.id + '_label')].filter(Boolean);
    for (const target of targets) {
      target.dataset.readerEdge = edge.id;
      target.setAttribute('tabindex', '0');
      target.setAttribute('role', 'button');
      target.setAttribute('aria-label', clean(edge.name || '연결선') + '. ' + clean(nodes.get(edge.source)?.name) + '에서 ' + clean(nodes.get(edge.target)?.name) + '로 연결. 선택 업무와 이어진 선이면 반대편 업무로, 그 외에는 화살표 도착 업무로 이동합니다.');
      target.addEventListener('click', event => { event.stopPropagation(); moveAlongEdge(edge); });
      target.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); moveAlongEdge(edge); }
      });
    }
  }
  document.getElementById('viewport').addEventListener('click', event => {
    if(event.detail===0||event.target.closest('.djs-shape'))return;
    const id=event.target.closest('[data-element-id]')?.dataset.elementId;
    if(id?.endsWith('_label'))return;
    const edgeId=jumps.pickEdge(event),edge=allEdges.find(e=>e.id===edgeId);
    if(edge){event.preventDefault();event.stopImmediatePropagation();moveAlongEdge(edge);}
  },true);
  const ns = 'http://www.w3.org/2000/svg';
  function svgNode(tag, attrs) { const element = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value)); return element; }
  for (const node of nodes.values()) {
    const group = elements.get(node.id), visual = group?.querySelector(':scope > .djs-visual');
    if (!visual) continue;
    if (node.gatewayMeaning && visual.querySelector(':scope > polygon')) {
      group.classList.add('reader-korean-gateway');
      const words = node.gatewayMeaning.includes('\n') ? node.gatewayMeaning.split('\n') : node.gatewayMeaning.split(' ');
      const lines = words.length > 2 ? [words.slice(0,-1).join(''), words.at(-1)] : words;
      const text = svgNode('text', { x: node.w / 2, y: node.h / 2 - (lines.length - 1) * 6 + 4, 'text-anchor': 'middle', class: 'reader-gateway-meaning' });
      lines.forEach((line, i) => { const span = svgNode('tspan', { x: node.w / 2, dy: i ? 12 : 0 }); span.textContent = line; text.append(span); });
      visual.append(text);
      const title = svgNode('title', {}); title.textContent = node.gatewayExplanation || node.gatewayMeaning; group.prepend(title);
      group.setAttribute('aria-label', clean(node.name) + '. ' + (node.gatewayExplanation || node.gatewayMeaning));
    }
    if (node.solutionSupport && /Task$|task$/i.test(node.type)) {
      const label = supportLabel(node.solutionSupport);
      const badge = svgNode('g', { class: 'reader-solution-mark', 'aria-label': label });
      badge.append(svgNode('rect', { x: Math.max(7, node.w - 86), y: -28, width: 78, height: 17, rx: 4 }));
      const text = svgNode('text', { x: Math.max(7, node.w - 86) + 39, y: -16, 'text-anchor': 'middle' }); text.textContent = label; badge.append(text); visual.append(badge);
    }
  }
  document.addEventListener('reader:selection', event => { focusSelection(event.detail.id); if (event.detail.id) updatePanel(); });
  new MutationObserver(updatePanel).observe(panel, { childList: true, subtree: true });
  updatePanel();
})();
