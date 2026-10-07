/* Uberaba 3D — modo de jogo: dirigir livre e corridas de rua por checkpoints.
 *
 * Usa o que uberaba.html já montou: relevo H(x,z), grafo de vias (NODES, EDGES, ADJ), blocos do mapa (CHUNKS, chunkAt),
 * trânsito da CPU (TRAFFIC, grid, sense, Vehicle) e a cena three.js (scene, camera, controls).
 *
 * Mecânica de corrida de rua arcade em mundo aberto:
 *  - física arcade: aceleração forte, freio de mão para derrapar, aderência que segura o carro nas curvas;
 *  - nitro: gasta segurando Shift; recarrega derrapando, passando raspando no trânsito e pegando vácuo;
 *  - vácuo: colado atrás de outro carro, a barra enche e dá velocidade extra;
 *  - saltos: em lombadas do relevo, em alta velocidade, o carro sai do chão;
 *  - corrida: checkpoints em sequência, rota livre (pode cortar caminho), rivais da CPU que ultrapassam e se recuperam
 *    quando ficam para trás, trânsito no meio do caminho.
 */
(function(){
'use strict';

// ---------------------------------------------------------------- estilos do HUD
const css=document.createElement('style');
css.textContent=`
.g-hud{position:absolute;inset:0;pointer-events:none;font-family:var(--f-body);color:#fff}
.g-hud .sh{text-shadow:0 1px 2px #000a,0 0 8px #0006}
.g-speed{position:absolute;right:22px;bottom:22px;text-align:right}
.g-speed .v{font:600 64px/0.9 var(--f-display);letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.g-speed .u{font:500 13px var(--f-mono);opacity:.85}
.g-speed .gear{font:600 22px var(--f-display);margin-right:10px;opacity:.9}
.g-bars{margin-top:8px;display:grid;gap:5px;justify-items:end}
.g-bar{width:200px;height:9px;background:#0007;border:1px solid #fff5;border-radius:2px;overflow:hidden;position:relative}
.g-bar i{position:absolute;left:0;top:0;bottom:0;background:#38c6f4;width:0}
.g-bar.d i{background:#f2b234}
.g-bar span{position:absolute;right:calc(100% + 8px);top:-4px;font:600 11px var(--f-display);letter-spacing:.12em;white-space:nowrap}
.g-race{position:absolute;left:22px;top:18px}
.g-race .pos{font:700 52px/0.95 var(--f-display)} .g-race .pos small{font-size:22px;opacity:.85}
.g-race .row{font:500 14px var(--f-mono);margin-top:4px;font-variant-numeric:tabular-nums}
.g-mm{position:absolute;right:18px;top:18px;width:190px;height:190px;border-radius:50%;overflow:hidden;border:2px solid #fff8;box-shadow:0 2px 12px #0006;background:#26323a}
.g-count{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font:700 120px var(--f-display)}
.g-pop{position:absolute;left:50%;top:30%;transform:translateX(-50%);font:700 26px var(--f-display);letter-spacing:.08em;color:#f2b234;opacity:0;transition:opacity .2s}
.g-help{position:absolute;left:22px;bottom:22px;font:500 12px var(--f-mono);line-height:1.6;background:#0008;padding:8px 11px;border-radius:4px;max-width:330px}
.g-help b{color:#f2b234}
.g-menu{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0007;pointer-events:auto}
.g-menu .box{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:18px 20px;min-width:min(380px,calc(100% - 40px))}
.g-menu h2{margin:0 0 10px;font:700 26px var(--f-display)}
.g-menu table{width:100%;border-collapse:collapse;font:500 13.5px var(--f-mono);margin:6px 0 14px;font-variant-numeric:tabular-nums}
.g-menu td{padding:4px 6px;border-bottom:1px solid var(--line)} .g-menu tr.me td{color:var(--accent);font-weight:600}
.g-menu .btns{display:flex;flex-wrap:wrap;gap:8px}
.g-menu button{background:var(--accent);color:var(--accent-ink);padding:9px 14px}
.g-menu button.alt{background:transparent;color:var(--ink);border:1px solid var(--line)}
.g-touch{position:absolute;inset:auto 0 0 0;height:190px;pointer-events:none}
.g-touch button{pointer-events:auto;position:absolute;width:74px;height:74px;border-radius:50%;background:#0006;color:#fff;border:2px solid #fff7;font:700 13px var(--f-display);letter-spacing:.06em;touch-action:none}
.g-play .card,.g-play .dock,.g-play #loadbar{display:none!important}
`;
document.head.appendChild(css);

// ---------------------------------------------------------------- utilidades
const TAU=Math.PI*2;
const angDiff=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const el=(tag,cls,parent,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;if(parent)parent.appendChild(e);return e;};
const fmtTime=t=>{const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(2);};

// segmento mais próximo de uma via: {e, d (distância à borda), along}
function nearestRoad(x,z){
  const ch=chunkAt(x,z);if(!ch) return null;
  let best=null,bd=1e9;
  for(const e of ch.edges){const P=e.P;
    for(let i=0;i<P.length-2;i+=2){const ax=P[i],az=P[i+1],dx=P[i+2]-ax,dz=P[i+3]-az,L2=dx*dx+dz*dz||1;
      const t=clamp(((x-ax)*dx+(z-az)*dz)/L2,0,1),px=ax+dx*t,pz=az+dz*t,d=Math.hypot(x-px,z-pz)-e.w/2;
      if(d<bd){bd=d;best={e,d,px,pz,dx,dz};}}}
  return best;
}
function nearestNode(x,z,filter){
  let best=-1,bd=1e18;const n=NODES.length/2;
  for(let i=0;i<n;i++){if(!ADJ[i].length||(filter&&!filter(i)))continue;const d=(NODES[2*i]-x)**2+(NODES[2*i+1]-z)**2;if(d<bd){bd=d;best=i;}}
  return best;
}

// ---------------------------------------------------------------- rotas: A* no grafo (prefere avenidas rápidas)
function edgeCost(e){if(e.priv||e.aisle)return e.len*20;return e.len/(Math.min(e.vmax,28)*(e.av?1.35:1)*(e.cls==='service'?0.4:1));}
function astar(s,t){
  if(s<0||t<0) return null;if(s===t) return [];
  const tx=NODES[2*t],tz=NODES[2*t+1],h=i=>Math.hypot(NODES[2*i]-tx,NODES[2*i+1]-tz)/38;
  const g=new Map([[s,0]]),came=new Map(),heap=[[h(s),s]],closed=new Set();
  const push=(f,i)=>{heap.push([f,i]);let k=heap.length-1;while(k){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p;}};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;
    if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m;}}return top;};
  let it=0;
  while(heap.length&&it++<200000){
    const [,u]=pop();if(u===t)break;if(closed.has(u))continue;closed.add(u);
    for(const o of ADJ[u]){const e=EDGES[o.e],v=o.dir>0?e.b:e.a,ng=g.get(u)+edgeCost(e);
      if(ng<(g.has(v)?g.get(v):1e18)){g.set(v,ng);came.set(v,o);push(ng+h(v),v);}}
  }
  if(!came.has(t)) return null;
  const legs=[];let v=t;
  while(v!==s){const o=came.get(v);legs.push(o);const e=EDGES[o.e];v=o.dir>0?e.a:e.b;}
  return legs.reverse();
}
function legsToPath(legs,into){ // linha central contínua das pernas, com largura por ponto
  const P=into?into.P:[],W=into?into.W:[];
  for(const o of legs){const e=EDGES[o.e],Q=o.dir>0?e.P:revFlat(e.P);
    for(let k=0;k<Q.length;k+=2){if(P.length&&k===0&&Math.hypot(Q[0]-P[P.length-2],Q[1]-P[P.length-1])<0.5)continue;P.push(Q[k],Q[k+1]);W.push(e.w);}}
  return {P,W};
}
function withCum(path){const P=path.P,n=P.length/2,C=new Float32Array(n);for(let i=1;i<n;i++)C[i]=C[i-1]+Math.hypot(P[2*i]-P[2*i-2],P[2*i+1]-P[2*i-1]);path.C=C;path.len=C[n-1]||0;return path;}
function pathAt(path,s){ // ponto, direção e largura a s metros do início
  const P=path.P,C=path.C,n=C.length;s=clamp(s,0,path.len);
  let lo=0,hi=n-1;while(hi-lo>1){const m=(lo+hi)>>1;if(C[m]<=s)lo=m;else hi=m;}
  const L=(C[hi]-C[lo])||1,f=(s-C[lo])/L,dx=P[2*hi]-P[2*lo],dz=P[2*hi+1]-P[2*lo+1],dl=Math.hypot(dx,dz)||1;
  return {x:P[2*lo]+dx*f,z:P[2*lo+1]+dz*f,dx:dx/dl,dz:dz/dl,w:path.W[lo],i:lo};
}

