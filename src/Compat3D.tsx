// @ts-nocheck
// Aba Compatibilização: 3D da tubulação (elétrico, água, esgoto), furos, caixas externas e alterações, lido de um arquivo
// gerado à parte (formato 'alveolar-compat'). Só consulta: não muda a modulação, as pranchas nem a produção.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { lerCompat, salvarCompat, apagarCompat } from './db.ts';

const CSS = ".cmp3d{--bg:#eef1f5;--fg:#1d2430;--card:#ffffffee;--mut:#5b6473;--bd:#d5dae2;--ac:#1a56db}\n@media (prefers-color-scheme:dark){.cmp3d{--bg:#14181f;--fg:#e6e9ef;--card:#1d232cee;--mut:#9aa3b2;--bd:#2f3744;--ac:#6d9bff}.cmp3d }\n.cmp3d{position:relative;height:min(82vh,900px);min-height:420px;background:var(--bg);color:var(--fg);font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;overflow:hidden;border-radius:10px;border:1px solid var(--bd)}.cmp3d:fullscreen{height:100vh;border-radius:0}.cmp3d #cmp-c{position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none}.cmp3d .pn{position:absolute;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:8px 10px;box-shadow:0 2px 10px #0002}.cmp3d #cmp-p{left:10px;top:10px;max-width:min(380px,calc(100% - 40px))}.cmp3d #cmp-l{right:10px;top:10px;width:min(340px,calc(100% - 40px));max-height:calc(100% - 110px);display:flex;flex-direction:column}.cmp3d #cmp-lista{overflow:auto;flex:1;margin-top:6px}.cmp3d #cmp-lista div{padding:5px 6px;border-bottom:1px solid var(--bd);cursor:pointer;font-size:12.5px}.cmp3d #cmp-lista div:hover{background:#1a56db14}.cmp3d #cmp-lista .erro{border-left:4px solid #d9362b}.cmp3d #cmp-lista .atencao{border-left:4px solid #ff9f1a}.cmp3d #cmp-lista .novo{border-left:4px solid #8e44ad}.cmp3d #cmp-lista .ext{border-left:4px solid #56606b}.cmp3d #cmp-lista i{color:#2a8a2a;font-style:normal;display:block}.cmp3d #cmp-lista h3{font-size:13px;margin:8px 0 2px;position:sticky;top:0;background:var(--card);padding:3px 0;color:#1f4e79}.cmp3d #cmp-lista h3 small{font-weight:normal;color:var(--mut)}.cmp3d h1{font-size:14px;margin:0 0 6px}.cmp3d button{font:inherit;font-size:13px;border:1px solid var(--ac);background:transparent;color:var(--ac);border-radius:6px;padding:4px 9px;cursor:pointer;margin:1px}.cmp3d button.on{background:var(--ac);color:#fff}.cmp3d button.sec{border-style:dashed}.cmp3d .lb{font-size:11px;color:var(--mut);margin:5px 0 1px}.cmp3d #cmp-info{position:absolute;left:10px;bottom:10px;right:10px;background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:6px 10px;font-size:13px}.cmp3d #cmp-info .ac{color:#2a8a2a;font-weight:600}.cmp3d .leg{font-size:12px;color:var(--mut);margin-top:5px;line-height:1.7}.cmp3d .sw{display:inline-block;width:14px;height:6px;border-radius:3px;margin:0 3px 0 8px;vertical-align:1px}.cmp3d .rg{display:inline-block;width:9px;height:9px;border:2px solid;border-radius:50%;margin:0 3px 0 8px;vertical-align:-1px}\n@media (max-width:700px){.cmp3d #cmp-l{top:auto;bottom:70px;max-height:38dvh;left:10px;right:10px;width:auto}.cmp3d }";
const CORPO = "<canvas id=\"cmp-c\"></canvas>\n<div class=\"pn\" id=\"cmp-p\"><h1><span id=\"cmp-nome\"></span> \u00b7 tubula\u00e7\u00e3o e furos <button id=\"cmp-min\">\u2212</button> <button id=\"cmp-tc\">Tela cheia</button></h1><div id=\"cmp-pavs\"></div><div id=\"cmp-corpo\">\n<div class=\"lb\">Projeto</div><div><button class=\"on\" data-d=\"0\">El\u00e9trico</button><button class=\"on\" data-d=\"1\">\u00c1gua</button><button class=\"on\" data-d=\"2\">Esgoto</button></div>\n<div class=\"lb\">Mostrar</div><div><button id=\"cmp-vt\" class=\"on\">Tubula\u00e7\u00e3o</button><button id=\"cmp-vf\" class=\"on\">Furos</button><button id=\"cmp-vp\" class=\"on\">Pontos</button><button id=\"cmp-pr\">Corre\u00e7\u00f5es</button><button id=\"cmp-ve\" class=\"on\">Caixas externas</button><button id=\"cmp-cf\">S\u00f3 conflitos</button></div>\n<div class=\"leg\"><span class=\"sw\" style=\"background:#e0a800\"></span>eletroduto<span class=\"sw\" style=\"background:#1a73e8\"></span>\u00e1gua<span class=\"sw\" style=\"background:#2e9e44\"></span>esgoto<span class=\"sw\" style=\"background:#8fd19e\"></span>ventila\u00e7\u00e3o<br>\n<span class=\"sw\" style=\"background:#ff5a36\"></span>eletroduto deitado na parede (rasgo)<span class=\"sw\" style=\"background:#d9362b\"></span>caminho bate em porta/janela<br>\n<span class=\"rg\" style=\"border-color:#d9362b\"></span>furo com conflito<span class=\"rg\" style=\"border-color:#ff9f1a\"></span>furo a prever<span class=\"rg\" style=\"border-color:#2e9e44\"></span>furo ok<br><span class=\"sw\" style=\"background:#8e44ad\"></span>altera\u00e7\u00e3o (luz da sacada com sensor)<br><span class=\"sw\" style=\"background:#8a8f96\"></span>caixa de esgoto<span class=\"sw\" style=\"background:#e07b00\"></span>caixa el\u00e9trica<span class=\"sw\" style=\"background:#1a73e8\"></span>\u00e1gua / reservat\u00f3rio</div></div></div>\n<div class=\"pn\" id=\"cmp-l\"><b id=\"cmp-lt\"></b><div id=\"cmp-lista\"></div></div>\n<div id=\"cmp-info\">Toque nos pavimentos para somar \u00b7 toque num item da lista ou numa pe\u00e7a para ver \u00b7 1 dedo gira \u00b7 2 dedos aproxima \u00b7 toque duplo: girar em volta</div>\n";

