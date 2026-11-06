// Gemeinsame Vorbereitung: externe Dienste nachbilden, localStorage vorbelegen, optional die Android-Brücke.
const path=require('path');
const LF=path.dirname(require.resolve('leaflet/dist/leaflet.js'));
const TILE=path.join(__dirname,'fixtures','tile.png');
const CORS={'access-control-allow-origin':'*'};

// Standardstrecke Herzogenaurach → Regensburg (Luftlinie), Punkte gleichmäßig verteilt
const A=[49.57,10.88],B=[49.05,12.05];
const lerp=t=>[A[0]+t*(B[0]-A[0]),A[1]+t*(B[1]-A[1])];
const routePoints=(n=100)=>Array.from({length:n},(_,i)=>{const q=lerp(i/(n-1));return{latitude:q[0],longitude:q[1]}});
// Seiten mit fester Uhr (page.clock); ohne darf page.clock nicht benutzt werden, sonst steht die Uhr auf 1970
const fixed=new WeakSet();
const json=(r,body,status=200)=>r.fulfill({status,headers:CORS,json:body});
// TomTom-Öffnungszeit
const T=(date,hour,minute=0)=>({date,hour,minute});

/**
 * @param page Playwright-Seite
 * @param o.ls       localStorage-Werte (werden als JSON gespeichert)
 * @param o.android  true oder Objekt {status}: simulierte Android-Brücke, Aufrufe landen in window.syncs usw.
 * @param o.time     feste Uhrzeit (ISO-String); dann läuft die Uhr nur über page.clock
 * @param o.routes   [[Muster, Handler], …] zusätzlich zu den Standard-Nachbildungen (haben Vorrang)
 */
async function setup(page,o={}){
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  const ctx=page.context();
  if(o.geo!==false){await ctx.grantPermissions(['geolocation']);await ctx.setGeolocation({latitude:A[0],longitude:A[1]})}
  if(o.time){await page.clock.install({time:new Date(o.time)});fixed.add(page)}
  await page.route('**/leaflet.min.js',r=>r.fulfill({path:path.join(LF,'leaflet.js')}));
  await page.route('**/leaflet.min.css',r=>r.fulfill({path:path.join(LF,'leaflet.css')}));
  for(const p of['**/tile.openstreetmap.org/**','**/api.tomtom.com/traffic/map/**','**/api.tomtom.com/map/**'])await page.route(p,r=>r.fulfill({path:TILE}));
  await page.route('**/nominatim.openstreetmap.org/**',r=>json(r,[{lat:String(B[0]),lon:String(B[1]),display_name:'Ziel'}]));
  await page.route('https://api.github.com/**',r=>json(r,{tag_name:'v0.0.1'}));
  await page.route('**/json/list.php*',r=>json(r,{ok:true,stations:[]}));
  await page.route('**/json/prices.php*',r=>json(r,{ok:true,prices:{}}));
  await page.route('**/json/detail.php*',r=>json(r,{ok:true,station:{}}));
  await page.route('**/api.tomtom.com/routing/**',r=>json(r,{routes:[{summary:{lengthInMeters:115000,travelTimeInSeconds:4300},legs:[{points:routePoints()}]}]}));
  await page.route('**/api.tomtom.com/search/**',r=>json(r,{results:[]}));
  await page.route('**/api.tomtom.com/traffic/services/**',r=>json(r,{incidents:[]}));
  for(const [p,h] of o.routes||[])await page.route(p,h);
  await page.addInitScript(([ls,android])=>{
    if(sessionStorage.getItem('prepared'))return;
    sessionStorage.setItem('prepared','1');
    localStorage.setItem('updT',String(Date.now()));
    for(const k in ls)localStorage.setItem(k,JSON.stringify(ls[k]));
  },[{key:'KEY',...o.ls},null]);
  if(o.android)await page.addInitScript(st=>{
    window.syncs=[];window.notifyReq=0;window.sys=[];window.refreshes=0;window.ST=st;
    window.Android={version:()=>'1.0.0',share(){},saveFile(){},syncConfig:j=>syncs.push(JSON.parse(j)),requestNotify:()=>notifyReq++,
      prices:()=>JSON.stringify(window.bgPrices||{}),status:()=>JSON.stringify(window.ST||{}),openSystem:w=>sys.push(w),refreshNow:()=>refreshes++};
  },o.android.status||{});
  await page.goto('/index.html');
  await settle(page,o.time?800:500);
  return errs;
}

// Zeit vergehen lassen: mit fester Uhr über page.clock, sonst echt
async function settle(page,ms=400){
  if(fixed.has(page))await page.clock.runFor(ms);else await page.waitForTimeout(ms);
  await page.waitForTimeout(50);
}

// Warten, bis eine Bedingung in der Seite erfüllt ist (auch mit fester Uhr)
async function until(page,fn,arg,max=15000){
  for(let t=0;t<max;t+=300){if(await page.evaluate(fn,arg))return true;await settle(page,250)}
  throw new Error('Bedingung nicht erfüllt: '+fn);
}

module.exports={setup,settle,until,json,T,A,B,lerp,routePoints,CORS};