// ---------------------------------------------------------------- modelos 3D dos carros
function carMesh(color){
  const g=new THREE.Group(),paint=new THREE.MeshLambertMaterial({color}),dark=new THREE.MeshLambertMaterial({color:0x17191d}),
    glass=new THREE.MeshLambertMaterial({color:0x2b3b4c}),box=(sx,sy,sz,x,y,z,m)=>{const b=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),m);b.position.set(x,y,z);g.add(b);return b;};
  box(4.4,0.46,1.96,0,0.55,0,paint);                 // carroceria
  box(1.5,0.16,1.9,1.45,0.84,0,paint);               // capô
  box(2.1,0.5,1.72,-0.3,1.02,0,glass);               // vidros
  box(1.7,0.08,1.66,-0.4,1.3,0,paint);               // teto
  box(0.34,0.06,1.9,-2.05,1.17,0,paint);             // aerofólio
  box(0.12,0.3,0.12,-2.05,0.95,0.7,dark);box(0.12,0.3,0.12,-2.05,0.95,-0.7,dark);
  box(0.25,0.2,1.98,2.15,0.42,0,dark);box(0.25,0.22,1.98,-2.15,0.44,0,dark);   // para-choques
  const lit=(c)=>new THREE.MeshBasicMaterial({color:c});
  box(0.06,0.12,0.42,2.21,0.66,0.62,lit(0xfff6d8));box(0.06,0.12,0.42,2.21,0.66,-0.62,lit(0xfff6d8));
  const tail=lit(0x8a1010);box(0.06,0.12,0.5,-2.21,0.7,0.6,tail);box(0.06,0.12,0.5,-2.21,0.7,-0.6,tail);
  const wg=new THREE.CylinderGeometry(0.36,0.36,0.3,14);wg.rotateX(Math.PI/2);
  const front=[];
  for(const [x,z] of [[1.42,0.9],[1.42,-0.9],[-1.38,0.9],[-1.38,-0.9]]){const w=new THREE.Mesh(wg,dark);w.position.set(x,0.36,z);g.add(w);if(x>0)front.push(w);}
  g.userData={front,tail};
  return g;
}

// ---------------------------------------------------------------- som do motor (WebAudio, sintetizado)
const audio={ctx:null,on:true,
  init(){if(this.ctx)return;try{const C=new (window.AudioContext||window.webkitAudioContext)();this.ctx=C;
    const master=C.createGain();master.gain.value=0.22;master.connect(C.destination);this.master=master;
    const lp=C.createBiquadFilter();lp.type='lowpass';lp.frequency.value=900;lp.Q.value=4;lp.connect(master);this.lp=lp;
    this.o1=C.createOscillator();this.o1.type='sawtooth';this.o2=C.createOscillator();this.o2.type='square';
    this.g1=C.createGain();this.g2=C.createGain();this.g2.gain.value=0.35;this.o1.connect(this.g1).connect(lp);this.o2.connect(this.g2).connect(lp);this.o1.start();this.o2.start();
    const nb=C.createBuffer(1,C.sampleRate*2,C.sampleRate),d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    const mk=(type,f,q)=>{const s=C.createBufferSource();s.buffer=nb;s.loop=true;const b=C.createBiquadFilter();b.type=type;b.frequency.value=f;b.Q.value=q;const gg=C.createGain();gg.gain.value=0;s.connect(b).connect(gg).connect(master);s.start();return gg;};
    this.screech=mk('bandpass',1700,6);this.whoosh=mk('lowpass',700,1);this.wind=mk('lowpass',400,0.7);
  }catch(e){this.ctx=null;}},
  toggle(){this.on=!this.on;if(this.master)this.master.gain.value=this.on?0.22:0;},
  update(car,dt){if(!this.ctx)return;const t=this.ctx.currentTime,sp=Math.abs(car.vf);
    const f=car.rpm/60*2;this.o1.frequency.setTargetAtTime(f,t,0.03);this.o2.frequency.setTargetAtTime(f*0.5,t,0.03);
    this.g1.gain.setTargetAtTime(0.35+car.load*0.5,t,0.05);this.lp.frequency.setTargetAtTime(500+car.rpm*0.18+car.load*600,t,0.05);
    this.screech.gain.setTargetAtTime(car.skid*0.5,t,0.05);this.whoosh.gain.setTargetAtTime(car.nitroOn?0.5:0,t,0.08);
    this.wind.gain.setTargetAtTime(Math.min(0.5,sp/90),t,0.2);},
  stop(){if(this.master)this.master.gain.value=0;},
  resume(){if(this.ctx){this.ctx.resume();if(this.on)this.master.gain.value=0.22;}}
};