function montar(root: HTMLElement, D: any, nome: string) {
  const $ = (id: string) => root.querySelector('#cmp-' + id) as HTMLElement;
  
  const cv=$('c');$('nome').textContent=nome;
  const RR=new THREE.WebGLRenderer({canvas:cv,antialias:true});RR.setPixelRatio(Math.min(devicePixelRatio,2));
  const S=new THREE.Scene();const esc=matchMedia('(prefers-color-scheme: dark)').matches;S.background=new THREE.Color(esc?0x14181f:0xeef1f5);
  const C=new THREE.PerspectiveCamera(35,1,0.05,2000);C.up.set(0,0,1);
  S.add(new THREE.AmbientLight(0xffffff,1.4),new THREE.HemisphereLight(0xffffff,0xb8b2a6,0.8));const sol=new THREE.DirectionalLight(0xffffff,1.3);sol.position.set(-30,-40,60);S.add(sol);
  const box=new THREE.BoxGeometry(1,1,1),ar=new THREE.EdgesGeometry(box);
  const mat=(c,o)=>new THREE.MeshStandardMaterial({color:c,roughness:0.9,transparent:true,opacity:o,depthWrite:false,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const MW=[mat(0xece6db,0.32),mat(0xddd3c2,0.32)],ML=mat(0xa7afb8,0.22);const EM=new THREE.LineBasicMaterial({color:0x55524c,transparent:true,opacity:0.25});
  const G=D.pavs.map(()=>new THREE.Group());G.forEach(g=>S.add(g));const bbP=D.pavs.map(()=>new THREE.Box3());
  for(const c of D.cx){const [pv,tp,ab,x0,y0,z0,x1,y1,z1]=c;if(tp===2)continue;const m=new THREE.Mesh(box,tp===1?ML:MW[ab]);m.renderOrder=1;
    m.scale.set(Math.max(x1-x0-(tp?0.006:0),0.01),Math.max(y1-y0-(tp?0.006:0),0.01),Math.max(z1-z0,0.01));m.position.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);
    const l=new THREE.LineSegments(ar,EM);l.scale.copy(m.scale);l.position.copy(m.position);G[pv].add(m,l);bbP[pv].expandByPoint(new THREE.Vector3(x0,y0,z0)).expandByPoint(new THREE.Vector3(x1,y1,z1))}
  if(D.chao){const [cx0,cy0,cx1,cy1]=D.chao;const gr=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x9c8f78,transparent:true,opacity:0.18,depthWrite:false}));gr.scale.set(cx1-cx0,cy1-cy0,0.02);gr.position.set((cx0+cx1)/2,(cy0+cy1)/2,-0.01);G[0].add(gr);bbP[0].expandByPoint(new THREE.Vector3(cx0,cy0,-1)).expandByPoint(new THREE.Vector3(cx1,cy1,0))}
  {const CF={muro:[0xcfc7b8,.6],alv:[0xe6dccb,.55],laje:[0xb5bcc4,.4],portao:[0x5b6370,.55],calcada:[0xd9d4cc,.7],pintura:[0xffffff,.95],moto:[0xf2d04b,.55]};
   for(const [x0,y0,z0,x1,y1,z1,tp] of (D.fr||[])){const [c,o]=CF[tp];const m=new THREE.Mesh(box,mat(c,o));m.scale.set(x1-x0,y1-y0,Math.max(z1-z0,0.01));m.position.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);m.renderOrder=1;
    const l=new THREE.LineSegments(ar,EM);l.scale.copy(m.scale);l.position.copy(m.position);G[0].add(m,l)}}
  // tubulação: um tubo (cilindro) por trecho, agrupado por pavimento/projeto/cor (InstancedMesh: rápido mesmo com milhares de trechos)
  const CORT=[[0xe0a800,0x1a73e8,0x2e9e44],[0xff5a36,0xff5a36,0xff5a36],[0xd9362b,0xd9362b,0xd9362b],[0x8fd19e,0x8fd19e,0x8fd19e]];
  const cil=new THREE.CylinderGeometry(1,1,1,10);const TUB=D.pavs.map(()=>[new THREE.Group(),new THREE.Group(),new THREE.Group()]);TUB.forEach(a=>a.forEach(g=>S.add(g)));
  {const grp={};for(let i=0;i<D.tub.length;i+=10){const k=D.tub[i]+'|'+D.tub[i+1]+'|'+D.tub[i+2];(grp[k]=grp[k]||[]).push(i)}
   const up=new THREE.Vector3(0,1,0),q=new THREE.Quaternion(),M4=new THREE.Matrix4(),a=new THREE.Vector3(),b=new THREE.Vector3(),dv=new THREE.Vector3(),sc=new THREE.Vector3();
   for(const k in grp){const [pv,d,c]=k.split('|').map(Number);const ids=grp[k];
    const im=new THREE.InstancedMesh(cil,new THREE.MeshStandardMaterial({color:CORT[c][d],roughness:0.45,metalness:0.1,emissive:CORT[c][d],emissiveIntensity:0.12}),ids.length);
    ids.forEach((i,j)=>{a.set(D.tub[i+3],D.tub[i+4],D.tub[i+5]);b.set(D.tub[i+6],D.tub[i+7],D.tub[i+8]);dv.subVectors(b,a);const L=dv.length();q.setFromUnitVectors(up,dv.normalize());
      sc.set(D.tub[i+9],L+D.tub[i+9]*0.6,D.tub[i+9]);M4.compose(a.clone().add(b).multiplyScalar(0.5),q,sc);im.setMatrixAt(j,M4)});
    im.instanceMatrix.needsUpdate=true;TUB[pv][d].add(im)}}
  // pontos (caixas), colunas na parede e furos (anéis)
  const CORN={erro:0xd9362b,atencao:0xff9f1a,ok:0x2e9e44,novo:0x8e44ad,ext:0x56606b};const mc={};const MC=(c,o=1)=>mc[c+'|'+o]||(mc[c+'|'+o]=new THREE.MeshStandardMaterial({color:c,roughness:0.5,emissive:c,emissiveIntensity:0.3,transparent:o<1,opacity:o}));
  const MG=new THREE.MeshStandardMaterial({color:0x22b24c,emissive:0x22b24c,emissiveIntensity:0.35,transparent:true,opacity:0.85}),LG=new THREE.LineBasicMaterial({color:0x22b24c});
  const IT=D.it.map((t,i)=>{const [pv,d,k,x,y,z,x2,y2,z2,nv,tx,ac,s,ax]=t;const g=new THREE.Group();let m;
    if(k==='anel'){const r=Math.max(0.045,s/2+0.03);m=new THREE.Mesh(new THREE.TorusGeometry(r,Math.max(0.012,r*0.22),8,28),MC(CORN[nv]));if(ax==='x')m.rotation.y=Math.PI/2;else if(ax==='y')m.rotation.x=Math.PI/2}
    else if(k==='ext'){const [a,hh,ci]=s;const cor=[0xe07b00,0x1a73e8,0x8a8f96][d];m=ci?new THREE.Mesh(new THREE.CylinderGeometry(a/2,a/2,hh,32),MC(cor,0.85)):new THREE.Mesh(box,MC(cor,0.8));if(ci)m.rotation.x=Math.PI/2;else m.scale.set(a,a,hh);m.renderOrder=3}
    else if(k==='coluna'){m=new THREE.Mesh(box,MC(CORN[nv],0.9));m.scale.set(0.12,0.12,0.25)}
    else{m=new THREE.Mesh(box,MC(nv==='ok'?[0xe0a800,0x1a73e8,0x2e9e44][d]:CORN[nv]));m.scale.set(0.1,0.1,0.1)}
    m.position.set(x,y,z);m.userData.i=i;g.add(m);let gm=null;
    if(x2!=null&&nv!=='ok'&&(Math.abs(x2-x)>0.005||Math.abs(y2-y)>0.005||Math.abs(z2-z)>0.005)){gm=new THREE.Mesh(box,MG);gm.scale.set(0.1,0.1,0.1);gm.position.set(x2,y2,z2);gm.userData={i,prop:1};
      const ln=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x,y,z),new THREE.Vector3(x2,y2,z2)]),LG);ln.userData.prop=1;g.add(gm,ln)}
    S.add(g);return {g,m,gm,pv,d,k,nv,tx,ac,x,y,z}});
  // estado: pavimentos somando
  const on=new Set([0]);const disc=[true,true,true];let soCf=false,verPr=false,verT=true,verF=true,verP=true,verE=true;
  const pb=$('pavs');D.pavs.forEach((n,i)=>{const b=document.createElement('button');b.textContent=n;b.onclick=()=>{on.has(i)?on.delete(i):on.add(i);aplica();enq(true)};pb.appendChild(b)});
  {const t=document.createElement('button');t.textContent='Todos';t.className='sec';t.onclick=()=>{D.pavs.forEach((_,i)=>on.add(i));aplica();enq(true)};const l=document.createElement('button');l.textContent='Limpar';l.className='sec';l.onclick=()=>{on.clear();aplica()};pb.append(t,l)}
  const O=new OrbitControls(C,cv);O.enableDamping=true;O.dampingFactor=0.15;O.rotateSpeed=0.55;O.screenSpacePanning=true;O.zoomToCursor=true;O.minDistance=0.3;O.maxDistance=200;O.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
  let anim=null;const voar=(a,p)=>{anim={t0:performance.now(),a0:O.target.clone(),p0:C.position.clone(),a1:a,p1:p}};
  const enq=(an)=>{const b=new THREE.Box3();(on.size?[...on]:D.pavs.map((_,i)=>i)).forEach(i=>b.union(bbP[i]));const c=b.getCenter(new THREE.Vector3()),r=b.getSize(new THREE.Vector3()).length()/2,f=Math.max(1,1.25*root.clientHeight/root.clientWidth),p=new THREE.Vector3(c.x+r*1.15*f,c.y-r*0.95*f,c.z+r*0.9*f);if(an)voar(c,p);else{O.target.copy(c);C.position.copy(p);O.update()}};
  const lista=$('lista'),lt=$('lt'),info=$('info');
  const aplica=()=>{G.forEach((g,i)=>g.visible=on.has(i));TUB.forEach((a,i)=>a.forEach((g,d)=>g.visible=verT&&on.has(i)&&disc[d]));
    IT.forEach(t=>{const tipo=t.k==='ext'?verE:t.k==='anel'?verF:(verP||t.nv==='novo');t.g.visible=tipo&&on.has(t.pv)&&disc[t.d]&&(!soCf||t.nv!=='ok');t.g.children.forEach(o=>{if(o.userData.prop)o.visible=verPr})});
    pb.querySelectorAll('button:not(.sec)').forEach((b,i)=>b.classList.toggle('on',on.has(i)));root.querySelectorAll('[data-d]').forEach(b=>b.classList.toggle('on',disc[+b.dataset.d]));
    [['vt',verT],['vf',verF],['vp',verP],['ve',verE],['pr',verPr],['cf',soCf]].forEach(([id,v])=>$(id).classList.toggle('on',v));
    const xs=IT.map((t,i)=>[t,i]).filter(([t])=>on.has(t.pv)&&disc[t.d]&&t.nv!=='ok').sort((a,b)=>a[0].pv-b[0].pv||({novo:0,ext:1,erro:2}[a[0].nv]??3)-({novo:0,ext:1,erro:2}[b[0].nv]??3));
    const ne=xs.filter(x=>x[0].nv==='erro').length,nn=xs.filter(x=>x[0].nv==='novo').length,nx=xs.filter(x=>x[0].nv==='ext').length;lt.textContent=on.size?(nx?nx+' caixas · ':'')+(nn?nn+' alterações · ':'')+ne+' para corrigir · '+(xs.length-ne-nn-nx)+' de atenção':'Toque num pavimento';
    let h='',u=-1;for(const [t,i] of xs){if(t.pv!==u){u=t.pv;const q=xs.filter(x=>x[0].pv===t.pv);h+='<h3>'+D.pavs[t.pv]+' <small>'+q.filter(x=>x[0].nv==='erro').length+' corrigir · '+q.filter(x=>x[0].nv==='atencao').length+' atenção'+(q.some(x=>x[0].nv==='novo')?' · '+q.filter(x=>x[0].nv==='novo').length+' alteração':'')+(q.some(x=>x[0].nv==='ext')?' · '+q.filter(x=>x[0].nv==='ext').length+' caixas':'')+'</small></h3>'}
      const p=t.tx.split(' · ');h+='<div class="'+t.nv+'" data-i="'+i+'"><b>'+p.slice(0,3).join(' · ')+'</b><br>'+p.slice(3).join(' · ')+(t.ac?'<i>→ '+t.ac+'</i>':'')+'</div>'}lista.innerHTML=h};
  let sel=null;const marca=i=>{if(sel&&sel.k!=='ext')sel.m.scale.multiplyScalar(1/1.8);sel=IT[i];if(sel.k!=='ext')sel.m.scale.multiplyScalar(1.8);info.innerHTML=sel.tx+(sel.ac?'<br><span class="ac">→ '+sel.ac+'</span>':'')};
  lista.addEventListener('click',e=>{const d=e.target.closest('[data-i]');if(!d)return;const i=+d.dataset.i,t=IT[i];marca(i);const a=new THREE.Vector3(t.x,t.y,t.z);const dir=C.position.clone().sub(O.target).normalize();voar(a,a.clone().add(dir.multiplyScalar(t.k==='ext'?3.5+3*D.it[i][12][0]:3.5)))});
  root.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{disc[+b.dataset.d]=!disc[+b.dataset.d];aplica()});
  const tg=(id,f)=>$(id).onclick=()=>{f();aplica()};tg('vt',()=>verT=!verT);tg('vf',()=>verF=!verF);tg('vp',()=>verP=!verP);tg('pr',()=>verPr=!verPr);tg('cf',()=>soCf=!soCf);tg('ve',()=>verE=!verE);
  $('min').onclick=e=>{const c=$('corpo'),f=c.style.display==='none';c.style.display=f?'':'none';$('l').style.display=f?'':'none';e.target.textContent=f?'−':'+'};
  const rc=new THREE.Raycaster(),mp=new THREE.Vector2();let dn=null,ul=0;
  const acha=(x,y,al)=>{const r=cv.getBoundingClientRect();mp.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);rc.setFromCamera(mp,C);return rc.intersectObjects(al,false)[0]};
  const pecas=()=>IT.filter(t=>t.g.visible).flatMap(t=>[t.m,...(t.gm&&t.gm.visible?[t.gm]:[])]);
  const foco=(x,y)=>{const h=acha(x,y,[...pecas(),...G.filter(g=>g.visible).flatMap(g=>g.children.filter(m=>m.isMesh))]);if(!h)return;const d=C.position.clone().sub(O.target);voar(h.point.clone(),h.point.clone().add(d.normalize().multiplyScalar(Math.min(d.length(),5))))};
  cv.addEventListener('pointerdown',e=>{dn=[e.clientX,e.clientY]});cv.addEventListener('dblclick',e=>foco(e.clientX,e.clientY));
  cv.addEventListener('pointerup',e=>{if(!dn||Math.hypot(e.clientX-dn[0],e.clientY-dn[1])>8)return;if(e.pointerType==='touch'){const t=performance.now();if(t-ul<320){foco(e.clientX,e.clientY);ul=0;return}ul=t}
    const h=acha(e.clientX,e.clientY,pecas());if(h)marca(h.object.userData.i)});
  const tam=()=>{const w=root.clientWidth||1,h=root.clientHeight||1;RR.setSize(w,h,false);C.aspect=w/h;C.updateProjectionMatrix()};const ro=new ResizeObserver(tam);ro.observe(root);tam();aplica();enq(false);
  let raf=0;(function loop(){raf=requestAnimationFrame(loop);if(anim){const k=Math.min(1,(performance.now()-anim.t0)/650),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;O.target.lerpVectors(anim.a0,anim.a1,e);C.position.lerpVectors(anim.p0,anim.p1,e);if(k>=1)anim=null}O.update();RR.render(S,C)})();
  if(root.clientWidth<700){$('min').click();info.textContent='Toque nos pavimentos para somar · + abre filtros e lista · 1 dedo gira · 2 dedos aproxima'}
  
  $('tc').onclick=()=>{try{if(document.fullscreenElement)document.exitFullscreen();else{const p=root.requestFullscreen?.();if(p&&p.catch)p.catch(()=>{})}}catch(e){}};
  const fs=()=>{$('tc').textContent=document.fullscreenElement===root?'Sair da tela cheia':'Tela cheia';setTimeout(tam,60)};document.addEventListener('fullscreenchange',fs);
  return ()=>{cancelAnimationFrame(raf);ro.disconnect();document.removeEventListener('fullscreenchange',fs);O.dispose();RR.dispose();S.traverse(o=>{if(o.geometry)o.geometry.dispose()})};
  
}

