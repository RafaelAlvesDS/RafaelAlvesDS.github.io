/* Uberaba 3D — prédios.
 *
 * Duas fontes, juntas por bloco de 500 m:
 *  1. Prédios reais do OpenStreetMap (data/uberaba/predios.json), com altura ou andares quando o OSM informa.
 *  2. Preenchimento procedural onde o OSM não tem prédio: casas e prédios ao longo das ruas, recuados da calçada,
 *     mais altos perto do centro e nas avenidas. É determinístico (mesma cidade toda vez) e não invade ruas,
 *     praças, áreas verdes nem prédios reais.
 *
 * Só os blocos perto da câmera ganham prédios; os distantes são descartados.
 * Também expõe colisão (carro x parede) e oclusão (câmera dentro de prédio) para o modo de jogo.
 */
(function(){
'use strict';

const P={ready:false,osm:null,chunks:new Map(),queue:[],last:0,radius:MOBILE?900:1500,stats:{osm:0,proc:0}};
window.PREDIOS=P;

// ---------------------------------------------------------------- aleatório determinístico
function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const between=(r,a,b)=>a+(b-a)*r();

// ---------------------------------------------------------------- geometria 2D
function inRing(x,z,R){let c=false;for(let i=0,n=R.length/2,j=n-1;i<n;j=i++){const xi=R[2*i],zi=R[2*i+1],xj=R[2*j],zj=R[2*j+1];
  if(((zi>z)!==(zj>z))&&(x<(xj-xi)*(z-zi)/(zj-zi)+xi))c=!c;}return c;}
function ringArea(R){let a=0;for(let i=0,n=R.length/2,j=n-1;i<n;j=i++)a+=R[2*j]*R[2*i+1]-R[2*i]*R[2*j+1];return a/2;}
function bbOf(R){let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(let i=0;i<R.length;i+=2){x0=Math.min(x0,R[i]);x1=Math.max(x1,R[i]);z0=Math.min(z0,R[i+1]);z1=Math.max(z1,R[i+1]);}return [x0,x1,z0,z1];}
function segDist(px,pz,P){let d=1e9;for(let i=0;i<P.length-2;i+=2){const ax=P[i],az=P[i+1],dx=P[i+2]-ax,dz=P[i+3]-az,L2=dx*dx+dz*dz||1;
  const t=clamp(((px-ax)*dx+(pz-az)*dz)/L2,0,1);d=Math.min(d,Math.hypot(px-ax-dx*t,pz-az-dz*t));}return d;}

// ---------------------------------------------------------------- dados
const NO_BUILD=new Set(['park','water','basin','reservoir','forest','wood','scrub','wetland','grassland','meadow','farmland','farmyard','orchard',
  'pitch','playground','garden','cemetery','golf_course','stadium','recreation_ground','village_green','parking','quarry','grass']);
const KIND_H={house:[3.6,7],detached:[3.6,7],residential:[4,9],semidetached_house:[3.6,7],terrace:[3.6,7],apartments:[15,45],commercial:[5,12],
  retail:[4.5,8],office:[9,30],industrial:[7,11],warehouse:[7,11],church:[10,16],cathedral:[16,24],school:[6,9],university:[7,14],hospital:[9,24],
  hotel:[12,36],garage:[2.6,3.2],garages:[2.6,3.2],shed:[2.6,3.2],roof:[4,5],kiosk:[2.8,3.2],service:[3,4],construction:[3,12]};
let CENTRO=[0,0];

// As pistas do jogo são mais largas que as reais, então prédios do OSM podem cair em cima da calçada ou da pista.
// Casas vão para trás do muro (alinhamento + recuo de garagem); prédios maiores, para trás da calçada.
// Primeiro desloca o prédio inteiro para dentro do lote; se ainda sobrar invasão (esquina), apara só os vértices.
function fitToStreets(R,ch,house){
  const roads=ch.edges.filter(e=>e.cls!=='service');
  const need=e=>e.w/2+CALC+(house?MURO_E+2.2:0.3);
  const closest=(x,z,e)=>{let bd=1e9,bx=0,bz=0;const P=e.P;for(let k=0;k<P.length-2;k+=2){const ax=P[k],az=P[k+1],dx=P[k+2]-ax,dz=P[k+3]-az,L2=dx*dx+dz*dz||1,
    t=clamp(((x-ax)*dx+(z-az)*dz)/L2,0,1),px=ax+dx*t,pz=az+dz*t,d=Math.hypot(x-px,z-pz);if(d<bd){bd=d;bx=px;bz=pz;}}return [bd,bx,bz];};
  for(let it=0;it<3;it++){
    let worst=0,wx=0,wz=0;
    const bb=bbOf(R);
    for(const e of roads){const nd=need(e);if(bb[1]<e.bb[0]-nd||bb[0]>e.bb[1]+nd||bb[3]<e.bb[2]-nd||bb[2]>e.bb[3]+nd)continue;
      for(let i=0;i<R.length;i+=2){const [d,px,pz]=closest(R[i],R[i+1],e),gap=nd-d;
        if(gap>worst){worst=gap;const l=d||1;wx=(R[i]-px)/l;wz=(R[i+1]-pz)/l;}}}
    if(worst<=0.05) return;
    if(it<2){const k=worst+0.1;for(let i=0;i<R.length;i+=2){R[i]+=wx*k;R[i+1]+=wz*k;}continue;}
    // última tentativa: apara os vértices que ainda invadem
    for(const e of roads){const nd=need(e);for(let i=0;i<R.length;i+=2){const [d,px,pz]=closest(R[i],R[i+1],e);
      if(d<nd){const l=d||1;R[i]=px+(R[i]-px)/l*nd;R[i+1]=pz+(R[i+1]-pz)/l*nd;}}}
  }
}
async function load(){
  CENTRO=[(-47.9318-META.lon0)*META.mLon,(META.lat0-(-19.7483))*META.mLat];  // Praça Rui Barbosa, centro de Uberaba
  try{const r=await fetch(DATA+'predios.json',{cache:'no-cache'});if(r.ok){const d=await r.json();P.osm=d;}}catch(e){}
  if(P.osm){
    const C=META.chunk;
    for(const [hd,lv,k,p] of P.osm.b){
      const R=Float32Array.from(p,v=>v/10);let bb=bbOf(R);const cx=(bb[0]+bb[1])/2,cz=(bb[2]+bb[3])/2;
      const ch=chunkAt(cx,cz);if(!ch)continue;
      const small=(bb[1]-bb[0])*(bb[3]-bb[2])<500&&!(hd>90||lv>3);
      fitToStreets(R,ch,small);bb=bbOf(R);
      const kind=P.osm.kinds[k],r=rng(Math.round(cx*7+cz*13));
      let h=hd/10;if(!h&&lv)h=lv*3.1+0.6;
      if(!h){const range=KIND_H[kind];const dc=Math.hypot(cx-CENTRO[0],cz-CENTRO[1]);
        h=range?between(r,range[0],range[1]):dc<900?between(r,5,16):dc<2500?between(r,3.8,8):between(r,3.6,6.5);}
      (ch.osmB||(ch.osmB=[])).push({R,bb,h,kind,osm:true,col:null});P.stats.osm++;
    }
  }
  buildBlocks();
  P.ready=true;
}

// ---------------------------------------------------------------- quarteirões e lotes
const WALL_HOUSE=['#e9e3d5','#f1e7c9','#e7d1c0','#dadfe2','#cad8c6','#efe9e1','#dcc6a7','#c4ccd2','#e5d6b7','#f0d9c4','#d5e0d8'];
const WALL_TALL=['#d2d6d9','#bcc4ca','#e2ded6','#aeb7be','#cbc6bd','#9fa9b1'];
// Alinhamento predial: a frente dos lotes (e o muro) fica a uma distância fixa do eixo da rua (meia pista + calçada),
// então todos os muros de um lado da rua ficam na mesma linha, inclusive em curva.
const CALC=2.8,MURO_E=0.18;
const MURO_COL=['#d9d3c5','#e6e0d2','#cbc4b5','#bfb9ab','#e3d5be','#d4dad6','#ece6da','#c8bba6','#d8c7b0'];
const BLOCK_CLS=new Set(['trunk','primary','secondary','tertiary','unclassified','residential','living_street','road',
  'trunk_link','primary_link','secondary_link','tertiary_link']);

function rayDist(px,pz,nx,nz,R){ // distância até a borda do polígono R, andando de (px,pz) na direção (nx,nz)
  let best=1e9;for(let i=0,n=R.length/2;i<n;i++){const j=(i+1)%n,ax=R[2*i],az=R[2*i+1],ex=R[2*j]-ax,ez=R[2*j+1]-az;
    const den=nx*ez-nz*ex;if(Math.abs(den)<1e-9)continue;const t=((ax-px)*ez-(az-pz)*ex)/den,u=((ax-px)*nz-(az-pz)*nx)/den;
    if(t>0.5&&u>=0&&u<=1&&t<best)best=t;}return best;}
function overlaps(A,B,tol){ // dois quadriláteros convexos se sobrepõem? (eixos separadores)
  for(const Q of [A,B])for(let i=0;i<4;i++){const j=(i+1)%4,ax=-(Q[2*j+1]-Q[2*i+1]),az=Q[2*j]-Q[2*i];
    let a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;for(let k=0;k<4;k++){const pa=A[2*k]*ax+A[2*k+1]*az,pb=B[2*k]*ax+B[2*k+1]*az;a0=Math.min(a0,pa);a1=Math.max(a1,pa);b0=Math.min(b0,pb);b1=Math.max(b1,pb);}
    const l=Math.hypot(ax,az)||1;if(a1/l<=b0/l+tol||b1/l<=a0/l+tol)return false;}
  return true;}
function lineX(p1,p2,q1,q2){const dx=p2[0]-p1[0],dz=p2[1]-p1[1],ex=q2[0]-q1[0],ez=q2[1]-q1[1],den=dx*ez-dz*ex;if(Math.abs(den)<1e-6)return null;
  const t=((q1[0]-p1[0])*ez-(q1[1]-p1[1])*ex)/den;return [p1[0]+dx*t,p1[1]+dz*t];}

// Quarteirões = faces do grafo de ruas (cada área cercada por ruas). Calculado uma vez, ao carregar.
function buildBlocks(){
  const outs=new Map(),HE=[],twin=new Map();
  for(const e of EDGES){if(!BLOCK_CLS.has(e.cls)||e.bridge||e.a===e.b)continue;
    for(const dir of [1,-1]){const P=dir>0?e.P:revFlat(e.P),h={e,dir,from:dir>0?e.a:e.b,to:dir>0?e.b:e.a,ang:Math.atan2(P[3]-P[1],P[2]-P[0]),P,used:false};
      HE.push(h);twin.set(e.i*2+(dir>0?0:1),h);let o=outs.get(h.from);if(!o)outs.set(h.from,o=[]);o.push(h);}}
  for(const o of outs.values())o.sort((p,q)=>p.ang-q.ang);
  const blocks=[];
  for(const h0 of HE){if(h0.used)continue;const cyc=[];let h=h0,g=0;
    while(h&&!h.used&&g++<300){h.used=true;cyc.push(h);const t=twin.get(h.e.i*2+(h.dir>0?1:0)),o=outs.get(h.to);if(!o){h=null;break;}
      const i=o.indexOf(t);h=o[(i-1+o.length)%o.length];}
    if(h!==h0||cyc.length<3)continue;
    const ring=[];for(const c of cyc)for(let k=0;k<c.P.length-2;k+=2)ring.push(c.P[k],c.P[k+1]);
    const A=ringArea(ring);if(Math.abs(A)<700||Math.abs(A)>150000)continue;
    const sg=Math.sign(A);
    // alinhamento: cada lado deslocado para dentro pela sua meia pista + calçada, cantos unidos na interseção
    const sides=cyc.map(c=>{const Q=offsetFlat(c.P,sg*(c.e.w/2+CALC)),pts=[];for(let k=0;k<Q.length;k+=2)pts.push([Q[k],Q[k+1]]);return {e:c.e,pts,node:c.to};});
    let ok=true;
    for(let k=0;k<sides.length;k++){const A1=sides[k].pts,B1=sides[(k+1)%sides.length].pts,nx=NODES[2*sides[k].node],nz=NODES[2*sides[k].node+1];
      const X=lineX(A1[A1.length-2],A1[A1.length-1],B1[0],B1[1]);
      if(X&&Math.hypot(X[0]-nx,X[1]-nz)<40){A1[A1.length-1]=X;B1[0]=X;}}
    const AR=[];for(const sd of sides)for(let k=0;k<sd.pts.length-1;k++)AR.push(sd.pts[k][0],sd.pts[k][1]);
    const A2=ringArea(AR);if(Math.sign(A2)!==sg||Math.abs(A2)<300)ok=false;
    if(!ok)continue;
    const bb=bbOf(AR);
    blocks.push({i:blocks.length,sides,AR:Float32Array.from(AR),sg,bb,cx:(bb[0]+bb[1])/2,cz:(bb[2]+bb[3])/2});
  }
  for(const B of blocks){const ch=chunkAt(B.cx,B.cz);if(ch)(ch.blocks||(ch.blocks=[])).push(B);}
  P.stats.blocks=blocks.length;
}

// Lotes de um quarteirão: frente no alinhamento, fundos até o meio da quadra; a esquina fica com um dos lados.
function blockLots(B,osm=[]){
  const r=rng(B.i*7919+101),lots=[];
  // lados compridos primeiro: os lotes dão frente para eles e ocupam as esquinas; os lados curtos ficam com o que sobrar
  const len=sd=>{let L=0;for(let k=1;k<sd.pts.length;k++)L+=Math.hypot(sd.pts[k][0]-sd.pts[k-1][0],sd.pts[k][1]-sd.pts[k-1][1]);return L;};
  const order=B.sides.map(sd=>({sd,L:len(sd)})).sort((a,b)=>b.L-a.L).map(o=>o.sd);
  for(const sd of order){
    const pts=sd.pts,cum=[0];for(let k=1;k<pts.length;k++)cum.push(cum[k-1]+Math.hypot(pts[k][0]-pts[k-1][0],pts[k][1]-pts[k-1][1]));
    const L=cum[cum.length-1];if(L<7)continue;
    const at=s=>{let k=1;while(k<pts.length-1&&cum[k]<s)k++;const f=clamp((s-cum[k-1])/((cum[k]-cum[k-1])||1),0,1);
      return [pts[k-1][0]+(pts[k][0]-pts[k-1][0])*f,pts[k-1][1]+(pts[k][1]-pts[k-1][1])*f];};
    let s=0,fails=0;
    while(s<L-6&&fails<40){
      let f=between(r,10,14);if(L-s-f<7)f=L-s;
      const F0=at(s);let F1=at(s+f),cx=F1[0]-F0[0],cz=F1[1]-F0[1],lc=Math.hypot(cx,cz)||1,ux=cx/lc,uz=cz/lc,nx=-uz*B.sg,nz=ux*B.sg;
      const mx=(F0[0]+F1[0])/2,mz=(F0[1]+F1[1])/2,D=rayDist(mx+nx*0.3,mz+nz*0.3,nx,nz,B.AR);
      let depth=D>=20?Math.min(30,D/2-0.1):D-0.3;
      // casas reais do OSM: a divisa fica no meio do vão entre duas casas, uma casa por lote
      if(osm.length){
        const iv=[];
        for(const b of osm){if(b.bb[1]<Math.min(F0[0],F1[0])-40||b.bb[0]>Math.max(F0[0],F1[0])+40||b.bb[3]<Math.min(F0[1],F1[1])-40||b.bb[2]>Math.max(F0[1],F1[1])+40)continue;
          let u0=1e9,u1=-1e9,v0=1e9,v1=-1e9;for(let i=0;i<b.R.length;i+=2){const dx=b.R[i]-F0[0],dz=b.R[i+1]-F0[1],u=dx*ux+dz*uz,v=dx*nx+dz*nz;
            u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v);}
          if(v1<0.2||v0>depth||u1<-0.2||u0>40)continue;iv.push([u0,u1]);}
        iv.sort((a,b)=>a[0]-b[0]);
        const cross=iv.find(a=>a[0]<0.3&&a[1]>0.3);
        if(cross&&cross[1]<30){s+=Math.max(1,cross[1]+0.6);fails++;continue;}           // casa atravessando o início: começa depois dela
        const first=iv.find(a=>a[0]>=0.3&&a[0]<f);
        if(first){const next=iv.find(a=>a[0]>first[1]+0.2);
          let nf=next?(first[1]+next[0])/2:Math.max(f,first[1]+0.8);nf=clamp(nf,Math.min(6,f),30);
          if(Math.abs(nf-f)>0.05&&s+nf<=L){f=nf;F1=at(s+f);cx=F1[0]-F0[0];cz=F1[1]-F0[1];lc=Math.hypot(cx,cz)||1;ux=cx/lc;uz=cz/lc;nx=-uz*B.sg;nz=ux*B.sg;}}
      }
      let Q=null;
      for(let tr=0;tr<3&&depth>=6;tr++,depth*=0.7){
        const q=new Float32Array([F0[0],F0[1],F1[0],F1[1],F1[0]+nx*depth,F1[1]+nz*depth,F0[0]+nx*depth,F0[1]+nz*depth]);
        if(!inRing(q[4],q[5],B.AR)||!inRing(q[6],q[7],B.AR))continue;
        if(lots.some(o=>overlaps(o.Q,q,0.25)))continue;
        Q=q;break;}
      if(!Q){s+=2;fails++;continue;}
      lots.push({Q,F0,ux,uz,nx,nz,f:lc,depth,e:sd.e});s+=f;fails=0;
    }
  }
  return lots;
}
const loc=(L,u,v)=>[L.F0[0]+L.ux*u+L.nx*v,L.F0[1]+L.uz*u+L.nz*v];          // coordenadas dentro do lote (u ao longo da frente, v para dentro)
const lrect=(L,u0,u1,v0,v1)=>new Float32Array([...loc(L,u0,v0),...loc(L,u1,v0),...loc(L,u1,v1),...loc(L,u0,v1)]);

function blocksOf(ch){
  const out=[],C=META.chunk;
  const roadsNear=ch.edges;
  // prédios reais por perto (deste bloco do mapa e vizinhos)
  const osm=[];for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const n=chunkAt(ch.cx+di*C,ch.cz+dj*C);if(n&&n.osmB)osm.push(...n.osmB);}
  const blockAreas=[];for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const n=chunkAt(ch.cx+di*C,ch.cz+dj*C);if(n)for(const a of n.areas)if(NO_BUILD.has(a.kind)&&!blockAreas.includes(a))blockAreas.push(a);}
  for(const B of ch.blocks||[]){
    const rb=roadsNear.filter(o=>o.bb[0]-o.w-6<B.bb[1]&&o.bb[1]+o.w+6>B.bb[0]&&o.bb[2]-o.w-6<B.bb[3]&&o.bb[3]+o.w+6>B.bb[2]);   // ruas que encostam no quarteirão
    const ab=blockAreas.filter(a=>a.bb[0]<B.bb[1]&&a.bb[1]>B.bb[0]&&a.bb[2]<B.bb[3]&&a.bb[3]>B.bb[2]);
    const r=rng(B.i*31337+7),bo=osm.filter(b=>b.bb[0]<B.bb[1]&&b.bb[1]>B.bb[0]&&b.bb[2]<B.bb[3]&&b.bb[3]>B.bb[2]);   // só os prédios deste quarteirão
    for(const L of blockLots(B,bo)){
      const lb=bbOf(L.Q),[ccx,ccz]=loc(L,L.f/2,L.depth/2);
      // lote em praça, área verde ou em cima de via de serviço: fica vazio
      if(ab.some(a=>ccx>a.bb[0]&&ccx<a.bb[1]&&ccz>a.bb[2]&&ccz<a.bb[3]&&inRing(ccx,ccz,a.P)))continue;
      let blocked=false;
      for(const o of rb){if(o.bb[0]-o.w>lb[1]||o.bb[1]+o.w<lb[0]||o.bb[2]-o.w>lb[3]||o.bb[3]+o.w<lb[2])continue;
        const lim=o.w/2+(o.cls==='service'?0.6:CALC-0.4);
        for(const [u,v] of [[0.5,0.5],[L.f-0.5,0.5],[L.f-0.5,L.depth-0.5],[0.5,L.depth-0.5],[L.f/2,L.depth/2],[L.f/2,L.depth-0.5]]){const [x,z]=loc(L,u,v);if(segDist(x,z,o.P)<lim){blocked=true;break;}}
        if(blocked)break;}
      if(blocked)continue;
      // prédio real dentro do lote?
      const inside=bo.filter(b=>b.bb[0]<lb[1]&&b.bb[1]>lb[0]&&b.bb[2]<lb[3]&&b.bb[3]>lb[2]);
      let real=null;
      if(inside.length){
        const fits=b=>{for(let i=0;i<b.R.length;i+=2){const dx=b.R[i]-L.F0[0],dz=b.R[i+1]-L.F0[1],u=dx*L.ux+dz*L.uz,v=dx*L.nx+dz*L.nz;
          if(u<0.3||u>L.f-0.3||v<0.3||v>L.depth-0.3)return false;}return true;};
        const touching=inside.filter(b=>{for(let i=0;i<b.R.length;i+=2){const dx=b.R[i]-L.F0[0],dz=b.R[i+1]-L.F0[1],u=dx*L.ux+dz*L.uz,v=dx*L.nx+dz*L.nz;
          if(u>-0.2&&u<L.f+0.2&&v>-0.2&&v<L.depth+0.2)return true;}return false;});
        if(touching.length===1&&touching[0].h<=9&&fits(touching[0]))real=touching[0];
        else if(touching.length)continue;                                  // prédio real maior ou atravessando o lote: deixa como está
      }
      const dc=Math.hypot(ccx-CENTRO[0],ccz-CENTRO[1]),u=r();
      if(!real&&u<0.07)continue;                                           // terreno baldio: sem muro, sem casa
      if(!real){
        // centro: comércio e prédios colados na calçada, sem muro
        const tallP=dc<900?(L.e.av?0.16:0.07):dc<2600?(L.e.av?0.06:0.015):(L.e.av?0.04:0.01);
        if(r()<tallP){const fl=Math.round(dc<900?between(r,6,16):between(r,4,9)),d=Math.min(L.depth-1,between(r,14,24));
          const R=lrect(L,0.3,L.f-0.3,0.3,d);out.push({R,bb:bbOf(R),h:fl*3.1+0.8,osm:false,col:WALL_TALL[(r()*WALL_TALL.length)|0]});continue;}
        if(dc<900&&r()<0.45){const fl=Math.round(between(r,1,3.4)),d=Math.min(L.depth-0.5,between(r,12,22));
          const R=lrect(L,0.15,L.f-0.15,0.2,d);out.push({R,bb:bbOf(R),h:fl*3.1+0.8,osm:false,col:WALL_HOUSE[(r()*WALL_HOUSE.length)|0]});continue;}
        // casa: recuada do muro, com corredor lateral e quintal
        let rf=between(r,2.6,5),gl=r()<0.5?0.4:between(r,1,2),gr=between(r,0.4,2),by=between(r,2,6);
        let hd=L.depth-rf-by;if(hd<6){by=Math.max(1,L.depth-rf-6);hd=L.depth-rf-by;}
        if(hd<5){rf=Math.max(1.2,L.depth-6.5);hd=L.depth-rf-1;}
        if(hd>=4&&L.f-gl-gr>=4.5){const fl=r()<0.3?2:1,R=lrect(L,gl,L.f-gr,rf,rf+Math.min(hd,16));
          out.push({R,bb:bbOf(R),h:fl*3.1+between(r,0.3,1),osm:false,col:WALL_HOUSE[(r()*WALL_HOUSE.length)|0]});}
      }
      // muro em volta do lote inteiro: frente (com portão), laterais e fundo, por dentro da divisa
      const t=MURO_E,mc=MURO_COL[(r()*MURO_COL.length)|0],mh=between(r,1.9,2.4),gw=Math.min(3,L.f*0.3),g0=r()<0.5?0.6:L.f-0.6-gw;
      const W=(u0,u1,v0,v1,h,col)=>{if(u1-u0<0.05||v1-v0<0.05)return;const R=lrect(L,u0,u1,v0,v1);out.push({R,bb:bbOf(R),h,col,wall:true});};
      W(0,g0,0,t,mh,mc);W(g0,g0+gw,0,t,mh-0.15,'#4a4f55');W(g0+gw,L.f,0,t,mh,mc);   // frente e portão
      W(0,L.f,L.depth-t,L.depth,mh,mc);                                              // fundo
      W(0,t,t,L.depth-t,mh,mc);W(L.f-t,L.f,t,L.depth-t,mh,mc);                       // laterais
      P.stats.lots=(P.stats.lots||0)+1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- malhas
const winTex=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');
  g.fillStyle='#fff';g.fillRect(0,0,64,64);g.fillStyle='#8796a3';g.fillRect(18,19,28,22);g.fillStyle='#a7b4bf';g.fillRect(18,19,28,5);
  g.fillStyle='#d9d9d9';g.fillRect(0,58,64,6);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=MAX_ANISO;return t;})();