// ---------------------------------------------------------------- carro do jogador (física arcade)
const GEARS=[0,13,24,35,47,60,85];
class PlayerCar{
  constructor(){Object.assign(this,{id:1e9,x:0,z:0,y:0,vy:0,h:0,vx:0,vz:0,yaw:0,len:4.4,wid:1.96,air:false,lastG:0,airT:0,
    nitro:0.5,nitroOn:false,draft:0,draftT:0,drift:0,onRoad:true,rpm:900,gear:1,roll:0,pitch:0,vf:0,load:0,skid:0,steerVis:0,bump:0});}
  get v(){return Math.max(0,this.vf);}                            // velocidade para o trânsito enxergar
  place(x,z,h){Object.assign(this,{x,z,h,vx:0,vz:0,yaw:0,vy:0,air:false,vf:0});this.y=this.lastG=H(x,z);}
  update(dt,inp,locked){
    const fx=Math.cos(this.h),fz=Math.sin(this.h);
    let vf=this.vx*fx+this.vz*fz,vl=-this.vx*fz+this.vz*fx;const sp=Math.abs(vf),on=this.onRoad;
    const nit=this.nitroOn=!locked&&inp.nitro&&this.nitro>0.01&&vf>3&&!this.air;
    if(nit) this.nitro=Math.max(0,this.nitro-dt*0.2);
    const dr=this.draftT>0;
    const top=(on?75:32)+(nit?17:0)+(dr?7:0);
    let a=0;this.load=0;
    if(!this.air&&!locked){
      if(inp.thr){this.load=1;a=vf<-0.5?15:(9.8+(nit?8:0)+(dr?2.5:0))*Math.max(0,1-Math.pow(Math.max(0,vf)/top,2));}
      if(inp.brk) a+=vf>0.5?-19:-7;                              // freia; parado, dá ré
      if(inp.hb) a-=Math.sign(vf)*3.5;
      a-=Math.sign(vf)*(0.3+0.00034*vf*vf+(on?0:0.006*vf*vf));
      if(!inp.thr&&!inp.brk&&Math.abs(vf)<0.8){a=0;vf*=Math.exp(-6*dt);}
    }
    if(locked){vf=0;vl=0;}
    vf=Math.max(-8.5,vf+a*dt);                                   // ré limitada a ~30 km/h
    // direção: vira forte em baixa, suave em alta; freio de mão destrava a traseira
    const turn=2.6*Math.min(1,sp/5)/(1+sp/30);
    const drifting=!this.air&&inp.hb&&sp>10;
    this.drift=drifting?Math.min(1,this.drift+dt*4):Math.max(0,this.drift-dt*(Math.abs(vl)>4?1.2:3));
    const tgt=this.air?this.yaw*0.98:inp.steer*turn*(1+this.drift*0.8)*(vf>=0?1:-1);
    this.yaw+=(tgt-this.yaw)*Math.min(1,dt*(this.air?1:8));
    this.h+=this.yaw*dt;
    const grip=this.air?0.05:(drifting?1.3:(on?8.5:4.5)*(1-this.drift*0.65));
    vl*=Math.exp(-grip*dt);
    this.skid=this.air?0:clamp((Math.abs(vl)-2.5)/7,0,1);
    if(this.drift>0.4&&sp>14&&Math.abs(vl)>3) this.nitro=Math.min(1,this.nitro+dt*0.1);
    this.vx=fx*vf-fz*vl;this.vz=fz*vf+fx*vl;this.vf=vf;
    this.x+=this.vx*dt;this.z+=this.vz*dt;
    // vertical: segue o chão, mas decola em lombadas quando rápido
    const g=H(this.x,this.z);
    if(this.air){this.vy-=13*dt;this.y+=this.vy*dt;this.airT+=dt;
      if(this.y<=g){this.bump=Math.min(1,-this.vy/9);this.y=g;this.vy=0;this.air=false;this.airT=0;}}
    else{const vg=(g-this.lastG)/Math.max(dt,1e-3);
      if(sp>28&&vg<this.vy-13*dt-3.2){this.air=true;this.y+=this.vy*dt;}   // só decola em quebra forte do relevo
      else{this.y=g;this.vy=this.vy+(vg-this.vy)*Math.min(1,dt*12);}}
    this.lastG=g;
    // marchas e giro (som e painel)
    let gi=1;while(gi<6&&sp>GEARS[gi])gi++;this.gear=vf<-0.5?'R':gi;
    const lo=GEARS[gi-1],hi=GEARS[gi],rt=clamp(1150+(sp-lo)/(hi-lo)*6100,900,7600);
    this.rpm+=((this.load?rt:Math.max(900,rt*0.8))-this.rpm)*Math.min(1,dt*(this.air?3:9));
    if(this.air&&inp.thr) this.rpm=Math.min(7800,this.rpm+dt*4000);
    // inclinação visual da carroceria
    this.roll+=(clamp(-this.yaw*sp*0.012,-0.12,0.12)-this.roll)*Math.min(1,dt*6);
    this.pitch+=(clamp(-a*0.004,-0.05,0.05)-this.pitch)*Math.min(1,dt*5);
    this.steerVis+=(inp.steer*0.45-this.steerVis)*Math.min(1,dt*10);
    this.draftT=Math.max(0,this.draftT-dt);
  }
}

