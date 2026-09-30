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

  viewport.addEventListener('pointermove', event => {
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
  const model = JSON.parse(data.textContent);
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
    }
  }
  function clearSelection() {
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
  const help = make('span', '업무를 누르면 순서와 자료 전달을 나누어 보여줍니다.', 'flow-legend-help');
  legend.append(help);
  document.getElementById('hint').after(legend);

  function navigate(id) {
    const hash = new URLSearchParams({ node: id }).toString();
    if (location.hash.slice(1) === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = hash;
  }
  function link(edge, targetId, kind, direction) {
    const target = nodes.get(targetId);
    if (!target) return null;
    const button = make('button', undefined, 'neighbor flow-neighbor flow-neighbor-' + kind);
    button.dataset.edgeId = edge.id;
    button.dataset.flowKind = kind;
    button.dataset.targetNode = targetId;
    const prefix = kind === 'message'
      ? (direction === 'incoming' ? '보내는 곳' : '받는 곳')
      : kind === 'return' ? (direction === 'incoming' ? '이 업무로 돌아오는 경로' : '돌아갈 업무') : '';
    if (edge.name) button.append(make('strong', edge.name));
    if (kind === 'return' && edge.returnReason && edge.returnReason !== edge.name) button.append(make('span', edge.returnReason, 'flow-return-reason'));
    if (prefix) button.append(make('span', prefix + ' · ' + (target.actor || target.pool), 'flow-counterpart'));
    button.append(make('span', clean(target.name), 'flow-task-name'));
    if (!prefix) button.append(make('small', target.actor || target.pool));
    if (kind === 'message') button.append(make('small', '자료를 주고받는 업무 위치 보기'));
    else if (edge.via) button.append(make('small', '합류 지점을 거쳐 연결된 업무'));
    button.onclick = () => navigate(targetId);
    return button;
  }
  function section(wrapper, title, items, kind, incoming) {
    if (!items.length) return;
    const box = make('section', undefined, 'field flow-section flow-section-' + kind);
    box.dataset.flowSection = kind;
    box.append(make('h3', title));
    for (const edge of items) {
      const button = link(edge, incoming ? edge.source : edge.target, kind, incoming ? 'incoming' : 'outgoing');
      if (button) box.append(button);
    }
    wrapper.append(box);
  }
  function textSection(wrapper, title, text) {
    if (!text || !String(text).trim()) return;
    const box = make('section', undefined, 'field flow-material-field');
    box.append(make('h3', title), make('p', text));
    wrapper.append(box);
  }
  function updatePanel() {
    // The native reader owns the selected task and all navigation. This layer only
    // replaces its mixed relationship list after that task has finished rendering.
    const id = new URLSearchParams(location.hash.slice(1)).get('node');
    const node = nodes.get(id);
    if (!node || !panel.querySelector(':scope > .actor')) return;
    focusSelection(id);
    if (panel.querySelector('[data-connection-details]')) return;
    const mixedHeadings = new Set([
      '받는 자료', '앞 업무에서 전달하는 자료', '다음 업무에 전달할 자료와 확인 결과',
      '앞 업무 · 받는 흐름', '다음 업무 · 전달하는 흐름',
    ]);
    for (const old of panel.querySelectorAll(':scope > .field')) {
      if (mixedHeadings.has(old.querySelector('h3')?.textContent)) old.remove();
    }
    const incoming = sequenceRelations(id, true), outgoing = sequenceRelations(id, false);
    const wrapper = make('div', undefined, 'flow-details');
    wrapper.dataset.connectionDetails = id;
    textSection(wrapper, '이 업무에서 사용하는 자료', node.inputs);
    if (!node.inputs) {
      const previous = [...new Set(incoming.filter(edge => !isReturn(edge)).map(edge => edge.source))]
        .map(source => nodes.get(source)).filter(source => source?.outputs);
      textSection(wrapper, '앞 업무의 결과물', previous.map(source => clean(source.name) + '\n' + source.outputs).join('\n\n'));
    }
    textSection(wrapper, '이 업무의 결과물', node.outputs);
    section(wrapper, '앞 업무 · 업무 순서', incoming.filter(edge => !isReturn(edge)), 'sequence', true);
    section(wrapper, '다음 업무 · 업무 순서', outgoing.filter(edge => !isReturn(edge)), 'sequence', false);
    section(wrapper, '수정 후 이 업무로 돌아옴', incoming.filter(isReturn), 'return', true);
    section(wrapper, '수정 후 돌아갈 업무', outgoing.filter(isReturn), 'return', false);
    section(wrapper, '받는 자료 · 회사 간 전달', messages.filter(edge => edge.target === id), 'message', true);
    section(wrapper, '보내는 자료 · 회사 간 전달', messages.filter(edge => edge.source === id), 'message', false);
    const associations = related.filter(edge => edge.target === id || edge.source === id);
    if (associations.length) {
      const box = make('section', undefined, 'field flow-section flow-section-related');
      box.dataset.flowSection = 'related';
      box.append(make('h3', '관련 확인 · 업무 순서가 아님'));
      for (const edge of associations) {
        const button = link(edge, edge.source === id ? edge.target : edge.source, 'related');
        if (button) box.append(button);
      }
      wrapper.append(box);
    }
    panel.insertBefore(wrapper, panel.querySelector(':scope > .node-link'));
  }
  new MutationObserver(updatePanel).observe(panel, { childList: true, subtree: true });
  updatePanel();
})();