const wallMat=new THREE.MeshLambertMaterial({map:winTex,vertexColors:true});
const roofMat=new THREE.MeshLambertMaterial({vertexColors:true});
const tmpC=new THREE.Color();
function buildMeshes(list){
  // 1ª passada: prepara cada peça (anel anti-horário, alturas, triângulos do topo) e conta vértices
  let nw=0,nr=0;const prep=[];
  for(const b of list){
    let R=b.R;if(ringArea(R)<0)R=revFlat(R);                         // anel anti-horário: normais das paredes para fora
    const n=R.length/2;let lo=1e9,hi=-1e9;for(let i=0;i<n;i++){const y=H(R[2*i],R[2*i+1]);if(y<lo)lo=y;if(y>hi)hi=y;}
    const y0=lo-(b.wall?0.3:1),y1=hi+b.h;b.top=y1;
    if(!b.col){const r=rng(Math.round(b.bb[0]*3+b.bb[2]*5));b.col=(b.h>14?WALL_TALL:WALL_HOUSE)[(r()*(b.h>14?WALL_TALL:WALL_HOUSE).length)|0];}
    let tris;
    if(n===4)tris=[0,1,2,0,2,3];
    else{const pts=[];for(let i=0;i<n;i++)pts.push(new THREE.Vector2(R[2*i],R[2*i+1]));tris=[];try{for(const t of THREE.ShapeUtils.triangulateShape(pts,[]))tris.push(t[0],t[1],t[2]);}catch(e){}}
    prep.push({b,R,n,y0,y1,tris});nw+=n*6;nr+=tris.length;
  }
  const wp=new Float32Array(nw*3),wn=new Float32Array(nw*3),wc=new Float32Array(nw*3),wu=new Float32Array(nw*2);
  const rp=new Float32Array(nr*3),rn=new Float32Array(nr*3),rc=new Float32Array(nr*3);
  let iw=0,ir=0;
  for(const {b,R,n,y0,y1,tris} of prep){
    tmpC.set(b.col);const cr=tmpC.r,cg=tmpC.g,cb=tmpC.b,vTop=b.wall?0:(y1-y0)/3.1;let per=0;
    for(let i=0;i<n;i++){const j=(i+1)%n,ax=R[2*i],az=R[2*i+1],bx=R[2*j],bz=R[2*j+1],len=Math.hypot(bx-ax,bz-az)||1e-6;
      const nx=(bz-az)/len,nz=-(bx-ax)/len,u0=per/4,u1=(per+len)/4;per+=len;
      const sh=0.86+0.14*Math.abs(nx);                                 // fachadas com tons levemente diferentes
      // (a0,b1,b0) e (a0,a1,b1): frente para fora
      const V=[ax,y0,az, bx,y1,bz, bx,y0,bz, ax,y0,az, ax,y1,az, bx,y1,bz];
      const U=b.wall?[0.05,0.5,0.05,0.5,0.05,0.5,0.05,0.5,0.05,0.5,0.05,0.5]:[u0,0,u1,vTop,u1,0,u0,0,u0,vTop,u1,vTop];   // muro: parte lisa da textura
      for(let q=0;q<6;q++){const k=(iw+q)*3;wp[k]=V[q*3];wp[k+1]=V[q*3+1];wp[k+2]=V[q*3+2];wn[k]=nx;wn[k+1]=0;wn[k+2]=nz;wc[k]=cr*sh;wc[k+1]=cg*sh;wc[k+2]=cb*sh;
        wu[(iw+q)*2]=U[q*2];wu[(iw+q)*2+1]=U[q*2+1];}
      iw+=6;
    }
    // topo: telha cerâmica nas casas, laje cinza nos prédios, a própria cor no muro
    const t0=b.wall?cr*0.9:b.h<9?0.66:0.58,t1=b.wall?cg*0.9:b.h<9?0.37:0.6,t2=b.wall?cb*0.9:b.h<9?0.27:0.62;
    for(let k=0;k<tris.length;k+=3){const A=tris[k],B2=tris[k+1],Cc=tris[k+2];
      const cy=(R[2*B2+1]-R[2*A+1])*(R[2*Cc]-R[2*A])-(R[2*B2]-R[2*A])*(R[2*Cc+1]-R[2*A+1]);
      const ord=cy>0?[A,B2,Cc]:[A,Cc,B2];                               // normal para cima
      for(const v of ord){const q=ir*3;rp[q]=R[2*v];rp[q+1]=y1;rp[q+2]=R[2*v+1];rn[q+1]=1;rc[q]=t0;rc[q+1]=t1;rc[q+2]=t2;ir++;}
    }
  }
  const g1=new THREE.BufferGeometry();g1.setAttribute('position',new THREE.BufferAttribute(wp,3));g1.setAttribute('normal',new THREE.BufferAttribute(wn,3));
  g1.setAttribute('color',new THREE.BufferAttribute(wc,3));g1.setAttribute('uv',new THREE.BufferAttribute(wu,2));g1.computeBoundingSphere();
  const g2=new THREE.BufferGeometry();g2.setAttribute('position',new THREE.BufferAttribute(rp,3));g2.setAttribute('normal',new THREE.BufferAttribute(rn,3));
  g2.setAttribute('color',new THREE.BufferAttribute(rc,3));g2.computeBoundingSphere();
  const grp=new THREE.Group();grp.add(new THREE.Mesh(g1,wallMat),new THREE.Mesh(g2,roofMat));
  return grp;
}

