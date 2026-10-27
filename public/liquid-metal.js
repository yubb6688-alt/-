// The photographic cover and procedural studio use distinct liquid forms.
// Each renderer stops when hidden, offscreen or in a background tab.
(() => {
const vertexSource = `attribute vec2 position; void main(){gl_Position=vec4(position,0.0,1.0);}`;
// The cover uses the reference-inspired photographic artwork as a texture.
// Gentle spatial warping gives it fluid motion while preserving fine reflections.
const photographicSource = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform vec2 pointer;
uniform sampler2D artwork;
uniform float imageAspect;
void main(){
 vec2 screen=gl_FragCoord.xy/resolution;
 float aspect=resolution.x/resolution.y;
 float portrait=1.-smoothstep(.8,1.25,aspect);
 vec2 fit=aspect>imageAspect?vec2(1.,imageAspect/aspect):vec2(aspect/imageAspect,1.);
 vec2 uv=(screen-.5)*fit*.962+vec2(mix(.5,.56,portrait),.5);
 float liquid=smoothstep(.22,.58,uv.x);
 float gold=exp(-dot((uv-vec2(.55,.48))*vec2(8.,3.8),(uv-vec2(.55,.48))*vec2(8.,3.8)));
 vec2 current=vec2(sin(uv.y*7.5+time*.24)+.4*sin(uv.x*10.-time*.18),cos(uv.x*7.+time*.2)+.4*sin(uv.y*9.+time*.17));
 uv+=current*vec2(.0055,.0075)*liquid;
 uv+=vec2(sin(time*.31)*.003,cos(time*.27)*.009)*gold;
 uv+=vec2(sin(time*.11)*.0025,cos(time*.13)*.002)+pointer*.003*liquid;
 gl_FragColor=texture2D(artwork,clamp(uv,vec2(.001),vec2(.999)));
}`;

const fragmentSource = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform vec2 pointer;
float blend(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float ellipsoid(vec3 p,vec3 r){float k0=length(p/r);float k1=length(p/(r*r));return k0*(k0-1.)/max(k1,.001);}
mat2 rotate(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
// A suspended mercury cluster, with soft necks that merge and separate.
// The studio has its own silhouette; it contains no rings or cut-out loops.
vec2 studioScene(vec3 p){
  float t=time*.44;
  vec3 q=p;
  q.xy=rotate(.18*sin(t*.45)-.18)*q.xy;
  q.xz=rotate(.14*sin(t*.6))*q.xz;
  q.x+=.07*sin(q.y*3.+t*.8);
  float silver=ellipsoid(q-vec3(-.3,-.38,0.),vec3(.91,.69,.66));
  vec3 shoulder=vec3(.44+.20*sin(t*.8),.28+.13*cos(t*.7),-.08);
  silver=blend(silver,ellipsoid(q-shoulder,vec3(.64,.74,.57)),.37);
  vec3 rising=vec3(-.4+.24*sin(t*.65),.93+.64*sin(t*.9+.5),.1);
  silver=blend(silver,ellipsoid(q-rising,vec3(.43,.51,.42)),.26);
  vec3 falling=vec3(.36+.23*cos(t*.75),-1.18-.43*sin(t*.8),.25);
  silver=blend(silver,ellipsoid(q-falling,vec3(.39,.43,.38)),.21);
  silver=min(silver,length(q-vec3(-1.42+.13*sin(t),-.86+.15*cos(t*.8),.3))-.13);
  silver=min(silver,length(q-vec3(.98+.18*cos(t*.7),1.18+.13*sin(t*.9),-.1))-.105);
  vec3 a=p-vec3(1.46+.12*sin(t*.6),-.16+.34*cos(t*.8),.6);
  a.xy=rotate(-.5+.28*sin(t*.7))*a.xy;
  float gold=ellipsoid(a,vec3(.29,.48,.29));
  gold=blend(gold,ellipsoid(a-vec3(.10,-.34-.18*sin(t),-.02),vec3(.20,.24,.20)),.13);
  vec3 b=p-vec3(-1.36+.16*sin(t*.7),.78+.16*cos(t*.9),.5);
  b.xy=rotate(.45+.3*sin(t*.5))*b.xy;
  gold=min(gold,ellipsoid(b,vec3(.21,.30,.22)));
  return gold<silver?vec2(gold,1.):vec2(silver,0.);
}
vec2 scene(vec3 p){return studioScene(p);}
vec3 normal(vec3 p){vec2 e=vec2(.002,0.);return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,scene(p+e.yxy).x-scene(p-e.yxy).x,scene(p+e.yyx).x-scene(p-e.yyx).x));}
float rect(vec2 p,vec2 size,float edge){vec2 d=abs(p)-size;return 1.-smoothstep(-edge,edge,max(d.x,d.y));}
vec3 environment(vec3 r){
  vec3 color=mix(vec3(.18,.19,.20),vec3(.82,.83,.84),smoothstep(-.7,.8,r.y));
  // Dark studio flags and large rectangular light panels reflected in the surface.
  vec2 wall=r.xy/max(abs(r.z),.16);
  wall.x+=.16*sin(wall.y*3.1)+.08*sin(wall.y*6.);
  float black=rect(wall-vec2(.18,-.1),vec2(.42,2.4),.04);
  color=mix(color,vec3(.025,.028,.032),black*.96);
  float key=rect(wall-vec2(-1.1,.45),vec2(.46,1.9),.055);
  float strip=rect(wall-vec2(1.35,.0),vec2(.16,2.8),.025);
  float top=rect(r.xz/max(abs(r.y),.12)-vec2(-.3,.25),vec2(1.4,.65),.07)*smoothstep(.1,.5,r.y);
  float edgeLight=rect(wall-vec2(-2.3,.2),vec2(.09,2.),.035);
  color+=vec3(1.8)*key+vec3(2.3)*strip+vec3(1.65)*top+vec3(1.4)*edgeLight;
  color+=vec3(.4)*pow(max(0.,dot(r,normalize(vec3(-1.,1.,2.)))),36.);
  return color;
}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 vec3 ro=vec3(pointer.x*.12,pointer.y*.08,7.7);
 vec3 rd=normalize(vec3(uv*4.7,-6.6));
 vec3 background=mix(vec3(.68,.69,.70),vec3(.91,.91,.90),smoothstep(-1.8,2.,uv.x*3.+uv.y*.5));
 float distance=0.;vec2 hit=vec2(0.);bool found=false;
 for(int i=0;i<104;i++){hit=scene(ro+rd*distance);if(hit.x<.0015){found=true;break;}distance+=hit.x*.78;if(distance>14.)break;}
 vec3 color=background;
 if(found){
  vec3 p=ro+rd*distance;vec3 n=normal(p);
  vec3 reflected=reflect(rd,n);
  vec3 tint=mix(vec3(.93,.96,1.),vec3(1.,.62,.25),hit.y);
  float facing=max(dot(n,-rd),0.);float fresnel=pow(1.-facing,5.);
  vec3 reflectedLight=environment(reflected);
  vec3 metal=reflectedLight*mix(tint,vec3(1.),fresnel*.7);
  float ao=clamp(scene(p+n*.22).x/.22,.3,1.);
  metal*=mix(.63,1.,ao);
  metal+=vec3(.07)*pow(1.-facing,2.);
  color=metal/(metal+vec3(.55));
  color=pow(color,vec3(.83));
  float fog=smoothstep(7.5,12.,distance)*.65;
  color=mix(color,background,fog);
 }
 gl_FragColor=!found ? vec4(0.) : vec4(color,1.);
}`;

function createLiquidSculpture(canvas, root, toggle, preview = false) {
  if (!canvas || !root || !toggle) return;
  let gl;
  try { gl = canvas.getContext('webgl', { alpha: preview, antialias: false, powerPreference: 'low-power' }); }
  catch { toggle.hidden = true; return; }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const frameInterval = 1000 / (preview || coarsePointer ? 30 : 60);
  let paused = reducedMotion.matches;
  let visible = true;
  let frame = 0;
  let time = 0;
  let previous = 0;
  let pointer = [0, 0];
  let target = [0, 0];
  let program;
  let textureReady = false;
  const sourceImage = preview ? null : new Image();
  let resolutionLocation, timeLocation, pointerLocation;
function shader(type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source); gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); throw new Error('Liquid shader unavailable'); }
  return result;
}
function setup() {
  const vertex = shader(gl.VERTEX_SHADER, vertexSource);
  const fragment = shader(gl.FRAGMENT_SHADER, preview ? fragmentSource : photographicSource);
  program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Liquid program unavailable');
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  resolutionLocation = gl.getUniformLocation(program, 'resolution');
  timeLocation = gl.getUniformLocation(program, 'time');
  pointerLocation = gl.getUniformLocation(program, 'pointer');
  if (preview) root.classList.add('has-webgl');
  else {
    textureReady = false;
    const texture = gl.createTexture();
    const upload = () => {
      if (gl.isContextLost()) return;
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,sourceImage);
      gl.uniform1i(gl.getUniformLocation(program,'artwork'),0);
      gl.uniform1f(gl.getUniformLocation(program,'imageAspect'),sourceImage.naturalWidth/sourceImage.naturalHeight);
      textureReady = true;
      root.classList.add('has-webgl');
      sync();
    };
    sourceImage.onload = upload;
    sourceImage.onerror = () => { textureReady=false;root.classList.remove('has-webgl');toggle.hidden=true;sync(); };
    if (sourceImage.complete && sourceImage.naturalWidth) upload();
    else sourceImage.src = '/hero-liquid-cover.webp';
  }
}
function draw() {
  if (!preview && !textureReady) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const maxScale = preview ? (coarsePointer ? 1.25 : 1.5) : 1.5;
  const scale = Math.min(devicePixelRatio || 1, maxScale, (preview ? 720 : 1800) / Math.max(rect.width, 1));
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; gl.viewport(0,0,width,height); }
  gl.uniform2f(resolutionLocation,width,height);gl.uniform1f(timeLocation,time);gl.uniform2f(pointerLocation,...pointer);
  gl.drawArrays(gl.TRIANGLES,0,6);
}
function animate(now) {
  frame = 0;
  if (!visible || root.hidden || document.hidden || paused || (!preview && !textureReady)) { previous = 0; return; }
  // Avoid rendering the ray-marched sculpture at 90/120 Hz on high-refresh phones.
  if (previous && now - previous < frameInterval - .5) { frame = requestAnimationFrame(animate); return; }
  if (previous) time += Math.min((now-previous)/1000,.1);
  previous = now;
  pointer = pointer.map((value,i) => value + (target[i]-value)*.035);
  draw(); frame = requestAnimationFrame(animate);
}
function sync() {
  toggle.setAttribute('aria-pressed', String(paused));
  toggle.setAttribute('aria-label', `${paused ? '播放' : '暂停'}${preview ? '预览动画' : '液态金属动画'}`);
  toggle.querySelector('span').textContent = paused ? '播放动态' : '暂停动态';
  toggle.querySelector('svg').classList.toggle('is-paused',paused);
  if (frame) cancelAnimationFrame(frame);
  frame = 0; previous = 0;
  if (program && !gl.isContextLost() && !root.hidden && visible && !document.hidden) { draw(); if (!paused && (preview || textureReady)) frame=requestAnimationFrame(animate); }
}
if (gl) {
  try {
    setup(); sync();
    new ResizeObserver(() => { if (!gl.isContextLost() && !root.hidden && visible && !document.hidden) draw(); }).observe(canvas);
    new IntersectionObserver(entries => { visible=entries[0].isIntersecting;sync(); }).observe(root);
    new MutationObserver(sync).observe(root, { attributes:true, attributeFilter:['hidden'] });
    document.addEventListener('visibilitychange',sync);
    toggle.addEventListener('click',() => { paused=!paused;sync(); });
    reducedMotion.addEventListener('change',event => { paused=event.matches;sync(); });
    root.addEventListener('pointermove',event => { const r=root.getBoundingClientRect();target=[(event.clientX-r.left)/r.width-.5,.5-(event.clientY-r.top)/r.height]; });
    root.addEventListener('pointerleave',() => { target=[0,0]; });
    canvas.addEventListener('webglcontextlost',event => { event.preventDefault();cancelAnimationFrame(frame);program=null;root.classList.remove('has-webgl');toggle.hidden=true; });
    canvas.addEventListener('webglcontextrestored',() => { try { setup();toggle.hidden=false;sync(); } catch { toggle.hidden=true; } });
  } catch { root.classList.remove('has-webgl');toggle.hidden=true; }
} else toggle.hidden=true;

}
createLiquidSculpture(document.querySelector('#liquid-metal'), document.querySelector('.metal-hero'), document.querySelector('#motion-toggle'));
createLiquidSculpture(document.querySelector('#studio-liquid-metal'), document.querySelector('#studio-visual'), document.querySelector('#studio-motion-toggle'), true);
})();