export default function Compat3D({ projId, projNome }: { projId: string | null; projNome: string }) {
  const [dados, setDados] = useState<any>(null);
  const [estado, setEstado] = useState<'lendo' | 'pronto'>('lendo');
  const [erro, setErro] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const chave = projId || 'sem-projeto';
  useEffect(() => { let vivo = true; setEstado('lendo'); lerCompat(chave).then(d => { if (vivo) { setDados(d || null); setEstado('pronto'); } }).catch(() => vivo && setEstado('pronto')); return () => { vivo = false; }; }, [chave]);
  useEffect(() => { if (!dados || !ref.current) return; ref.current.innerHTML = CORPO; return montar(ref.current, dados.D, dados.nome || projNome); }, [dados]);
  const abrir = async (f: File | undefined) => {
    if (!f) return; setErro('');
    try {
      const j = JSON.parse(await f.text());
      if (j?.formato !== 'alveolar-compat' || !j.D?.it) throw new Error();
      await salvarCompat(chave, j); setDados(j);
    } catch { setErro('Esse arquivo não é uma compatibilização do sistema (arquivo .json "abrir no sistema").'); }
  };
  const entrada = <label className="botao">{dados ? 'Trocar arquivo' : 'Abrir arquivo da compatibilização (.json)'}<input type="file" accept=".json,application/json" hidden onChange={e => { abrir(e.target.files?.[0]); e.target.value = ''; }} /></label>;
  return (
    <section className="card">
      <style>{CSS}</style>
      <h2>Compatibilização (elétrico, hidráulico e sanitário)</h2>
      <p className="dica">Só para consulta: mostra por onde passa a tubulação, onde desce, onde furar, as caixas externas e as correções propostas. Não altera a modulação, as pranchas nem a produção.</p>
      {estado === 'lendo' ? <p>Carregando…</p> : <>
        <div className="acoes-compat">{entrada}
          {dados && <><span className="dica"> {dados.nome} · gerado em {dados.gerado}</span> <button onClick={async () => { await apagarCompat(chave); setDados(null); }}>Tirar deste projeto</button></>}
        </div>
        {erro && <p className="erro">{erro}</p>}
        {!dados && <p>Este projeto ainda não tem compatibilização. Abra o arquivo <b>"… compatibilizacao (abrir no sistema).json"</b>; ele fica guardado neste aparelho, junto do projeto.</p>}
        {dados && <div className="cmp3d" ref={ref} />}
      </>}
    </section>
  );
}
