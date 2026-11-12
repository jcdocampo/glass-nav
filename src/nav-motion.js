// Exact closed-form springs: response is measured in seconds, not frames.
// Frequencies and limits are implementation choices, not Apple specifications.
export const MOTION = Object.freeze({ travel: 17, follow: 40, snap: 28, damping: .90, swell: 10, swellDamping: .87, releaseSwell: 26, material: 13, releaseMaterial: 28, velocityTime: 0.035, velocityDecay: 0.085, maxSpeed: 6, holdWidth: 0.44, holdHeight: 0.38, maxStretch: 0.24, stretchHeight: 0.18, stretchStart: 0.25, stretchFull: 2.3, stretchAttack: 0.028, stretchRecovery: 0.10, recoil: 19, recoilDamping: .80, recoilTransfer: 28, recoilHeight: .12, recoilWidth: .05, resistance: 14, directionResponse: 22, relaxation: 30 });
export const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
// A tap retains one travel spring through release. Drag tracking stays quick.
export const TAP_MOTION = Object.freeze({ frequency: 14, damping: .87, stretch: .045, swellWidth: .14, swellHeight: .16, attack: .045, recovery: .11, jiggle: 4.8, heightDelay: .025, heightRecovery: .10, heightResponse: .025 });
const ARRIVAL_STRETCH = Object.freeze({ min: .08, max: .30, expand: .14, hold: .09, settle: .34, glass: .75 });
// End handoff for drags and taps crossing two or more tab positions. A short inward strain returns once;
// the end-facing edge stays attached while the trailing edge absorbs motion.
const EDGE_IMPACT = Object.freeze({ min: .018, max: .14, fullSpeed: 2.5, memory: .25, attack: .11, hold: .04, recover: .32, regrab: .18, height: .16 });
const CENTER_IMPACT = Object.freeze({ min: .055, max: .095, attack: .18, recover: .40 });
const stretchEase = t => t*t*t*(t*(6*t-15)+10);
// Zero speed at the turn, but no flat dwell around it. A released hold keeps
// recovering instead of parking at its widest gray outline before restarting.
const recoveryEase = t => (1-Math.cos(Math.PI*clamp(t,0,1)))/2;
// A fuller, slower contact pulse: one swell and a damped recovery, without a
// repeating ripple or a position jump. Shared by the navbar and button button.
// The shell reacts to contact only, independently of lens hold/drag strain.
export const TRACK_MOTION = Object.freeze({ width: .025, height: .04, response: 20, damping: .88 });
export const CONTACT_MOTION = Object.freeze({ frequency: 11, damping: .86, impulse: 7.6, scale: .40 });
export const contactScale = value => CONTACT_MOTION.scale * clamp(value,0,.3);
// Both controls pass zero delay to bridge the contact pulse into holding.
export function holdGrowth(age,delay=.12){const t=clamp((age-delay)/(.28-delay),0,1);return t*t*(3-2*t);}
export function spring(value,velocity,target,dt,omega,damping=1) {
  const offset=value-target;
  if(damping>=1){const impulse=velocity+omega*offset,decay=Math.exp(-omega*dt);return [target+(offset+impulse*dt)*decay,(velocity-omega*impulse*dt)*decay];}
  const wd=omega*Math.sqrt(1-damping*damping),b=(velocity+damping*omega*offset)/wd;
  const c=Math.cos(wd*dt),s=Math.sin(wd*dt),decay=Math.exp(-damping*omega*dt);
  return [target+(offset*c+b*s)*decay,((b*wd*c-offset*wd*s)-damping*omega*(offset*c+b*s))*decay];
}

// Two time scales carry changes in velocity through the contour. Steady
// movement has no permanent wobble; the held size is still governed by hold.
export class DragWobble {
  constructor(){this.reset();}
  reset(){this.speed=this.acceleration=this.head=this.tail=this.strain=this.strainV=this.contour=this.contourV=this.gain=0;}
  tick(dt,velocity,active,room){
    if(!dt)return;
    const speed=active?clamp(velocity,-6,6):0;
    const acceleration=active?clamp((speed-this.speed)/dt,-24,24):0;this.speed=speed;
    this.acceleration+=(acceleration-this.acceleration)*(1-Math.exp(-dt/.04));
    const drive=active?clamp(speed/2.3+this.acceleration*.012,-1.25,1.25):0;
    const before=this.head;this.head+=(drive-this.head)*(1-Math.exp(-dt/.027));
    const decay=Math.exp(-dt/.10);
    this.tail=this.tail*decay+before*(1-decay)+(this.head-before)*(1-.10/dt*(1-decay));
    const strain=clamp((Math.abs(this.head)-Math.abs(this.tail))*2,-.4,1);
    // Both ends share one height and mirrored curvature. The fast/lagging
    // responses change horizontal strain, never left-versus-right height.
    const contour=clamp(strain*.045,-.025,.045);
    [this.strain,this.strainV]=spring(this.strain,this.strainV,strain,dt,26);
    [this.contour,this.contourV]=spring(this.contour,this.contourV,contour,dt,28);
    const target=active?room:0;
    this.gain+=(target-this.gain)*(1-Math.exp(-dt/(target>this.gain?.045:.07)));
    if(this.calm){const gain=this.gain;this.reset();this.gain=gain;}
  }
  get calm(){return Math.abs(this.speed)<.0005&&Math.abs(this.acceleration)<.005&&Math.abs(this.head)<.0005&&Math.abs(this.tail)<.0005&&Math.abs(this.strain)<.0005&&Math.abs(this.strainV)<.005&&Math.abs(this.contour)<.00001&&Math.abs(this.contourV)<.0005;}
}

