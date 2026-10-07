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
  P.ready=true;
}

// ---------------------------------------------------------------- preenchimento procedural de um bloco
const WALL_HOUSE=['#e9e3d5','#f1e7c9','#e7d1c0','#dadfe2','#cad8c6','#efe9e1','#dcc6a7','#c4ccd2','#e5d6b7','#f0d9c4','#d5e0d8'];
const WALL_TALL=['#d2d6d9','#bcc4ca','#e2ded6','#aeb7be','#cbc6bd','#9fa9b1'];
// muros: ficam no alinhamento predial, a uma distância fixa do meio da rua (meia pista + calçada),
// então todos os muros de um lado da rua ficam na mesma linha, inclusive em curva
const CALC=2.8,MURO_E=0.2;
const MURO_COL=['#d9d3c5','#e6e0d2','#cbc4b5','#bfb9ab','#e3d5be','#d4dad6','#ece6da','#c8bba6','#d8c7b0'];
function rect(cx,cz,dx,dz,rx,rz,hw,hd){return new Float32Array([cx-dx*hw-rx*hd,cz-dz*hw-rz*hd, cx+dx*hw-rx*hd,cz+dz*hw-rz*hd, cx+dx*hw+rx*hd,cz+dz*hw+rz*hd, cx-dx*hw+rx*hd,cz-dz*hw+rz*hd]);}
function edgeCum(e){if(e._cum)return e._cum;const P=e.P,n=P.length/2,C=new Float32Array(n);for(let i=1;i<n;i++)C[i]=C[i-1]+Math.hypot(P[2*i]-P[2*i-2],P[2*i+1]-P[2*i-1]);return e._cum=C;}
function sideLines(e,side){ // [face da calçada, face de dentro] do muro, paralelas ao eixo da rua
  const k=side>0?'_wl1':'_wl0';if(e[k])return e[k];const off=e.w/2+CALC;
  return e[k]=[offsetFlat(e.P,side*off),offsetFlat(e.P,side*(off+MURO_E))];
}
function atS(e,L,s){const C=edgeCum(e),n=C.length;let i=1;while(i<n-1&&C[i]<s)i++;const f=clamp((s-C[i-1])/((C[i]-C[i-1])||1),0,1);
  return [L[2*i-2]+(L[2*i]-L[2*i-2])*f,L[2*i-1]+(L[2*i+1]-L[2*i-1])*f];}