// ---------------------------------------------------------------- montagem por bloco perto da câmera
const pending=new Map();                       // bloco do mapa -> lista já gerada, esperando a malha
function genList(ch){let l=pending.get(ch);if(!l){l=(ch.osmB||[]).concat(blocksOf(ch));pending.set(ch,l);}return l;}
function ensure(ch){ // monta os prédios de um bloco (se ainda não montou) e devolve a lista
  let st=P.chunks.get(ch);if(st) return st.list;
  const list=genList(ch);pending.delete(ch);
  const mesh=buildMeshes(list);scene.add(mesh);
  P.chunks.set(ch,{list,mesh});return list;
}
function step(ch){ // metade do trabalho por vez (gera num quadro, monta a malha no seguinte); devolve true quando terminou
  if(P.chunks.has(ch)) return true;
  if(!pending.has(ch)){genList(ch);return false;}
  ensure(ch);return true;
}
function drop(ch){pending.delete(ch);const st=P.chunks.get(ch);if(!st)return;scene.remove(st.mesh);st.mesh.traverse(o=>{if(o.geometry)o.geometry.dispose();});P.chunks.delete(ch);}
P.update=function(now,focus){
  if(!P.ready||!CHUNKS.length) return;
  if(now-P.last>300){P.last=now;
    const fx=focus.x,fz=focus.z,R=P.radius;
    P.queue=CHUNKS.filter(ch=>!P.chunks.has(ch)&&Math.hypot(ch.cx-fx,ch.cz-fz)<R).sort((a,b)=>Math.hypot(a.cx-fx,a.cz-fz)-Math.hypot(b.cx-fx,b.cz-fz));
    for(const ch of [...P.chunks.keys()]) if(Math.hypot(ch.cx-fx,ch.cz-fz)>R*1.35) drop(ch);
  }
  const t0=performance.now();
  while(P.queue.length&&performance.now()-t0<5){if(step(P.queue[0]))P.queue.shift();else break;}   // no máximo uma etapa pesada por quadro
};
P.setRadius=r=>{P.radius=r;P.last=0;};

