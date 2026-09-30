/* Rendering only: no BPMN topology, DI waypoint, path or hit-area changes.
   Shared verbatim by the overall reader, Workflow reader and bpmn-js editor. */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', instances = new WeakMap();
  let serial = 0;
  function element(tag, attrs) { const e = document.createElementNS(NS, tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; }
  function pointsFromPath(path) {
    const d = path?.getAttribute('d') || '';
    if (/[ACHQSTVZ]/i.test(d)) return null;
    const values = d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/ig)?.map(Number) || [];
    if (values.length < 4 || values.length % 2) return null;
    return values.reduce((a, n, i) => { if (!(i % 2)) a.push({x:n,y:values[i+1]}); return a; }, []);
  }
  function flattenVisual(path) {
    // bpmn-js rounded routes use absolute M/L/C; sample only their short curves.
    const tokens=(path.getAttribute('d')||'').match(/[MLC]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/ig)||[];
    if(/[AHQSTVZ]/i.test(path.getAttribute('d')||''))return [];
    let i=0,p=null;const segments=[];
    while(i<tokens.length){const command=tokens[i++].toUpperCase();
      if(command==='M'){p={x:+tokens[i++],y:+tokens[i++]};continue;}
      if(command==='L'){const q={x:+tokens[i++],y:+tokens[i++]};if(p)segments.push({a:p,b:q});p=q;continue;}
      if(command==='C'){const p0=p,p1={x:+tokens[i++],y:+tokens[i++]},p2={x:+tokens[i++],y:+tokens[i++]},p3={x:+tokens[i++],y:+tokens[i++]};
        for(let n=1;n<=12;n++){const t=n/12,u=1-t,q={x:u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,y:u*u*u*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*p3.y};segments.push({a:p,b:q});p=q;}continue;
      }return [];
    }return segments;
  }
  function intersection(a,b){const rx=a.b.x-a.a.x,ry=a.b.y-a.a.y,sx=b.b.x-b.a.x,sy=b.b.y-b.a.y,cross=rx*sy-ry*sx;if(Math.abs(cross)<1e-8)return null;const qx=b.a.x-a.a.x,qy=b.a.y-a.a.y,t=(qx*sy-qy*sx)/cross,u=(qx*ry-qy*rx)/cross;if(t<0||t>1||u<0||u>1)return null;return{x:a.a.x+t*rx,y:a.a.y+t*ry};}
  function rank(g) {
    if (g.classList.contains('reader-muted-element') || g.classList.contains('wf-muted')) return -1;
    if (g.classList.contains('reader-related-element') || g.classList.contains('wf-related') || g.classList.contains('linked-edge')) return 1;
    if (g.closest('.flow-focus')) return -1;
    return 0;
  }
  function install(svg, options = {}) {
    if (!svg) return null;
    if (instances.has(svg)) return instances.get(svg);
    const prefix = 'artwork-crossing-' + (++serial), radius = 5.5;
    let frame = null, disposed = false, touched = [], stats = {}, rendered = [];
    const defs = element('defs', {'data-line-jumps':prefix}); svg.prepend(defs);
    function clearMasks() { for (const [path, previous] of touched) { if (previous === null) path.removeAttribute('mask'); else path.setAttribute('mask', previous); } touched = []; defs.replaceChildren(); }
    function update() {
      if (disposed) return stats;
      clearMasks();
      const connections = [];
      for (const group of svg.querySelectorAll('.djs-connection[data-element-id]')) {
        const path = group.querySelector(':scope > .djs-visual > path');
        const hit = group.querySelector(':scope > path.djs-hit-stroke, :scope > path.djs-hit');
        const id = group.getAttribute('data-element-id');
        const points = options.points?.(id) || pointsFromPath(hit) || pointsFromPath(path);
        if (!path || !points || points.length < 2) continue;
        const segments = [];
        for (let i=1;i<points.length;i++) {
          const a=points[i-1],b=points[i], dx=b.x-a.x,dy=b.y-a.y;
          if (Math.abs(dx)<.05 && Math.abs(dy)>.05) segments.push({a,b,axis:'v',min:Math.min(a.y,b.y),max:Math.max(a.y,b.y)});
          else if (Math.abs(dy)<.05 && Math.abs(dx)>.05) segments.push({a,b,axis:'h',min:Math.min(a.x,b.x),max:Math.max(a.x,b.x)});
        }
        connections.push({id,group,path,points,segments,rank:rank(group),cuts:[],visualSegments:null});
      }
      const crossings=[], nearBends=[], overlaps=[], sharedEndpoints=[];
      function addCrossing(a,b,x,y,vertical,rounded=false){
        if(crossings.some(c=>c.a===a.id&&c.b===b.id&&Math.hypot(c.x-x,c.y-y)<.5))return;
        const under=a.rank!==b.rank?(a.rank<b.rank?a:b):vertical,over=under===a?b:a;
        const crossing={a:a.id,b:b.id,under:under.id,over:over.id,x,y,radius,rounded};under.cuts.push(crossing);crossings.push(crossing);
      }
      const seen=new Set();
      for(let i=0;i<connections.length;i++) for(let j=i+1;j<connections.length;j++) {
        const a=connections[i],b=connections[j];
        for(const sa of a.segments) for(const sb of b.segments) {
          if(sa.axis===sb.axis) {
            const coordinate=s=>s.axis==='h'?s.a.y:s.a.x;
            const overlap=Math.min(sa.max,sb.max)-Math.max(sa.min,sb.min);
            if(Math.abs(coordinate(sa)-coordinate(sb))<.05 && overlap>1) overlaps.push({a:a.id,b:b.id,length:overlap});
            continue;
          }
          const h=sa.axis==='h'?sa:sb,v=sa.axis==='v'?sa:sb,x=v.a.x,y=h.a.y;
          if(x<h.min-.05||x>h.max+.05||y<v.min-.05||y>v.max+.05)continue;
          const key=[a.id,b.id,x.toFixed(2),y.toFixed(2)].join('|');if(seen.has(key))continue;seen.add(key);
          // A shared dock/real join is connectivity, not a crossing. Never cut it.
          const endpoint=c=>[c.points[0],c.points.at(-1)].some(p=>Math.hypot(p.x-x,p.y-y)<.1);
          if(endpoint(a)||endpoint(b)){sharedEndpoints.push({a:a.id,b:b.id,x,y});continue;}
          const clearance=Math.min(x-h.min,h.max-x,y-v.min,v.max-y);
          if(clearance<radius+1){
            let rendered=0;a.visualSegments||=flattenVisual(a.path);b.visualSegments||=flattenVisual(b.path);
            const nearby=s=>Math.min(s.a.x,s.b.x)<=x+12&&Math.max(s.a.x,s.b.x)>=x-12&&Math.min(s.a.y,s.b.y)<=y+12&&Math.max(s.a.y,s.b.y)>=y-12;
            for(const av of a.visualSegments.filter(nearby))for(const bv of b.visualSegments.filter(nearby)){const p=intersection(av,bv);if(p&&Math.hypot(p.x-x,p.y-y)<12){addCrossing(a,b,p.x,p.y,sa.axis==='v'?a:b,true);rendered++;}}
            nearBends.push({a:a.id,b:b.id,x,y,clearance,roundedIntersections:rendered});continue;
          }
          // Keep the selected relation continuous over faded unrelated lines.
          // Otherwise horizontal runs stay continuous; vertical runs show the gap.
          addCrossing(a,b,x,y,sa.axis==='v'?a:b);
        }
      }
      for(const c of connections) {
        if(!c.cuts.length)continue;
        const xs=c.points.map(p=>p.x),ys=c.points.map(p=>p.y),x=Math.min(...xs)-20,y=Math.min(...ys)-20,w=Math.max(...xs)-x+20,h=Math.max(...ys)-y+20;
        const id=prefix+'-'+defs.childElementCount,mask=element('mask',{id,maskUnits:'userSpaceOnUse',maskContentUnits:'userSpaceOnUse',x,y,width:w,height:h,'mask-type':'luminance'});
        mask.style.maskType='luminance';mask.append(element('rect',{x,y,width:w,height:h,fill:'white'}));
        for(const p of c.cuts){const spacing=Math.min(Infinity,...c.cuts.filter(q=>q!==p).map(q=>Math.hypot(q.x-p.x,q.y-p.y)).filter(d=>d>.1));p.radius=Math.min(radius,spacing*.36);mask.append(element('circle',{cx:p.x,cy:p.y,r:p.radius,fill:'black'}));}
        defs.append(mask);touched.push([c.path,c.path.getAttribute('mask')]);c.path.setAttribute('mask','url(#'+id+')');
      }
      rendered=connections;
      stats={connections:connections.length,gaps:crossings.length,crossings,nearBends,collinearOverlaps:overlaps,excludedEndpoints:sharedEndpoints};
      svg.dataset.lineJumpCount=String(crossings.length);svg.dispatchEvent(new CustomEvent('linejumps:updated',{detail:stats}));return stats;
    }
    function pickEdge(event, maxPixels=13) {
      let best=null,bestDistance=maxPixels,bestRank=-Infinity;
      for(const c of rendered){
        const matrix=c.path.getScreenCTM();if(!matrix)continue;
        const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
        const unit=Math.hypot(matrix.a,matrix.b)||1;
        for(const s of c.segments){
          const x=s.axis==='h'?Math.max(s.min,Math.min(s.max,point.x)):s.a.x,y=s.axis==='v'?Math.max(s.min,Math.min(s.max,point.y)):s.a.y;
          if(c.cuts.some(p=>Math.hypot(x-p.x,y-p.y)<p.radius-.2))continue;
          const distance=Math.hypot(point.x-x,point.y-y)*unit;
          if(distance<bestDistance-.15||(Math.abs(distance-bestDistance)<=.15&&c.rank>bestRank)){best=c.id;bestDistance=distance;bestRank=c.rank;}
        }
      }return best;
    }
    function schedule() { if(frame!==null||disposed)return;frame=requestAnimationFrame(()=>{frame=null;update();}); }
    function dispose(){disposed=true;if(frame!==null)cancelAnimationFrame(frame);clearMasks();defs.remove();instances.delete(svg);}
    const api={update,schedule,dispose,pickEdge,getStats:()=>stats};instances.set(svg,api);update();return api;
  }
  global.ArtworkLineJumps={install,get:svg=>instances.get(svg)};
})(globalThis);