export class LensMotion {
  constructor(tabs,active,{reduced=false,limits=null}={}) {
    this.tabs=tabs;this.committed=active;this.preview=active;this.reduced=reduced;
    const tab=tabs.find(t=>t.id===active)||tabs[0];
    this.x=tab.x;this.v=0;this.baseWidth=tab.width;this.widthV=0;this.y=tab.y;this.baseHeight=tab.height;
    this.targetX=tab.x;this.targetWidth=tab.width;this.hold=0;this.holdV=0;this.material=0;this.materialV=0;this.stretch=0;this.stretchV=0;
    this.speed=0;this.speedMagnitude=0;this.dragX=this.x;this.lastMove=-Infinity;this.activationAge=1;this.phase='resting';this.holding=false;this.dragging=false;this.swiping=false;
    this.relax=0;this.relaxV=0;
    this.flow=0;this.flowV=0;this.swipeDirection=0;
    this.recoil=0;this.recoilV=0;this.braking=false;
    this.restRipple=0;this.restRippleAge=Infinity;this.restRippleStart=0;this.restRippleTarget=0;this.arrivalStretched=false;
    this.edgeImpact={side:0,lean:0,contact:0,speed:0,age:Infinity,settling:false,recovering:false,centered:false,count:0,tapSide:0,tapCenter:false,tapSpeed:0,fadeAge:Infinity};
    this.releaseEased=false;
    this.wobble=new DragWobble();
    this.travelMin=this.travelMax=tab.x;
    this.limits=limits;this.desiredX=tab.x;this.inputX=tab.x;
    this.gliding=false;this.glideDistance=0;this.glideBumped=false;this.tapStretch=0;this.contact=0;this.contactV=0;this.contactHold=0;this.holdGate=0;this.trackSwell=0;this.trackSwellV=0;
    this.graySwipe=false;this.tapHeightAge=Infinity;this.tapHeightScale=1;
  }
  nearest(x){return this.tabs.reduce((best,t)=>Math.abs(t.x-x)<Math.abs(best.x-x)?t:best,this.tabs[0]);}
  target(id){const tab=this.tabs.find(t=>t.id===id);if(!tab)return;this.preview=id;this.desiredX=this.targetX=tab.x;this.targetWidth=tab.width;this.y=tab.y;this.baseHeight=tab.height;}
  resist(x){
    // Unit slope at the tab center, gradually falling resistance beyond it.
    // No threshold where the moving input suddenly becomes a fixed wall.
    const first=this.tabs[0].x,last=this.tabs.at(-1).x,reach=Math.min(MOTION.resistance,this.baseHeight*.24);
    return x<first?first+reach*Math.tanh((x-first)/reach):x>last?last+reach*Math.tanh((x-last)/reach):x;
  }
  unresist(x){
    const first=this.tabs[0].x,last=this.tabs.at(-1).x,reach=Math.min(MOTION.resistance,this.baseHeight*.24);
    return x<first?first+reach*Math.atanh(clamp((x-first)/reach,-.9999999,.9999999)):x>last?last+reach*Math.atanh(clamp((x-last)/reach,-.9999999,.9999999)):x;
  }
  anchorPointer(x){this.inputX=this.resist(x);this.dragX=this.inputX;}
  recordTravel(x){const p=clamp(x,this.tabs[0].x,this.tabs.at(-1).x);this.travelMin=Math.min(this.travelMin,p);this.travelMax=Math.max(this.travelMax,p);}
  beginArrivalStretch(edgeSide=0,incoming=0,centered=false){
    // Lower the tap-grown height ahead of the existing material fade. Keep
    // this clock through an end impact so the handoff cannot raise it again.
    if(!this.holding&&!this.dragging&&this.gliding&&!Number.isFinite(this.tapHeightAge))this.tapHeightAge=0;
    // Track the span covered by this gesture, not accumulated back-and-forth
    // samples. A full edge-to-edge journey is the maximum at every screen size.
    const distance=clamp((this.travelMax-this.travelMin)/Math.max(1,this.tabs.at(-1).x-this.tabs[0].x),0,1);
    this.restRippleTarget=ARRIVAL_STRETCH.min+(ARRIVAL_STRETCH.max-ARRIVAL_STRETCH.min)*distance;
    const edge=this.edgeImpact;edge.settling=!!edgeSide||centered;edge.centered=centered;edge.recovering=false;edge.fadeAge=edge.settling?0:Infinity;
    if(edgeSide){edge.side=edgeSide;edge.count++;this.restRippleTarget=-(EDGE_IMPACT.min+(EDGE_IMPACT.max-EDGE_IMPACT.min)*clamp(incoming/EDGE_IMPACT.fullSpeed,0,1));}
    if(centered){edge.side=0;this.restRippleTarget=-(CENTER_IMPACT.min+(CENTER_IMPACT.max-CENTER_IMPACT.min)*clamp(incoming/EDGE_IMPACT.fullSpeed,0,1));}
    this.restRippleStart=this.restRipple;this.restRippleAge=0;this.arrivalStretched=true;
  }
  press(id){
    this.graySwipe=false;this.tapHeightAge=Infinity;
    const edge=this.edgeImpact;edge.contact=0;edge.speed=0;edge.age=Infinity;edge.tapSide=0;edge.tapCenter=false;edge.tapSpeed=0;
    // Re-grabbing redirects the current strain; never reset the drawn outline.
    if((edge.side||edge.centered)&&Number.isFinite(this.restRippleAge)){this.restRippleStart=this.restRipple;this.restRippleTarget=0;this.restRippleAge=0;edge.settling=false;edge.recovering=true;}
    this.swiping=false;this.holding=true;this.dragging=false;this.activationAge=0;this.phase='activating';this.target(id);this.anchorPointer(this.targetX);this.travelMin=this.travelMax=clamp(this.x,this.tabs[0].x,this.tabs.at(-1).x);this.recordTravel(this.targetX);this.glideDistance=Math.abs(this.targetX-this.x);this.gliding=this.glideDistance>.25;this.glideBumped=false;this.arrivalStretched=false;if(!this.reduced)this.contactV=Math.max(this.contactV,CONTACT_MOTION.impulse);
  }
  move(x,dx,dt,time){
    this.dragging=true;this.phase='dragging';
    const previousInput=this.inputX;
    // The resisted pointer remains continuous through both track ends.
    // Its effective distance/time drives stretch, so far-off-track motion
    // cannot pump the lens while absolute finger/tab registration is retained.
    this.inputX=this.resist(x);
    this.recordTravel(this.inputX);
    this.dragX=this.desiredX=this.inputX;
    const tab=this.nearest(this.inputX);this.preview=tab.id;this.targetWidth=tab.width;
    // CSS px / elapsed seconds. Normalize only the response curve by track
    // span, so the same full-track gesture deforms equally on phone and desktop.
    const raw=clamp((this.inputX-previousInput)/Math.max(.001,dt),-MOTION.maxSpeed*this.span,MOTION.maxSpeed*this.span);
    const blend=1-Math.exp(-dt/MOTION.velocityTime);
    this.speed+=(raw-this.speed)*blend;
    // Magnitude must not cancel when a moving finger reverses direction.
    this.speedMagnitude+=(Math.abs(raw)-this.speedMagnitude)*blend;this.lastMove=time;
    // Latch incoming speed once per edge entry, not once per held frame. A
    // pause dissipates it; leaving the zone re-arms the opposite/next arrival.
    const first=this.tabs[0],last=this.tabs.at(-1),edge=this.edgeImpact;
    const side=this.inputX<first.x+first.width*.18?-1:this.inputX>last.x-last.width*.18?1:0;
    if(side!==edge.contact){edge.contact=side;edge.speed=Math.max(0,side*this.speed/this.span);edge.age=0;}
  }
  get span(){return this.tabs.at(-1).x-this.tabs[0].x+(this.tabs[0].width+this.tabs.at(-1).width)/2;}
  release(id,{commit=true}={}){
    // A small positive impulse relaxes once, without a radiating click ripple.
    // Position/shape are untouched at release and again on a new press.
    this.relaxV=Math.min(20,this.relaxV+Math.min(1,this.hold+this.stretch)*20);
    const wasDragging=this.dragging,from=this.committed;
    this.releaseEased=wasDragging||(this.holding&&this.activationAge>=.12);
    if(!this.holding&&!this.gliding)this.travelMin=this.travelMax=clamp(this.x,this.tabs[0].x,this.tabs.at(-1).x);
    this.recordTravel(this.tabs.find(t=>t.id===id)?.x??this.x);
    // Releasing a played/dragged lens uses the same shared glass-to-gray
    // outline as tap arrival, even after pausing directly over a tab.
    // Only start the envelope here; preserve this frame's shape and velocity.
    if(wasDragging&&commit&&!this.reduced){
      const tab=this.tabs.find(t=>t.id===id),side=id===this.tabs[0].id?-1:id===this.tabs.at(-1).id?1:0,edge=this.edgeImpact;
      const nearEnd=side&&Math.abs(this.inputX-tab.x)<tab.width*.60;
      const approaching=side*this.speed/this.span;
      const incoming=Math.max(0,approaching,edge.contact===side?edge.speed*Math.exp(-edge.age/EDGE_IMPACT.memory):0);
      this.beginArrivalStretch(nearEnd&&approaching>-.18?side:0,incoming);
    }
    if(!this.holding&&!this.gliding)this.glideDistance=Math.abs((this.tabs.find(t=>t.id===id)?.x??this.x)-this.x);
    this.holding=false;this.dragging=false;this.swiping=false;if(commit)this.committed=id;this.target(id);this.phase='snapping';
    this.gliding=!this.graySwipe&&!wasDragging&&(this.gliding||Math.abs(this.targetX-this.x)>.25);
    // Taps crossing at least two positions into either end absorb their
    // incoming motion there. Other tab arrivals absorb it equally on both sides.
    const edge=this.edgeImpact,first=this.tabs[0].id,last=this.tabs.at(-1).id;
    const crossedTabs=Math.abs(this.tabs.findIndex(tab=>tab.id===from)-this.tabs.findIndex(tab=>tab.id===id));
    edge.tapSide=!wasDragging&&commit&&!this.reduced&&this.gliding&&crossedTabs>=2?(id===last?1:id===first?-1:0):0;
    edge.tapCenter=!this.graySwipe&&!wasDragging&&!this.releaseEased&&commit&&!this.reduced&&this.gliding&&crossedTabs>0&&!edge.tapSide;
    edge.tapSpeed=Math.abs(this.v)/this.span;
  }
  select(id){if(this.holding&&id===this.committed)return;if(!this.swiping)this.graySwipe=false;this.release(id);}
  swipe(from,to,p){
    const a=this.tabs.find(t=>t.id===from),b=this.tabs.find(t=>t.id===to);if(!a||!b||this.holding)return;
    this.graySwipe=true;this.gliding=false;this.tapHeightAge=Infinity;
    const nextX=a.x+(b.x-a.x)*p;
    this.swipeDirection=Math.sign(nextX-this.x)||this.swipeDirection;
    this.swiping=true;this.phase='dragging';this.x=this.desiredX=this.targetX=a.x+(b.x-a.x)*p;this.v=0;
    this.baseWidth=this.targetWidth=a.width+(b.width-a.width)*p;this.widthV=0;
    this.preview=p<.5?from:to;
  }
  resize(tabs){
    const old=this.tabs;const left=old[0].x,right=old.at(-1).x;
    const p=(this.x-left)/Math.max(1,right-left),ratio=(tabs.at(-1).x-tabs[0].x)/Math.max(1,right-left);
    this.tabs=tabs;this.x=tabs[0].x+p*(tabs.at(-1).x-tabs[0].x);this.v*=ratio;
    const tab=tabs.find(t=>t.id===this.preview)||tabs[0];
    this.baseWidth*=tab.width/(old.find(t=>t.id===this.preview)?.width||tab.width);this.targetWidth=tab.width;
    this.y=tab.y;this.baseHeight=tab.height;
    this.inputX=tabs[0].x+(this.inputX-left)*ratio;
    this.travelMin=tabs[0].x+(this.travelMin-left)*ratio;this.travelMax=tabs[0].x+(this.travelMax-left)*ratio;
    if(this.holding){this.targetX=tabs[0].x+(this.targetX-left)*ratio;this.desiredX=tabs[0].x+(this.desiredX-left)*ratio;this.dragX=tabs[0].x+(this.dragX-left)*ratio;}
    else this.target(this.committed);
    this.wobble.speed=this.speed/this.span;
  }
  tick(dt,time){
    dt=clamp(dt,0,.2);
    this.activationAge+=dt;
    if(Number.isFinite(this.tapHeightAge))this.tapHeightAge+=dt;
    const heightTarget=Number.isFinite(this.tapHeightAge)?1-stretchEase(clamp((this.tapHeightAge-TAP_MOTION.heightDelay)/TAP_MOTION.heightRecovery,0,1)):1;
    this.tapHeightScale+=(heightTarget-this.tapHeightScale)*(1-Math.exp(-dt/TAP_MOTION.heightResponse));
    const edgeImpact=this.edgeImpact;edgeImpact.age+=dt;
    if(edgeImpact.settling)edgeImpact.fadeAge+=dt;
    if(this.holding)this.holdGate=Math.max(this.holdGate,holdGrowth(this.activationAge,0));
    if(time-this.lastMove>.025){const decay=Math.exp(-dt/MOTION.velocityDecay);this.speed*=decay;this.speedMagnitude*=decay;}
    if(this.reduced){this.x=this.targetX=this.desiredX;this.v=0;this.baseWidth=this.targetWidth;this.widthV=0;this.hold=this.holdV=this.stretch=this.stretchV=this.materialV=this.speed=this.speedMagnitude=this.relax=this.relaxV=this.flow=this.flowV=this.recoil=this.recoilV=this.restRipple=this.restRippleStart=this.tapStretch=this.contact=this.contactV=this.contactHold=this.trackSwell=this.trackSwellV=0;this.restRippleAge=Infinity;edgeImpact.side=edgeImpact.lean=edgeImpact.contact=edgeImpact.speed=edgeImpact.tapSide=edgeImpact.tapSpeed=0;edgeImpact.age=edgeImpact.fadeAge=Infinity;edgeImpact.settling=edgeImpact.recovering=edgeImpact.centered=edgeImpact.tapCenter=false;this.wobble.reset();this.material=this.holding?.3:0;this.tapHeightScale=1;this.tapHeightAge=Infinity;this.phase=this.holding?'held':this.swiping?'dragging':'resting';return;}
    edgeImpact.lean+=(edgeImpact.side-edgeImpact.lean)*(1-Math.exp(-dt/.045));
    [this.contact,this.contactV]=spring(this.contact,this.contactV,0,dt,CONTACT_MOTION.frequency,CONTACT_MOTION.damping);
    // End the contact pulse at its first return; no tiny repeated echoes.
    if(this.contact<0)this.contact=this.contactV=0;
    // Bridge the quick contact pulse into a sustained hold. Retain its peak
    // until swelling/material take over, then dissipate smoothly on release.
    this.contactHold=this.holding?Math.max(this.contactHold,clamp(this.contact,0,.3)):this.contactHold*Math.exp(-dt/.055);
    const trackTarget=this.graySwipe?0:clamp(Math.max(this.contact,this.contactHold)/.3,0,1);
    [this.trackSwell,this.trackSwellV]=spring(this.trackSwell,this.trackSwellV,trackTarget,dt,TRACK_MOTION.response,TRACK_MOTION.damping);
    if(!this.swiping)[this.baseWidth,this.widthV]=spring(this.baseWidth,this.widthV,this.targetWidth,dt,20);
    [this.hold,this.holdV]=spring(this.hold,this.holdV,this.holding?1:0,dt,this.holding?MOTION.swell:MOTION.releaseSwell,this.holding?MOTION.swellDamping:1);
    const intensity=clamp((this.speedMagnitude/this.span-MOTION.stretchStart)/(MOTION.stretchFull-MOTION.stretchStart),0,1);
    const stretchTarget=this.holding&&this.dragging?intensity*intensity*(3-2*intensity):0;
    const previous=this.stretch;
    // A short attack makes brief fast sweeps visible. Recovery is slower and
    // monotonic, so a held pause relaxes without repeated spring bouncing.
    this.stretch+=(stretchTarget-this.stretch)*(1-Math.exp(-dt/(stretchTarget>this.stretch?MOTION.stretchAttack:MOTION.stretchRecovery)));
    this.stretchV=dt?(this.stretch-previous)/dt:0;
    // Transfer the disappearing horizontal stretch into vertical recoil.
    // This is driven by braking, not by the absolute pointer position or a
    // repeated timer. Preserve the spring state through reversal/re-press.
    if(stretchTarget>previous+.035)this.braking=false;
    if(this.holding&&!this.braking&&previous>.35&&stretchTarget<previous-.18){
      this.recoilV=Math.min(34,this.recoilV+previous*MOTION.recoilTransfer);this.braking=true;
    }
    [this.recoil,this.recoilV]=spring(this.recoil,this.recoilV,0,dt,MOTION.recoil,MOTION.recoilDamping);
    if(Number.isFinite(this.restRippleAge)){
      this.restRippleAge+=dt;
      const t=this.restRippleAge;
      if(edgeImpact.recovering){
        this.restRipple=this.restRippleStart*(1-stretchEase(clamp(t/EDGE_IMPACT.regrab,0,1)));
        if(t>=EDGE_IMPACT.regrab){this.restRipple=this.restRippleStart=0;this.restRippleAge=Infinity;edgeImpact.side=edgeImpact.lean=0;edgeImpact.recovering=edgeImpact.centered=false;}
      }else if(edgeImpact.settling){
        const impact=edgeImpact.centered?CENTER_IMPACT:EDGE_IMPACT;
        const hold=edgeImpact.centered?0:EDGE_IMPACT.hold;
        const ease=edgeImpact.centered?recoveryEase:stretchEase;
        if(t<impact.attack)this.restRipple=this.restRippleStart+(this.restRippleTarget-this.restRippleStart)*ease(t/impact.attack);
        else if(t<impact.attack+hold)this.restRipple=this.restRippleTarget;
        else if(t<impact.attack+hold+impact.recover)this.restRipple=this.restRippleTarget*(1-ease((t-impact.attack-hold)/impact.recover));
        else{this.restRipple=this.restRippleStart=0;this.restRippleAge=Infinity;edgeImpact.side=edgeImpact.lean=0;edgeImpact.settling=edgeImpact.centered=false;}
      }else{
        const hold=this.releaseEased?0:ARRIVAL_STRETCH.hold,ease=this.releaseEased?recoveryEase:stretchEase;
        if(t<ARRIVAL_STRETCH.expand)this.restRipple=this.restRippleStart+(this.restRippleTarget-this.restRippleStart)*ease(t/ARRIVAL_STRETCH.expand);
        else if(t<ARRIVAL_STRETCH.expand+hold)this.restRipple=this.restRippleTarget;
        else if(t<ARRIVAL_STRETCH.expand+hold+ARRIVAL_STRETCH.settle)this.restRipple=this.restRippleTarget*(1-ease((t-ARRIVAL_STRETCH.expand-hold)/ARRIVAL_STRETCH.settle));
        else {this.restRipple=this.restRippleStart=0;this.restRippleAge=Infinity;edgeImpact.side=edgeImpact.lean=0;}
      }
    }
    const flowTarget=this.holding&&this.dragging?clamp(this.speed/(this.span*2.3),-1,1):this.gliding?clamp(this.v/this.span*.12,-.25,.25):0;
    [this.flow,this.flowV]=spring(this.flow,this.flowV,flowTarget,dt,MOTION.directionResponse);
    [this.relax,this.relaxV]=spring(this.relax,this.relaxV,0,dt,MOTION.relaxation);
    const previousTravelVelocity=this.v;
    if(!this.swiping){
      this.targetX=this.desiredX;
      const frequency=this.dragging?MOTION.follow:this.gliding?TAP_MOTION.frequency:this.holding?MOTION.travel:MOTION.snap;
      const damping=this.dragging||this.holding&&!this.gliding?1:this.gliding?TAP_MOTION.damping:MOTION.damping;
      [this.x,this.v]=spring(this.x,this.v,this.targetX,dt,frequency,damping);
    }
    const tapBefore=this.gliding&&!this.dragging?Math.tanh(Math.abs(previousTravelVelocity)/(this.span*1.1)):0;
    const tapTarget=this.gliding&&!this.dragging?Math.tanh(Math.abs(this.v)/(this.span*1.1)):0;
    const tau=tapTarget>this.tapStretch?TAP_MOTION.attack:TAP_MOTION.recovery,decay=Math.exp(-dt/tau);
    // Exact first-order response to a linearly varying velocity input.
    this.tapStretch=this.tapStretch*decay+tapBefore*(1-decay)+(tapTarget-tapBefore)*(dt?1-tau/dt*(1-decay):0);
    if(this.gliding&&!this.dragging&&!this.glideBumped&&this.glideDistance>this.baseWidth*.5&&Math.abs(this.x-this.targetX)<this.baseWidth*.28&&Math.abs(this.v)<this.span*2){
      this.recoilV+=TAP_MOTION.jiggle;this.glideBumped=true;
    }
    // Stretch the shared lens silhouette while the glass is still visible.
    // Gray is a material change on this same shape, not a later size pulse.
    if(!this.holding&&!this.swiping&&this.gliding&&!this.dragging&&!this.arrivalStretched&&this.glideDistance>this.baseWidth*.25&&(Math.abs(this.v)<Math.abs(previousTravelVelocity)||Math.abs(this.x-this.targetX)<this.baseWidth*.4)){
      this.beginArrivalStretch();
    }
    if(edgeImpact.tapSide||edgeImpact.tapCenter){
      edgeImpact.tapSpeed=Math.max(Math.abs(this.v)/this.span,edgeImpact.tapSpeed*Math.exp(-dt/EDGE_IMPACT.memory));
      if(!this.holding&&!this.swiping&&Math.abs(this.x-this.targetX)<Math.min(8,this.baseWidth*.12)&&Math.abs(this.v)<this.span*.8){
        // Absorb the incoming motion only on contact. Keep the existing fade
        // clock running so compression cannot restart or flash the glass.
        const fadeAge=this.restRippleAge;
        this.beginArrivalStretch(edgeImpact.tapSide,edgeImpact.tapSpeed,edgeImpact.tapCenter);
        edgeImpact.fadeAge=Number.isFinite(fadeAge)?fadeAge:0;edgeImpact.tapSide=0;edgeImpact.tapCenter=false;
      }
    }
    const clearance=clamp(Math.min(this.x-this.tabs[0].x,this.tabs.at(-1).x-this.x)/(this.baseWidth*.6),0,1);
    this.wobble.tick(dt,this.speed/this.span,this.holding&&this.dragging,clearance*clearance*(3-2*clearance));
    const positionDone=Math.abs(this.x-this.targetX)<.12&&Math.abs(this.v)<.7&&Math.abs(this.baseWidth-this.targetWidth)<.12&&Math.abs(this.widthV)<.7;
    if(!this.holding&&!this.swiping&&this.phase==='snapping'&&positionDone&&this.activationAge>.1){
      this.phase='settling';
    }
    if(this.holding&&!this.dragging&&positionDone)this.phase='held';
    const active=this.holding||this.swiping;
    const age=edgeImpact.settling?edgeImpact.fadeAge:this.restRippleAge;
    const arrivalMaterial=age<ARRIVAL_STRETCH.expand?ARRIVAL_STRETCH.glass:age<ARRIVAL_STRETCH.expand+ARRIVAL_STRETCH.hold?ARRIVAL_STRETCH.glass*(1-stretchEase((age-ARRIVAL_STRETCH.expand)/ARRIVAL_STRETCH.hold)):0;
    const releaseMaterial=Math.max(Math.min(1,Math.abs(this.x-this.targetX)/65),this.hold*.35,arrivalMaterial);
    [this.material,this.materialV]=spring(this.material,this.materialV,this.graySwipe?0:active?1:releaseMaterial,dt,active?MOTION.material:MOTION.releaseMaterial);
    if(!active&&positionDone&&Math.abs(this.material)<.001&&Math.abs(this.materialV)<.02&&Math.abs(this.hold)<.001&&Math.abs(this.holdV)<.02&&Math.abs(this.stretch)<.001&&Math.abs(this.relax)<.001&&Math.abs(this.flow)<.001&&Math.abs(this.flowV)<.02&&Math.abs(this.recoil)<.001&&Math.abs(this.recoilV)<.02&&!Number.isFinite(this.restRippleAge)&&this.tapStretch<.0005&&Math.abs(this.contact)<.0005&&Math.abs(this.contactV)<.005&&this.contactHold<.0005&&Math.abs(this.trackSwell)<.0005&&Math.abs(this.trackSwellV)<.005&&this.wobble.calm&&this.wobble.gain<.0005){
      this.contactHold=0;
      this.wobble.reset();
      this.x=this.targetX;this.v=0;this.baseWidth=this.targetWidth;this.widthV=0;this.hold=this.holdV=this.stretch=this.stretchV=this.material=this.materialV=this.relax=this.relaxV=this.flow=this.flowV=this.recoil=this.recoilV=this.restRipple=this.restRippleStart=this.tapStretch=this.contact=this.contactV=this.holdGate=this.trackSwell=this.trackSwellV=0;this.restRippleAge=Infinity;this.arrivalStretched=false;this.speed=this.speedMagnitude=0;this.gliding=false;this.tapHeightAge=Infinity;this.tapHeightScale=1;this.phase='resting';
    }
  }
  get visual(){
    // Body-page swipes move the opaque selection only. This remains latched
    // through commit/cancel settling; a fresh navbar press restores glass.
    if(this.graySwipe)return {x:this.x,y:this.y,width:this.baseWidth,height:this.baseHeight,material:0,relax:0,ripple:0,flow:0,contour:0,trackScaleX:1,trackScaleY:1};
    const swell=clamp(this.hold*this.holdGate,0,1.05),stretch=clamp(this.stretch,0,1),recoil=clamp(this.recoil,-.12,.85),relax=clamp(this.relax,0,.3),contact=clamp(this.contact,0,.3);
    const material=clamp(Math.max(this.material,contact*3,this.contactHold*3),0,1);
    const contactSize=Math.max(contact,this.contactHold*(1-this.holdGate));
    const ripple=clamp(this.restRipple,-EDGE_IMPACT.max,ARRIVAL_STRETCH.max);
    let width=this.baseWidth*((1+swell*MOTION.holdWidth)*(1+stretch*MOTION.maxStretch)*(1-recoil*MOTION.recoilWidth)-relax*.012);
    let height=this.baseHeight*((1+swell*MOTION.holdHeight)*(1-stretch*MOTION.stretchHeight)*(1+recoil*MOTION.recoilHeight)-relax*.02);
    // Travel adds a fuller droplet around the same fixed vertical center.
    // The existing filtered travel envelope relaxes it as the pill arrives.
    width*=1+(TAP_MOTION.stretch+TAP_MOTION.swellWidth)*this.tapStretch+contactScale(contactSize);
    height*=1+TAP_MOTION.swellHeight*this.tapStretch+contactScale(contactSize);
    height=this.baseHeight+(height-this.baseHeight)*this.tapHeightScale;
    width*=1+Math.max(0,ripple);
    // Bounded compression at either elastic end: the volume rounds upward
    // rather than striking a wall. Position remains independently resisted.
    const reach=Math.min(MOTION.resistance,this.baseHeight*.24);
    let edge=clamp(Math.max(this.tabs[0].x-this.x,this.x-this.tabs.at(-1).x)/reach,0,1);
    edge=edge*edge*(3-2*edge);
    width*=1-.025*edge;height*=1+.035*edge;
    // The new motion spends a small shared deformation budget. Suppress it
    // as existing stretch/recoil and the edge handoff absorb the movement.
    const budget=this.wobble.gain*(1-stretch*.25)*(1-Math.max(0,recoil)*.65)*(1-clamp(-ripple/.14,0,1)*.8);
    const wobble=clamp(this.wobble.strain,-.4,1)*budget;
    const braking=clamp(-this.wobble.strain/.4,0,1)*budget;
    width*=1+wobble*.035-braking*.025;
    height*=1-wobble*.017;height+=this.baseHeight*braking*.18;
    if(this.limits){
      // Where the screen runs out, let the droplet round upward instead of
      // pinning its center against a shape-dependent position constraint.
      const available=Math.max(1,2*Math.min(this.x-this.limits.left,this.limits.right-this.x)),band=8;
      const excess=width-available;
      const fitted=excess<=-band?width:excess>=band?available:width-(excess+band)**2/(4*band);
      width=fitted;
    }
    // Preserve an elongated capsule, including on compact four-tab tracks.
    // Reduce excess height smoothly instead of rounding into a circle or
    // forcing its centre against a viewport/neighbor constraint.
    // Braking can round the whole droplet upward briefly. The shared height
    // rises uniformly; edge damping prevents this allowance stacking at ends.
    const aspect=Math.max(1.18,Math.max(1.30,this.baseWidth/this.baseHeight)-braking*.24),limit=width/aspect,band=2;
    const excess=height-limit;
    const capsuleHeight=excess<=-band?height:excess>=band?limit:height-(excess+band)**2/(4*band);
    height+=(capsuleHeight-height)*clamp(swell,0,1);
    // Deform shared glass/gray geometry after viewport fitting. End impacts
    // attach the leading edge; centered arrivals remove equal width from both
    // sides. Texture, refraction, highlights and mask all use this outline.
    const compression=Math.max(0,-ripple),removed=width*compression;
    const x=this.x+this.edgeImpact.lean*removed/2;
    width-=removed;height*=1+compression*EDGE_IMPACT.height;
    return {x,y:this.y,width,height,material,relax,ripple,flow:clamp(this.flow,-1,1),contour:this.wobble.contour*budget,trackScaleX:1+TRACK_MOTION.width*clamp(this.trackSwell,0,1),trackScaleY:1+TRACK_MOTION.height*clamp(this.trackSwell,0,1)};
  }
  get needsFrame(){return !this.reduced&&this.phase!=='resting'&&!(this.holding&&Math.abs(this.x-this.targetX)<.04&&Math.abs(this.v)<.1&&Math.abs(this.hold-1)<.0005&&Math.abs(this.holdV)<.005&&Math.abs(this.material-1)<.0005&&Math.abs(this.materialV)<.005&&Math.abs(this.stretch)<.0005&&Math.abs(this.stretchV)<.005&&Math.abs(this.flow)<.0005&&Math.abs(this.flowV)<.005&&Math.abs(this.recoil)<.0005&&Math.abs(this.recoilV)<.005&&!Number.isFinite(this.restRippleAge)&&Math.abs(this.speedMagnitude)<.1&&this.tapStretch<.0005&&Math.abs(this.contact)<.0005&&Math.abs(this.contactV)<.005&&Math.abs(this.trackSwell-clamp(Math.max(this.contact,this.contactHold)/.3,0,1))<.0005&&Math.abs(this.trackSwellV)<.005&&this.wobble.calm);}
}