// ---------------------------------------------------------------- rivais da CPU
const RIVALS=[['Tuca',0xd23a2a],['Bia',0x2f6fd6],['Zé Turbo',0xf0b52b],['Lena',0x2fa36b],['Dudu',0x8d4fd1]];
class RacerDriver{
  constructor(veh,race,lat,skill,name){Object.assign(this,{veh,race,lat,latT:lat,skill,name,s:0,cp:0,done:false,time:0,lost:0,dead:false,route:[{e:0}],stuck:0});}
  control(dt){
    const v=this.veh,R=this.race,path=R.path;
    if(R.state!=='run'||this.done) return {acc:-12,steer:0};
    // onde estou no percurso (procura só um trecho à frente)
    const P=path.P,C=path.C,n=C.length;let bi=this.i||0,bd=1e9,bt=0;
    const sMax=this.s+20+v.v*0.25;                                  // só procura um pouco à frente: a rota pode passar perto dela mesma
    for(let j=Math.max(0,bi-3);j<n-1&&C[j]<=sMax;j++){const ax=P[2*j],az=P[2*j+1],dx=P[2*j+2]-ax,dz=P[2*j+3]-az,L2=dx*dx+dz*dz||1;
      const t=clamp(((v.x-ax)*dx+(v.z-az)*dz)/L2,0,1),d=Math.hypot(v.x-ax-dx*t,v.z-az-dz*t);if(d<bd){bd=d;bi=j;bt=t;}}
    this.i=bi;this.s=C[bi]+(C[bi+1]-C[bi])*bt;
    if(bd>40){this.respawn();return {acc:0,steer:0};}             // foi parar longe da rota: volta para a pista
    // desvio: escolhe o lado com espaço para passar carros lentos
    const here=pathAt(path,this.s),half=Math.max(1.2,here.w/2-1.3);
    const fx=Math.cos(v.h),fz=Math.sin(v.h);let block=null;
    const gx=Math.floor(v.x/GC),gz=Math.floor(v.z/GC);
    for(let di=-2;di<=2;di++)for(let dj=-2;dj<=2;dj++){const arr=grid.get((gx+di+5000)*20000+(gz+dj+5000));if(!arr)continue;
      for(const B of arr){if(B===v)continue;const rx=B.x-v.x,rz=B.z-v.z,f=rx*fx+rz*fz;if(f<1||f>38)continue;
        const lat=-rx*fz+rz*fx;if(Math.abs(lat)<2.3&&(B.v<v.v-1||f<10)&&(!block||f<block.f))block={f,lat,v:B.v};}}
    if(block){const left=this.lat-3.2,right=this.lat+3.2,can=x=>Math.abs(x)<=half;
      this.latT=block.lat>0?(can(left)?left:can(right)?right:this.lat):(can(right)?right:can(left)?left:this.lat);}
    else this.latT+=(clamp(this.pref||0,-half,half)-this.latT)*Math.min(1,dt*0.3);
    this.latT=clamp(this.latT,-half,half);this.lat+=clamp(this.latT-this.lat,-dt*4,dt*4);
    // mira à frente na linha de corrida
    const Ld=clamp(7+v.v*0.55,8,42),T=pathAt(path,this.s+Ld),tx=T.x-T.dz*this.lat,tz=T.z+T.dx*this.lat;
    const alpha=angDiff(v.h,Math.atan2(tz-v.z,tx-v.x));
    const steer=Math.atan2(2*v.wb*Math.sin(alpha),Math.max(Ld,Math.hypot(tx-v.x,tz-v.z)));
    // velocidade: curvas à frente, alcance do jogador (diminui na frente, acelera atrás)
    const h0=Math.atan2(here.dz,here.dx);let vt=66*this.skill;
    for(const d of [12,26,45,70,100]){const p=pathAt(path,this.s+d),ang=Math.abs(angDiff(h0,Math.atan2(p.dz,p.dx)));
      if(ang>0.08)vt=Math.min(vt,Math.max(7,Math.sqrt(9.5*this.skill*d/ang)));}
    const gap=R.progress(PLAYER_RACER)-R.progress(this);
    vt*=gap>0?1+Math.min(0.16,gap/1800):1-Math.min(0.14,-gap/2600);
    vt=Math.min(vt,69);                                            // teto de ~250 km/h
    if(block&&Math.abs(this.lat-this.latT)>0.5&&block.f<14) vt=Math.min(vt,block.v+block.f*0.6);
    if(v.v<1&&vt>3){this.stuck+=dt;if(this.stuck>4){this.respawn();this.stuck=0;}}else this.stuck=0;
    return {acc:clamp((vt-v.v)*2.2,-14,7.5),steer};
  }
  respawn(){const p=pathAt(this.race.path,this.s+5);this.veh.x=p.x-p.dz*this.lat;this.veh.z=p.z+p.dx*this.lat;this.veh.h=Math.atan2(p.dz,p.dx);this.veh.v=10;this.i=p.i;}
}
const PLAYER_RACER={cp:0,done:false,time:0,name:'Você',me:true};

// ---------------------------------------------------------------- corrida
class Race{
  constructor(cps,path){
    this.cps=cps;this.path=path;this.state='countdown';this.count=3.6;this.t=0;
    this.cum=[0];for(let i=1;i<cps.length;i++)this.cum.push(this.cum[i-1]+Math.hypot(cps[i].x-cps[i-1].x,cps[i].z-cps[i-1].z));
    this.total=this.cum[this.cum.length-1];this.racers=[];
  }
  pos(r){return r.me?G.car:r.veh;}
  progress(r){ // metros "em linha reta" já cumpridos entre checkpoints
    if(r.done) return 1e7-r.time;const k=Math.min(r.cp,this.cps.length-1),c=this.cps[k],p=this.pos(r);
    const seg=k?this.cum[k]-this.cum[k-1]:0;
    return (k?this.cum[k]:0)-Math.min(seg+500,Math.hypot(p.x-c.x,p.z-c.z));
  }
  ranking(){return [PLAYER_RACER,...this.racers].sort((a,b)=>this.progress(b)-this.progress(a));}
}
function buildRace(x,z){
  const goodNode=i=>ADJ[i].some(o=>EDGES[o.e].rank>=3&&!EDGES[o.e].priv);
  const avNode=i=>ADJ[i].some(o=>EDGES[o.e].av);
  const start=nearestNode(x,z,goodNode);if(start<0) return null;
  const cps=[],legsAll=[];let prev=start,pdir=null;
  const N=NODES.length/2;
  for(let k=0;k<7;k++){
    let pick=null;
    for(let tries=0;tries<220&&!pick;tries++){
      const i=(Math.random()*N)|0;if(!ADJ[i].length)continue;
      const dx=NODES[2*i]-NODES[2*prev],dz=NODES[2*i+1]-NODES[2*prev+1],d=Math.hypot(dx,dz);
      if(d<550||d>1100)continue;
      if(tries<170&&!avNode(i))continue;                                   // checkpoints de preferência em avenidas
      if(pdir&&(dx*pdir[0]+dz*pdir[1])/d<-0.25)continue;                  // sem voltar pelo mesmo caminho
      if(Math.abs(NODES[2*i])>META.w/2-300||Math.abs(NODES[2*i+1])>META.h/2-300)continue;
      const legs=astar(prev,i);if(!legs||!legs.length)continue;
      let L=0;for(const o of legs)L+=EDGES[o.e].len;if(L>d*1.6)continue;   // rota que dá volta demais (contornos de mão única)
      pick={i,legs,dir:[dx/d,dz/d]};
    }
    if(!pick) break;
    legsAll.push(...pick.legs);cps.push({node:pick.i,x:NODES[2*pick.i],z:NODES[2*pick.i+1]});prev=pick.i;pdir=pick.dir;
  }
  if(cps.length<3) return null;
  const path=withCum(legsToPath(legsAll));
  return new Race(cps,path);
}

