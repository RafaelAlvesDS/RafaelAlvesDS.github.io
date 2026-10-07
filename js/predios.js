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

async function load(){
  CENTRO=[(-47.9318-META.lon0)*META.mLon,(META.lat0-(-19.7483))*META.mLat];  // Praça Rui Barbosa, centro de Uberaba
  try{const r=await fetch(DATA+'predios.json',{cache:'no-cache'});if(r.ok){const d=await r.json();P.osm=d;}}catch(e){}
  if(P.osm){
    const C=META.chunk;
    for(const [hd,lv,k,p] of P.osm.b){
      const R=Float32Array.from(p,v=>v/10),bb=bbOf(R),cx=(bb[0]+bb[1])/2,cz=(bb[2]+bb[3])/2;
      const ch=chunkAt(cx,cz);if(!ch)continue;
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
    for(const side of [1,-1]){
      const r=rng(e.i*2+(side>0?1:0)+7919);
      const t0=DEG[e.a]>=3?13:4,t1=DEG[e.b]>=3?13:4;
      let s=t0+between(r,0,4);
      const P=e.P;let k=0,acc=0;
      while(s<e.len-t1){
        const lotW=between(r,9,14),depth=between(r,10,17);
        // ponto e direção a s metros do início da via
        while(k<P.length/2-2){const l=Math.hypot(P[2*k+2]-P[2*k],P[2*k+3]-P[2*k+1]);if(acc+l>=s+lotW/2)break;acc+=l;k++;}
        const l=Math.hypot(P[2*k+2]-P[2*k],P[2*k+3]-P[2*k+1])||1,f=clamp((s+lotW/2-acc)/l,0,1);
        const dx=(P[2*k+2]-P[2*k])/l,dz=(P[2*k+3]-P[2*k+1])/l,rx=-dz*side,rz=dx*side;
        const px=P[2*k]+(P[2*k+2]-P[2*k])*f,pz=P[2*k+1]+(P[2*k+3]-P[2*k+1])*f;
        const back=e.w/2+3.2,cx=px+rx*(back+depth/2),cz=pz+rz*(back+depth/2);
        s+=lotW;
        if(cx<ch.x0||cx>=ch.x0+C||cz<ch.z0||cz>=ch.z0+C) continue;          // o lote pertence a outro bloco
        const hw=(lotW-1.4)/2,hd=depth/2;
        const R=new Float32Array([cx-dx*hw-rx*hd,cz-dz*hw-rz*hd, cx+dx*hw-rx*hd,cz+dz*hw-rz*hd, cx+dx*hw+rx*hd,cz+dz*hw+rz*hd, cx-dx*hw+rx*hd,cz-dz*hw+rz*hd]);
        let ok=true;
        for(let q=0;q<8&&ok;q+=2) for(const o of roads){if(o.bb[0]-o.w>R[q]||o.bb[1]+o.w<R[q]||o.bb[2]-o.w>R[q+1]||o.bb[3]+o.w<R[q+1])continue;
          if(segDist(R[q],R[q+1],o.P)<o.w/2+2.2){ok=false;break;}}
        if(ok) for(const a of blockAreas) if(cx>a.bb[0]&&cx<a.bb[1]&&cz>a.bb[2]&&cz<a.bb[3]&&inRing(cx,cz,a.P)){ok=false;break;}
        const bb=bbOf(R);if(!ok||hits(bb)) continue;
        addOcc(null,bb);
        // altura pela zona: centro e avenidas mais altos, bairros com casas
        const dc=Math.hypot(cx-CENTRO[0],cz-CENTRO[1]),u=r();let floors;
        if(dc<900) floors=u<(e.av?0.16:0.06)?Math.round(between(r,6,16)):Math.round(between(r,1.6,4.4));
        else if(dc<2600) floors=u<(e.av?0.06:0.015)?Math.round(between(r,4,10)):Math.round(between(r,1,2.6));
        else floors=u<(e.av?0.05:0.015)?Math.round(between(r,3,6)):(u<0.35?2:1);
        const h=floors*3.1+between(r,0.3,1.2);
        out.push({R,bb,h,floors,tall:floors>=5,osm:false,col:(floors>=5?WALL_TALL:WALL_HOUSE)[(r()*(floors>=5?WALL_TALL:WALL_HOUSE).length)|0]});
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
    const y0=lo-1,y1=hi+b.h;b.top=y1;
    if(!b.col){const r=rng(Math.round(b.bb[0]*3+b.bb[2]*5));b.col=(b.h>14?WALL_TALL:WALL_HOUSE)[(r()*(b.h>14?WALL_TALL:WALL_HOUSE).length)|0];}
    tmpC.set(b.col);const cr=tmpC.r,cg=tmpC.g,cb=tmpC.b;
    let per=0;const vTop=(y1-y0)/3.1;
    for(let i=0;i<n;i++){const j=(i+1)%n,ax=R[2*i],az=R[2*i+1],bx=R[2*j],bz=R[2*j+1],len=Math.hypot(bx-ax,bz-az);if(len<0.05)continue;
      const nx=(bz-az)/len,nz=-(bx-ax)/len,u0=per/4,u1=(per+len)/4;per+=len;
      const sh=0.86+0.14*Math.abs(nx);                                 // fachadas com tons levemente diferentes
      // (a0,b1,b0) e (a0,a1,b1): frente para fora
      wp.push(ax,y0,az, bx,y1,bz, bx,y0,bz, ax,y0,az, ax,y1,az, bx,y1,bz);
      wu.push(u0,0, u1,vTop, u1,0, u0,0, u0,vTop, u1,vTop);
      for(let q=0;q<6;q++){wn.push(nx,0,nz);wc.push(cr*sh,cg*sh,cb*sh);}
    }
    // telhado: telha cerâmica nas casas, laje cinza nos prédios
    const roof=b.h<9?[0.66,0.37,0.27]:[0.58,0.6,0.62];
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
  const list=(ch.osmB||[]).concat(proc);
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
