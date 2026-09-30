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