// ---------------------------------------------------------------- estado do jogo
const G={on:false,car:null,mesh:null,race:null,paused:false,camH:0,shake:0,lastRoad:0,mmT:0,gps:null,gpsT:0,
  focus(){return this.car;}};
window.GAME=G;
const inp={thr:0,brk:0,steer:0,hb:false,nitro:false,look:false},KEY={},touch={};
addEventListener('keydown',e=>{
  if(!G.on)return;KEY[e.code]=true;audio.init();audio.resume();
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
  if(e.repeat)return;
  if(e.code==='KeyR')resetCar();if(e.code==='KeyM')audio.toggle();if(e.code==='Escape')togglePause();if(e.code==='KeyH')ui.help.hidden=!ui.help.hidden;
});
addEventListener('keyup',e=>{KEY[e.code]=false;});
addEventListener('blur',()=>{for(const k in KEY)KEY[k]=false;});
function readInput(dt){
  const up=KEY.KeyW||KEY.ArrowUp||touch.gas,dn=KEY.KeyS||KEY.ArrowDown||touch.brake,l=KEY.KeyA||KEY.ArrowLeft||touch.left,r=KEY.KeyD||KEY.ArrowRight||touch.right;
  inp.thr=up?1:0;inp.brk=dn?1:0;
  const want=(r?1:0)-(l?1:0),rate=want===0||Math.sign(want)!==Math.sign(inp.steer)?9:4.5;
  inp.steer+=clamp(want-inp.steer,-dt*rate,dt*rate);
  inp.hb=!!(KEY.Space||touch.hb);inp.nitro=!!(KEY.ShiftLeft||KEY.ShiftRight||KEY.KeyN||touch.nitro);inp.look=!!KEY.KeyC;
}