// ---------------------------------------------------------------- colisão e oclusão (usadas pelo jogo)
function eachNear(x,z,r,cb){
  for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const ch=chunkAt(x+di*META.chunk*0.5,z+dj*META.chunk*0.5);if(!ch)continue;
    const st=P.chunks.get(ch);if(!st)continue;if(st._s===P._stamp)continue;st._s=P._stamp;
    for(const b of st.list) if(x+r>b.bb[0]&&x-r<b.bb[1]&&z+r>b.bb[2]&&z-r<b.bb[3]) cb(b);}
}
// empurra um círculo (x,z,raio) para fora dos prédios; devolve {nx,nz,pen} do maior contato ou null
P.pushOut=function(x,z,rad){
  if(!P.ready) return null;const ch=chunkAt(x,z);if(ch&&!P.chunks.has(ch))ensure(ch);
  P._stamp=(P._stamp||0)+1;let best=null;
  eachNear(x,z,rad+1,b=>{
    const R=b.R,n=R.length/2;let bd=1e9,bx=0,bz=0;
    for(let i=0;i<n;i++){const j=(i+1)%n,ax=R[2*i],az=R[2*i+1],dx=R[2*j]-ax,dz=R[2*j+1]-az,L2=dx*dx+dz*dz||1;
      const t=clamp(((x-ax)*dx+(z-az)*dz)/L2,0,1),px=ax+dx*t,pz=az+dz*t,d=Math.hypot(x-px,z-pz);if(d<bd){bd=d;bx=px;bz=pz;}}
    const inside=inRing(x,z,R);
    if(!inside&&bd>=rad) return;
    let nx=(x-bx)/(bd||1),nz=(z-bz)/(bd||1);if(inside){nx=-nx;nz=-nz;}
    const pen=inside?bd+rad:rad-bd;
    if(!best||pen>best.pen) best={nx,nz,pen};
  });
  return best;
};
// a câmera está dentro de algum prédio (abaixo do telhado)?
P.blocked=function(x,y,z){
  if(!P.ready) return false;P._stamp=(P._stamp||0)+1;let hit=false;
  eachNear(x,z,0.5,b=>{if(!hit&&y<(b.top||0)+0.5&&inRing(x,z,b.R))hit=true;});
  return hit;
};

// espera o mapa ficar pronto para carregar os prédios
(function wait(){if(typeof ready!=='undefined'&&ready&&META)load();else setTimeout(wait,300);})();
})();