function wallPieces(e,side,s0,s1,h,col,out){ // trecho de muro entre s0 e s1 (metros ao longo da rua)
  if(s1-s0<0.3) return;const [A,B]=sideLines(e,side),C=edgeCum(e),ss=[s0];
  for(let i=1;i<C.length-1;i++) if(C[i]>s0+0.05&&C[i]<s1-0.05) ss.push(C[i]);ss.push(s1);
  for(let i=0;i<ss.length-1;i++){const R=new Float32Array([...atS(e,A,ss[i]),...atS(e,A,ss[i+1]),...atS(e,B,ss[i+1]),...atS(e,B,ss[i])]);
    out.push({R,bb:bbOf(R),h,col,wall:true});}
}
// muro na frente das casas reais do OSM, na mesma linha dos procedurais da rua mais próxima
function osmWalls(ch,out){
  const taken=new Map(),roads=ch.edges.filter(e=>!['motorway','trunk','service','footway','motorway_link','trunk_link'].includes(e.cls)&&!e.bridge);
  for(const b of ch.osmB||[]){
    if(b.h>9||(b.bb[1]-b.bb[0])*(b.bb[3]-b.bb[2])>500) continue;
    const cx=(b.bb[0]+b.bb[1])/2,cz=(b.bb[2]+b.bb[3])/2;let best=null,bd=1e9;
    for(const e of roads){if(cx<e.bb[0]-40||cx>e.bb[1]+40||cz<e.bb[2]-40||cz>e.bb[3]+40)continue;const d=segDist(cx,cz,e.P)-e.w/2;if(d<bd){bd=d;best=e;}}
    if(!best||bd>28) continue;
    const e=best,off=e.w/2+CALC;
    // a casa precisa estar inteira atrás do alinhamento
    let near=1e9;for(let i=0;i<b.R.length;i+=2)near=Math.min(near,segDist(b.R[i],b.R[i+1],e.P));if(near<off+MURO_E+0.4) continue;
    // posição ao longo da rua e lado
    const C=edgeCum(e),P=e.P;let k0=0,t0=0,dmin=1e9;
    for(let i=0;i<P.length/2-1;i++){const ax=P[2*i],az=P[2*i+1],dx=P[2*i+2]-ax,dz=P[2*i+3]-az,L2=dx*dx+dz*dz||1,t=clamp(((cx-ax)*dx+(cz-az)*dz)/L2,0,1),d=Math.hypot(cx-ax-dx*t,cz-az-dz*t);if(d<dmin){dmin=d;k0=i;t0=t;}}
    const ax=P[2*k0],az=P[2*k0+1],L=Math.hypot(P[2*k0+2]-ax,P[2*k0+3]-az)||1,dx=(P[2*k0+2]-ax)/L,dz=(P[2*k0+3]-az)/L,sMid=C[k0]+t0*L;
    const side=(-dz*(cx-ax)+dx*(cz-az))>0?1:-1;
    let lo=1e9,hi=-1e9;for(let i=0;i<b.R.length;i+=2){const s=sMid+(b.R[i]-cx)*dx+(b.R[i+1]-cz)*dz;lo=Math.min(lo,s);hi=Math.max(hi,s);}
    lo=Math.max(DEG[e.a]>=3?11:2,lo-0.8);hi=Math.min(e.len-(DEG[e.b]>=3?11:2),hi+0.8);if(hi-lo<2) continue;
    // não sobrepor muro já feito neste lado da rua
    const key=e.i*2+(side>0?1:0);let used=taken.get(key);if(!used)taken.set(key,used=[]);
    let parts=[[lo,hi]];for(const [a,b2] of used){const np=[];for(const [x,y] of parts){if(b2<=x||a>=y){np.push([x,y]);continue;}if(a>x)np.push([x,a]);if(b2<y)np.push([b2,y]);}parts=np;}
    used.push([lo,hi]);
    const r=rng(Math.round(cx*11+cz*7)),mc=MURO_COL[(r()*MURO_COL.length)|0],mh=between(r,1.9,2.3);
    for(const [x,y] of parts) wallPieces(e,side,x,y,mh,mc,out);
  }
}
function procedural(ch){
  const out=[],placed=[],cell=new Map(),CK=12;
  const key=(x,z)=>Math.floor(x/CK)*100003+Math.floor(z/CK);
  const addOcc=(b,bb)=>{for(let x=Math.floor(bb[0]/CK);x<=Math.floor(bb[1]/CK);x++)for(let z=Math.floor(bb[2]/CK);z<=Math.floor(bb[3]/CK);z++){const k=x*100003+z;let a=cell.get(k);if(!a)cell.set(k,a=[]);a.push(bb);}};
  const hits=bb=>{for(let x=Math.floor(bb[0]/CK);x<=Math.floor(bb[1]/CK);x++)for(let z=Math.floor(bb[2]/CK);z<=Math.floor(bb[3]/CK);z++){const a=cell.get(x*100003+z);
    if(a)for(const o of a)if(bb[0]<o[1]&&bb[1]>o[0]&&bb[2]<o[3]&&bb[3]>o[2])return true;}return false;};
  // prédios reais deste bloco e dos vizinhos ocupam espaço
  for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const n=chunkAt(ch.cx+di*META.chunk,ch.cz+dj*META.chunk);if(n&&n.osmB)for(const b of n.osmB)addOcc(b,[b.bb[0]-1,b.bb[1]+1,b.bb[2]-1,b.bb[3]+1]);}
  const blockAreas=ch.areas.filter(a=>NO_BUILD.has(a.kind));
  const roads=ch.edges.filter(e=>e.cls!=='footway');
  const C=META.chunk;
  for(const e of ch.edges){
    if(['motorway','trunk','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link','service','living_street'].includes(e.cls)||e.bridge||e.len<20) continue;
    const off=e.w/2+CALC;
    for(const side of [1,-1]){
      const r=rng(e.i*2+(side>0?1:0)+7919);
      const t0=DEG[e.a]>=3?13:4,t1=DEG[e.b]>=3?13:4;
      let s=t0+between(r,0,4),prevPlaced=false;
      while(s<e.len-t1){
        const lotW=between(r,9,14),depth=between(r,10,17),s0=s,s1=s+lotW;s=s1;
        if(s1>e.len-t1) break;
        const sc=(s0+s1)/2,[px,pz]=atS(e,e.P,sc),[qx,qz]=atS(e,e.P,Math.min(e.len,sc+0.5)),[ox,oz]=atS(e,e.P,Math.max(0,sc-0.5));
        let dx=qx-ox,dz=qz-oz;const dl=Math.hypot(dx,dz)||1;dx/=dl;dz/=dl;
        const rx=-dz*side,rz=dx*side;
        // altura pela zona: centro e avenidas mais altos, bairros com casas
        const dc=Math.hypot(px-CENTRO[0],pz-CENTRO[1]),u=r();let floors;
        if(dc<900) floors=u<(e.av?0.16:0.06)?Math.round(between(r,6,16)):Math.round(between(r,1.6,4.4));
        else if(dc<2600) floors=u<(e.av?0.06:0.015)?Math.round(between(r,4,10)):Math.round(between(r,1,2.6));
        else floors=u<(e.av?0.05:0.015)?Math.round(between(r,3,6)):(u<0.35?2:1);
        const house=floors<=2,recuo=house?between(r,2.6,5):0.4;
        // muro no alinhamento (off), casa recuada atrás dele; prédio colado na calçada
        const front=off+MURO_E+recuo,cx=px+rx*(front+depth/2),cz=pz+rz*(front+depth/2);
        if(cx<ch.x0||cx>=ch.x0+C||cz<ch.z0||cz>=ch.z0+C){prevPlaced=false;continue;}   // o lote pertence a outro bloco
        const R=rect(cx,cz,dx,dz,rx,rz,(lotW-(house?1.8:1.2))/2,depth/2);
        const ld=MURO_E+recuo+depth,lc=off+ld/2,lot=rect(px+rx*lc,pz+rz*lc,dx,dz,rx,rz,lotW/2-0.05,ld/2);
        let ok=true;
        for(let q=0;q<8&&ok;q+=2) for(const o of roads){if(o.bb[0]-o.w>lot[q]||o.bb[1]+o.w<lot[q]||o.bb[2]-o.w>lot[q+1]||o.bb[3]+o.w<lot[q+1])continue;
          if(segDist(lot[q],lot[q+1],o.P)<o.w/2+(o===e?CALC-0.1:2.6)){ok=false;break;}}
        if(ok) for(const a of blockAreas) if(cx>a.bb[0]&&cx<a.bb[1]&&cz>a.bb[2]&&cz<a.bb[3]&&inRing(cx,cz,a.P)){ok=false;break;}
        const lbb=bbOf(lot);if(!ok||hits(lbb)){prevPlaced=false;continue;}
        addOcc(null,lbb);
        const h=floors*3.1+between(r,0.3,1.2);
        out.push({R,bb:bbOf(R),h,floors,tall:floors>=5,osm:false,col:(floors>=5?WALL_TALL:WALL_HOUSE)[(r()*(floors>=5?WALL_TALL:WALL_HOUSE).length)|0]});
        if(!house){prevPlaced=false;continue;}
        // muro da frente com portão de garagem, e muros laterais até a casa
        const mc=MURO_COL[(r()*MURO_COL.length)|0],mh=between(r,1.9,2.3),gw=3,g0=r()<0.5?s0+0.7:s1-0.7-gw;
        wallPieces(e,side,s0,g0,mh,mc,out);wallPieces(e,side,g0,g0+gw,mh-0.15,'#4a4f55',out);wallPieces(e,side,g0+gw,s1,mh,mc,out);
        for(const sb of prevPlaced?[s1]:[s0,s1]){const [ax,az]=atS(e,sideLines(e,side)[1],sb);
          const W=rect(ax+rx*recuo/2,az+rz*recuo/2,dx,dz,rx,rz,0.09,recuo/2);out.push({R:W,bb:bbOf(W),h:mh,col:mc,wall:true});}
        prevPlaced=true;
      }
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
  const wp=[],wn=[],wc=[],wu=[],rp=[],rn=[],rc=[];
  for(const b of list){
    let R=b.R;if(ringArea(R)<0)R=revFlat(R);                         // anel anti-horário: normais das paredes para fora
    const n=R.length/2;let lo=1e9,hi=-1e9;for(let i=0;i<n;i++){const y=H(R[2*i],R[2*i+1]);lo=Math.min(lo,y);hi=Math.max(hi,y);}
    const y0=lo-(b.wall?0.3:1),y1=hi+b.h;b.top=y1;
    if(!b.col){const r=rng(Math.round(b.bb[0]*3+b.bb[2]*5));b.col=(b.h>14?WALL_TALL:WALL_HOUSE)[(r()*(b.h>14?WALL_TALL:WALL_HOUSE).length)|0];}
    tmpC.set(b.col);const cr=tmpC.r,cg=tmpC.g,cb=tmpC.b;
    let per=0;const vTop=b.wall?0:(y1-y0)/3.1;
    for(let i=0;i<n;i++){const j=(i+1)%n,ax=R[2*i],az=R[2*i+1],bx=R[2*j],bz=R[2*j+1],len=Math.hypot(bx-ax,bz-az);if(len<0.05)continue;
      const nx=(bz-az)/len,nz=-(bx-ax)/len,u0=per/4,u1=(per+len)/4;per+=len;
      const sh=0.86+0.14*Math.abs(nx);                                 // fachadas com tons levemente diferentes
      // (a0,b1,b0) e (a0,a1,b1): frente para fora
      wp.push(ax,y0,az, bx,y1,bz, bx,y0,bz, ax,y0,az, ax,y1,az, bx,y1,bz);
      if(b.wall) wu.push(0.05,0.5, 0.05,0.5, 0.05,0.5, 0.05,0.5, 0.05,0.5, 0.05,0.5);   // parte lisa da textura
      else wu.push(u0,0, u1,vTop, u1,0, u0,0, u0,vTop, u1,vTop);
      for(let q=0;q<6;q++){wn.push(nx,0,nz);wc.push(cr*sh,cg*sh,cb*sh);}
    }
    // telhado: telha cerâmica nas casas, laje cinza nos prédios
    const roof=b.wall?[cr*0.9,cg*0.9,cb*0.9]:b.h<9?[0.66,0.37,0.27]:[0.58,0.6,0.62];
    const pts=[];for(let i=0;i<n;i++)pts.push(new THREE.Vector2(R[2*i],R[2*i+1]));
    let tris=[];try{tris=THREE.ShapeUtils.triangulateShape(pts,[]);}catch(e){}
    for(const [a,b2,c] of tris){
      const A=pts[a],B2=pts[b2],Cc=pts[c],cy=(B2.y-A.y)*(Cc.x-A.x)-(B2.x-A.x)*(Cc.y-A.y);
      const order=cy>0?[A,B2,Cc]:[A,Cc,B2];                           // normal para cima
      for(const v of order){rp.push(v.x,y1,v.y);rn.push(0,1,0);rc.push(...roof);}
    }
  }
  const g1=new THREE.BufferGeometry();g1.setAttribute('position',new THREE.Float32BufferAttribute(wp,3));g1.setAttribute('normal',new THREE.Float32BufferAttribute(wn,3));
  g1.setAttribute('color',new THREE.Float32BufferAttribute(wc,3));g1.setAttribute('uv',new THREE.Float32BufferAttribute(wu,2));g1.computeBoundingSphere();
  const g2=new THREE.BufferGeometry();g2.setAttribute('position',new THREE.Float32BufferAttribute(rp,3));g2.setAttribute('normal',new THREE.Float32BufferAttribute(rn,3));
  g2.setAttribute('color',new THREE.Float32BufferAttribute(rc,3));g2.computeBoundingSphere();
  const grp=new THREE.Group();grp.add(new THREE.Mesh(g1,wallMat),new THREE.Mesh(g2,roofMat));
  return grp;
}

// ---------------------------------------------------------------- montagem por bloco perto da câmera
function ensure(ch){ // monta os prédios de um bloco (se ainda não montou) e devolve a lista
  let st=P.chunks.get(ch);if(st) return st.list;
  const proc=procedural(ch);P.stats.proc+=proc.length;
  const walls=[];osmWalls(ch,walls);
  const list=(ch.osmB||[]).concat(proc,walls);
  const mesh=buildMeshes(list);scene.add(mesh);
  P.chunks.set(ch,{list,mesh});return list;
}
function drop(ch){const st=P.chunks.get(ch);if(!st)return;scene.remove(st.mesh);st.mesh.traverse(o=>{if(o.geometry)o.geometry.dispose();});P.chunks.delete(ch);}
P.update=function(now,focus){
  if(!P.ready||!CHUNKS.length) return;
  if(now-P.last>300){P.last=now;
    const fx=focus.x,fz=focus.z,R=P.radius;
    P.queue=CHUNKS.filter(ch=>!P.chunks.has(ch)&&Math.hypot(ch.cx-fx,ch.cz-fz)<R).sort((a,b)=>Math.hypot(a.cx-fx,a.cz-fz)-Math.hypot(b.cx-fx,b.cz-fz));
    for(const ch of [...P.chunks.keys()]) if(Math.hypot(ch.cx-fx,ch.cz-fz)>R*1.35) drop(ch);
  }
  const t0=performance.now();
  while(P.queue.length&&performance.now()-t0<6){ensure(P.queue.shift());}
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