// ---------------------------------------------------------------- HUD
const ui={};
function buildUI(){
  const hud=ui.hud=el('div','g-hud',document.body);hud.hidden=true;
  const sp=el('div','g-speed sh',hud);
  sp.innerHTML='<div><span class="gear" id="g-gear">1</span><span class="v" id="g-v">0</span> <span class="u">km/h</span></div>';
  const bars=el('div','g-bars',sp);
  bars.innerHTML='<div class="g-bar"><span>NITRO</span><i id="g-nitro"></i></div><div class="g-bar d"><span>VÁCUO</span><i id="g-draft"></i></div>';
  ui.race=el('div','g-race sh',hud);ui.race.hidden=true;
  ui.race.innerHTML='<div class="pos" id="g-pos">1<small>º/5</small></div><div class="row" id="g-cp"></div><div class="row" id="g-time"></div>';
  ui.mm=el('canvas','g-mm',hud);ui.mm.width=ui.mm.height=190*Math.min(2,devicePixelRatio);
  ui.count=el('div','g-count sh',hud);ui.count.hidden=true;
  ui.pop=el('div','g-pop sh',hud);
  ui.help=el('div','g-help',hud,'<b>W/↑</b> acelera · <b>S/↓</b> freia e ré<br><b>A D / ← →</b> vira · <b>Espaço</b> freio de mão (derrapa)<br><b>Shift</b> nitro · <b>C</b> olha para trás · <b>R</b> volta para a rua<br><b>M</b> som · <b>Esc</b> menu · <b>H</b> esconde esta ajuda<br>Nitro enche derrapando, raspando no trânsito e no vácuo.');
  ui.menu=el('div','g-menu',hud);ui.menu.hidden=true;
  if(MOBILE){
    ui.help.hidden=true;const t=el('div','g-touch',hud);
    const btn=(label,k,css)=>{const b=el('button','',t,label);Object.assign(b.style,css);
      const on=e=>{e.preventDefault();touch[k]=true;audio.init();audio.resume();},off=e=>{e.preventDefault();touch[k]=false;};
      b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointercancel',off);b.addEventListener('pointerleave',off);};
    btn('◀','left',{left:'18px',bottom:'30px'});btn('▶','right',{left:'104px',bottom:'30px'});
    btn('GÁS','gas',{right:'18px',bottom:'30px'});btn('FREIO','brake',{right:'104px',bottom:'30px'});
    btn('NITRO','nitro',{right:'18px',bottom:'114px'});btn('MÃO','hb',{right:'104px',bottom:'114px'});
    sp.style.bottom='210px';
  }
}
let popT=0;
function pop(text){ui.pop.textContent=text;ui.pop.style.opacity=1;popT=performance.now()+900;}
function showMenu(title,body,buttons){
  ui.menu.hidden=false;ui.menu.innerHTML='';const box=el('div','box',ui.menu);el('h2','',box).textContent=title;
  if(body)box.appendChild(body);const b=el('div','btns',box);
  for(const [label,fn,alt] of buttons){const x=el('button',alt?'alt':'',b);x.textContent=label;x.onclick=()=>{ui.menu.hidden=true;fn();};}
}

// ---------------------------------------------------------------- entrar / sair
function enter(){
  if(!ready||G.on) return;
  setMode('free');
  if(!ui.hud)buildUI();
  G.on=true;G.paused=false;document.body.classList.add('g-play');ui.hud.hidden=false;controls.enabled=false;$('tip').hidden=true;
  if(!G.car){G.car=new PlayerCar();G.mesh=carMesh(0xe8e6df);scene.add(G.mesh);}
  G.mesh.visible=true;if(!EXTRA.includes(G.car))EXTRA.push(G.car);
  // começa na rua mais próxima do centro da vista
  const t=controls.target,r=nearestRoad(t.x,t.z)||nearestRoad(0,0);
  if(r){G.car.place(r.px,r.pz,Math.atan2(r.dz,r.dx));}else G.car.place(t.x,t.z,0);
  G.camH=G.car.h;camera.position.set(G.car.x-Math.cos(G.car.h)*9,G.car.y+4,G.car.z-Math.sin(G.car.h)*9);
  G.savedTiers=TIERS;TIERS=MOBILE?[[380,512],[1100,256],[2600,128],[1e9,64]]:[[380,1024],[1100,512],[2600,256],[1e9,64]];
  TRAFFIC.rMin=200;TRAFFIC.radius=1200;
  audio.init();audio.resume();
  if(!MOBILE){ui.help.hidden=false;clearTimeout(G.helpT);G.helpT=setTimeout(()=>{ui.help.hidden=true;},15000);}
}
function exit(){
  endRace();G.on=false;document.body.classList.remove('g-play');ui.hud.hidden=true;ui.menu.hidden=true;controls.enabled=true;
  G.mesh.visible=false;{const i=EXTRA.indexOf(G.car);if(i>=0)EXTRA.splice(i,1);}
  const c=G.car;controls.target.set(c.x,c.y,c.z);camera.position.set(c.x-Math.cos(c.h)*120,c.y+140,c.z-Math.sin(c.h)*120);camera.fov=55;camera.updateProjectionMatrix();
  TIERS=G.savedTiers||TIERS;lastTier=0;TRAFFIC.rMin=0;TRAFFIC.radius=1400;audio.stop();
}
function resetCar(){
  const c=G.car,r=nearestRoad(c.x,c.z);if(!r)return;
  let h=Math.atan2(r.dz,r.dx);if(Math.cos(angDiff(h,c.h))<0)h+=Math.PI;
  if(r.e.ow)h=Math.atan2(r.dz,r.dx);
  c.place(r.px,r.pz,h);
}
function togglePause(){
  if(G.paused){G.paused=false;ui.menu.hidden=true;audio.resume();return;}
  G.paused=true;audio.stop();
  const btns=[['Continuar',()=>{G.paused=false;audio.resume();}]];
  if(G.race)btns.push(['Reiniciar corrida',()=>{G.paused=false;startRace(G.race.cps0);}],['Abandonar corrida',()=>{G.paused=false;endRace();}]);
  else btns.push(['Começar uma corrida aqui',()=>{G.paused=false;startRace();}]);
  btns.push(['Sair do carro',()=>{G.paused=false;exit();},true]);
  showMenu('Pausa',null,btns);
}

// ---------------------------------------------------------------- iniciar e terminar corridas
const beams=[];
function beamMesh(){
  const g=new THREE.Group();
  const col=new THREE.Mesh(new THREE.CylinderGeometry(5.5,5.5,70,24,1,true),new THREE.MeshBasicMaterial({color:0xffb21e,transparent:true,opacity:0.32,side:THREE.DoubleSide,depthWrite:false}));
  col.position.y=35;g.add(col);
  const ring=new THREE.Mesh(new THREE.RingGeometry(8,9.5,40),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:0.85,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.y=0.4;g.add(ring);g.userData={col,ring};scene.add(g);return g;
}
function startRace(cps0){
  endRace();
  const c=G.car;let race=null;
  if(cps0){ // mesma corrida de novo: refaz o percurso pelos mesmos checkpoints
    const legs=[];let prev=cps0.start;for(const cp of cps0.list){const l=astar(prev,cp.node);if(l)legs.push(...l);prev=cp.node;}
    race=new Race(cps0.list.map(p=>({...p})),withCum(legsToPath(legs)));race.cps0=cps0;
  } else {
    for(let k=0;k<4&&!race;k++) race=buildRace(c.x,c.z);
    if(!race){pop('Sem rota boa por aqui');return;}
    race.cps0={start:nearestNode(race.path.P[0],race.path.P[1]),list:race.cps.map(p=>({...p}))};
  }
  G.race=race;
  // grid de largada no começo do percurso: duas filas, o jogador no meio do pelotão
  const nR=MOBILE?3:4,slots=[[34,-2.4],[34,2.4],[24,-2.4],[24,2.4],[14,-2.4]];
  const order=[...Array(nR+1).keys()];const meSlot=Math.min(2,nR);
  let ri=0;
  for(let k=0;k<=nR;k++){
    const [s,lat0]=slots[k],p=pathAt(race.path,s),half=Math.max(1.2,p.w/2-1.3),lat=clamp(lat0,-half,half);
    const x=p.x-p.dz*lat,z=p.z+p.dx*lat,h=Math.atan2(p.dz,p.dx);
    if(k===meSlot){c.place(x,z,h);G.camH=h;continue;}
    const [name,color]=RIVALS[ri++];
    const veh=new Vehicle(5e8+ri,x,z,h);veh.v=0;veh.wb=2.7;veh.len=4.4;
    const d=new RacerDriver(veh,race,lat,0.93+Math.random()*0.12,name);d.pref=lat*0.4;veh.driver=d;
    const m=carMesh(color);scene.add(m);d.mesh=m;race.racers.push(d);EXTRA.push(veh);
  }
  for(let i=0;i<race.cps.length;i++){const b=beamMesh();beams.push(b);}
  Object.assign(PLAYER_RACER,{cp:0,done:false,time:0});
  ui.race.hidden=false;ui.count.hidden=false;
  // tira o trânsito de cima da largada
  for(const t of TRAFFIC.cars) if(Math.hypot(t.x-c.x,t.z-c.z)<60) t.driver.dead=true;
}
function endRace(){
  const R=G.race;if(!R)return;
  for(const d of R.racers){scene.remove(d.mesh);const i=EXTRA.indexOf(d.veh);if(i>=0)EXTRA.splice(i,1);}
  for(const b of beams)scene.remove(b);beams.length=0;
  G.race=null;ui.race.hidden=true;ui.count.hidden=true;
}
function finishScreen(){
  const R=G.race,rank=R.ranking(),tb=document.createElement('table');
  rank.forEach((r,i)=>{const tr=el('tr',r.me?'me':'',tb);el('td','',tr).textContent=(i+1)+'º';el('td','',tr).textContent=r.name;
    el('td','',tr).textContent=r.done?fmtTime(r.time):'faltavam '+Math.max(0,Math.round(R.total-R.progress(r)))+' m';});
  const place=rank.indexOf(PLAYER_RACER)+1;
  showMenu(place===1?'Vitória!':place+'º lugar',tb,[['Correr de novo',()=>startRace(R.cps0)],['Nova corrida',()=>startRace()],['Dirigir livre',()=>endRace(),true]]);
}

// ---------------------------------------------------------------- colisões (dois círculos por carro)
function velOf(c){return c instanceof PlayerCar?[c.vx,c.vz]:[Math.cos(c.h)*c.v,Math.sin(c.h)*c.v];}
function setVel(c,vx,vz){
  if(c instanceof PlayerCar){c.vx=vx;c.vz=vz;}
  else{c.v=Math.max(0,vx*Math.cos(c.h)+vz*Math.sin(c.h));}
}
function collide(A,B){
  const ca=Math.cos(A.h),sa=Math.sin(A.h),cb=Math.cos(B.h),sb=Math.sin(B.h);let best=null;
  for(const ka of [-1.2,1.2])for(const kb of [-1.2,1.2]){
    const ax=A.x+ca*ka,az=A.z+sa*ka,bx=B.x+cb*kb,bz=B.z+sb*kb,dx=bx-ax,dz=bz-az,d=Math.hypot(dx,dz),pen=2.1-d;
    if(pen>0&&(!best||pen>best.pen))best={pen,nx:dx/(d||1),nz:dz/(d||1),px:(ax+bx)/2,pz:(az+bz)/2};}
  if(!best)return 0;
  const {pen,nx,nz}=best;A.x-=nx*pen/2;A.z-=nz*pen/2;B.x+=nx*pen/2;B.z+=nz*pen/2;
  const [avx,avz]=velOf(A),[bvx,bvz]=velOf(B),rel=(avx-bvx)*nx+(avz-bvz)*nz;
  if(rel>0){const j=rel*0.6;setVel(A,avx-nx*j,avz-nz*j);setVel(B,bvx+nx*j,bvz+nz*j);
    if(A instanceof PlayerCar){const rx=best.px-A.x,rz=best.pz-A.z;A.yaw+=clamp((rx*nz-rz*nx)*j*0.05,-1.5,1.5);}
    if(B instanceof PlayerCar){const rx=best.px-B.x,rz=best.pz-B.z;B.yaw-=clamp((rx*nz-rz*nx)*j*0.05,-1.5,1.5);}}
  return rel;
}
function nearby(c,r,cb){const gx=Math.floor(c.x/GC),gz=Math.floor(c.z/GC),k=Math.ceil(r/GC);
  for(let di=-k;di<=k;di++)for(let dj=-k;dj<=k;dj++){const arr=grid.get((gx+di+5000)*20000+(gz+dj+5000));if(arr)for(const B of arr)if(B!==c)cb(B);}}

// ---------------------------------------------------------------- laço do jogo
function update(dt,now){
  const c=G.car,R=G.race;
  readInput(dt);if(G.bot)G.bot(inp,dt);                           // gancho para piloto automático / testes
  if(popT&&now>popT){ui.pop.style.opacity=0;popT=0;}
  if(G.paused){render3D(dt,now);return;}
  // contagem regressiva
  let locked=false;
  if(R&&R.state==='countdown'){R.count-=dt;locked=true;const n=Math.ceil(R.count-0.6);
    ui.count.textContent=n>0?n:'JÁ!';if(R.count<=0.6){R.state='run';R.t=0;}}
  if(R&&R.state!=='countdown'&&ui.count.textContent==='JÁ!'&&R.t>0.8)ui.count.hidden=true;
  // asfalto ou terra?
  if(now-G.lastRoad>90){G.lastRoad=now;const r=nearestRoad(c.x,c.z);c.onRoad=!!r&&r.d<1.2;}
  const steps=dt>0.025?2:1,h=dt/steps;
  for(let s=0;s<steps;s++){
    c.update(h,inp,locked);
    if(R) for(const d of R.racers){const ctl=d.control(h);d.veh.update(h,ctl);}
  }
  // colisões e "quase!" com o trânsito
  let hit=0;
  nearby(c,8,B=>{const rel=collide(c,B);if(rel>2)hit=Math.max(hit,rel);
    if(!B.driver||B.driver instanceof RacerDriver)return;
    const rx=B.x-c.x,rz=B.z-c.z,f=rx*Math.cos(c.h)+rz*Math.sin(c.h),lat=Math.abs(-rx*Math.sin(c.h)+rz*Math.cos(c.h));
    if(Math.abs(f)<2.5&&lat<3.6&&lat>2.0&&c.vf>22&&!(B._nm>now-3000)){B._nm=now;c.nitro=Math.min(1,c.nitro+0.08);pop('QUASE! +NITRO');}});
  if(R) for(const d of R.racers) nearby(d.veh,7,B=>{if(B!==c)collide(d.veh,B);});
  if(hit>4){G.shake=Math.min(1,hit/14);if(hit>9)pop('BATIDA!');}
  // vácuo: atrás de outro carro, no mesmo sentido
  let behind=false;
  if(c.vf>18) nearby(c,32,B=>{const rx=B.x-c.x,rz=B.z-c.z,f=rx*Math.cos(c.h)+rz*Math.sin(c.h),lat=Math.abs(-rx*Math.sin(c.h)+rz*Math.cos(c.h));
    if(f>5&&f<30&&lat<1.8&&Math.cos(B.h-c.h)>0.8&&B.v>10)behind=true;});
  if(behind){c.draft=Math.min(1,c.draft+dt/1.3);c.nitro=Math.min(1,c.nitro+dt*0.04);if(c.draft>=1&&c.draftT<=0){c.draftT=2.2;pop('VÁCUO!');}}
  else c.draft=Math.max(0,c.draft-dt*0.8);
  // corrida: checkpoints, posições, chegada
  if(R&&R.state==='run'){
    R.t+=dt;
    const pass=(r,p)=>{if(r.done)return;const cp=R.cps[r.cp];if(Math.hypot(p.x-cp.x,p.z-cp.z)<17){r.cp++;
      if(r.me&&r.cp<R.cps.length)pop('CHECKPOINT '+r.cp+'/'+R.cps.length);
      if(r.cp>=R.cps.length){r.done=true;r.time=R.t;}}};
    pass(PLAYER_RACER,c);for(const d of R.racers)pass(d,d.veh);
    if(PLAYER_RACER.done&&R.state==='run'){R.state='done';finishScreen();}
  }
  render3D(dt,now);
}
function render3D(dt,now){
  const c=G.car,R=G.race,sp=Math.abs(c.vf);
  // carro do jogador
  const ch=Math.cos(c.h),sh=Math.sin(c.h);
  const yl=H(c.x+sh*0.9,c.z-ch*0.9),yr=H(c.x-sh*0.9,c.z+ch*0.9),yf=H(c.x+ch*1.5,c.z+sh*1.5),yb=H(c.x-ch*1.5,c.z-sh*1.5);
  const m=G.mesh;m.position.set(c.x,c.y+0.02,c.z);
  m.rotation.set(Math.atan2(yl-yr,1.8)+c.roll,-c.h,(c.air?c.pitch-c.vy*0.015:Math.atan2(yf-yb,3))+c.pitch,'YZX');
  for(const w of m.userData.front)w.rotation.y=-c.steerVis;
  m.userData.tail.color.setHex(inp.brk&&c.vf>0.5?0xff2a2a:0x8a1010);
  // rivais
  if(R) for(const d of R.racers){const v=d.veh,cc=Math.cos(v.h),ss=Math.sin(v.h);
    const f=H(v.x+cc*1.5,v.z+ss*1.5),b=H(v.x-cc*1.5,v.z-ss*1.5);d.mesh.position.set(v.x,(f+b)/2+0.02,v.z);
    d.mesh.rotation.set(0,-v.h,Math.atan2(f-b,3),'YZX');for(const w of d.mesh.userData.front)w.rotation.y=-v.steer;}
  // feixes dos checkpoints: o próximo forte, o seguinte fraco, o resto escondido
  if(R) beams.forEach((b,i)=>{const k=i-PLAYER_RACER.cp,cp=R.cps[i];b.visible=k>=0&&k<2;if(!b.visible)return;
    b.position.set(cp.x,H(cp.x,cp.z),cp.z);const last=i===R.cps.length-1;
    b.userData.col.material.color.setHex(last?0x38e07a:0xffb21e);b.userData.col.material.opacity=k===0?0.36+Math.sin(now/180)*0.06:0.14;
    b.userData.ring.material.opacity=k===0?0.85:0.25;b.userData.ring.rotation.z=now/900;});
  // câmera de perseguição
  const look=inp.look?Math.PI:0;
  const velH=sp>4?Math.atan2(c.vz,c.vx)+(c.vf<0?Math.PI:0):c.h;
  G.camH+=angDiff(G.camH,c.h+angDiff(c.h,velH)*0.4)*Math.min(1,dt*4.5);       // segue o carro, puxando um pouco para onde ele desliza
  const ah=G.camH+look,dist=7.2+sp*0.045+(c.nitroOn?1.2:0),ht=2.5+sp*0.012;
  const tx=c.x-Math.cos(ah)*dist,tz=c.z-Math.sin(ah)*dist;let ty=Math.max(c.y+ht,H(tx,tz)+1.3);
  camera.position.x+=(tx-camera.position.x)*Math.min(1,dt*12);camera.position.z+=(tz-camera.position.z)*Math.min(1,dt*12);
  camera.position.y+=(ty-camera.position.y)*Math.min(1,dt*8);
  if(c.bump>0){G.shake=Math.max(G.shake,c.bump*0.7);c.bump=0;}
  if(G.shake>0){camera.position.x+=(Math.random()-0.5)*G.shake*0.5;camera.position.y+=(Math.random()-0.5)*G.shake*0.4;G.shake=Math.max(0,G.shake-dt*2.5);}
  camera.lookAt(c.x+Math.cos(ah)*6,c.y+1.2,c.z+Math.sin(ah)*6);
  const fov=clamp(60+sp*0.22+(c.nitroOn?9:0),60,92);camera.fov+=(fov-camera.fov)*Math.min(1,dt*4);camera.updateProjectionMatrix();
  scene.fog.near=1800;scene.fog.far=9000;
  // painel
  $('g-v').textContent=Math.round(sp*3.6);$('g-gear').textContent=c.gear;
  $('g-nitro').style.width=(c.nitro*100)+'%';$('g-draft').style.width=(c.draftT>0?100:c.draft*100)+'%';
  if(R){const rank=R.ranking(),p=rank.indexOf(PLAYER_RACER)+1;
    $('g-pos').innerHTML=p+'<small>º/'+rank.length+'</small>';
    const cp=Math.min(PLAYER_RACER.cp+1,R.cps.length),nx=R.cps[Math.min(PLAYER_RACER.cp,R.cps.length-1)];
    $('g-cp').textContent=(cp===R.cps.length?'CHEGADA':'CHECKPOINT '+cp+'/'+R.cps.length)+' · '+Math.round(Math.hypot(nx.x-c.x,nx.z-c.z))+' m';
    $('g-time').textContent=fmtTime(R.state==='countdown'?0:R.t);}
  audio.update(c,dt);
  if(now-G.mmT>60){G.mmT=now;minimap(now);}
}

// ---------------------------------------------------------------- minimapa com GPS
let mmStamp=0;
function minimap(now){
  const cv=ui.mm,g=cv.getContext('2d'),S=cv.width,c=G.car,R=G.race,sc=S/2/380;
  g.setTransform(1,0,0,1,0,0);g.fillStyle='#26323a';g.fillRect(0,0,S,S);
  g.translate(S/2,S/2);g.rotate(-Math.PI/2-G.camH);g.scale(sc,sc);g.translate(-c.x,-c.z);
  g.lineCap='round';g.lineJoin='round';
  mmStamp++;const list=[];
  for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const ch=chunkAt(c.x+di*500,c.z+dj*500);if(!ch)continue;for(const e of ch.edges)if(e._mm!==mmStamp){e._mm=mmStamp;list.push(e);}}
  for(const e of list){g.strokeStyle=e.av?'#c7ccd1':'#7d8890';g.lineWidth=Math.max(e.w,2.2/sc);g.beginPath();g.moveTo(e.P[0],e.P[1]);for(let i=2;i<e.P.length;i+=2)g.lineTo(e.P[i],e.P[i+1]);g.stroke();}
  if(R){
    const k=Math.min(PLAYER_RACER.cp,R.cps.length-1),cp=R.cps[k];
    if(now-G.gpsT>1200||G.gpsCp!==k){G.gpsT=now;G.gpsCp=k;const legs=astar(nearestNode(c.x,c.z),cp.node);G.gps=legs?legsToPath(legs).P:null;}
    if(G.gps&&G.gps.length>3){g.strokeStyle='#ffb21e';g.lineWidth=5/sc;g.beginPath();g.moveTo(c.x,c.z);for(let i=0;i<G.gps.length;i+=2)g.lineTo(G.gps[i],G.gps[i+1]);g.stroke();}
    R.cps.forEach((p,i)=>{if(i<PLAYER_RACER.cp)return;g.fillStyle=i===k?'#ffb21e':i===R.cps.length-1?'#38e07a':'#8a6a2a';g.beginPath();g.arc(p.x,p.z,(i===k?9:6)/sc,0,TAU);g.fill();});
    for(const d of R.racers){g.fillStyle='#ff5a4a';g.beginPath();g.arc(d.veh.x,d.veh.z,4.5/sc,0,TAU);g.fill();}
  }
  // seta do jogador (sempre no centro, apontando para cima)
  g.setTransform(1,0,0,1,S/2,S/2);g.fillStyle='#fff';g.beginPath();const a=S*0.045;g.moveTo(0,-a*1.3);g.lineTo(a*0.85,a);g.lineTo(0,a*0.5);g.lineTo(-a*0.85,a);g.closePath();g.fill();
  // norte
  const nAng=-Math.PI/2-G.camH-Math.PI/2,rr=S/2-S*0.07;g.fillStyle='#fff';g.font=`600 ${Math.round(S*0.07)}px sans-serif`;g.textAlign='center';g.textBaseline='middle';
  g.fillText('N',Math.cos(nAng)*rr,Math.sin(nAng)*rr);
}

// ---------------------------------------------------------------- botões da página
G.update=update;
G.tools={pathAt,astar,startRace,endRace,nearestRoad,inp};
$('b-drive').onclick=()=>{enter();};
$('b-race').onclick=()=>{enter();if(G.on)startRace();};
})();
