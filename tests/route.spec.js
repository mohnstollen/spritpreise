const {test,expect}=require('@playwright/test');
const {setup,settle,until,json,T,lerp,routePoints}=require('./helpers');

// 14 Tankstellen entlang der Strecke, Preis steigt mit dem Index
const ST=Array.from({length:14},(_,i)=>{const q=lerp(0.05+i*0.065);return{id:'s'+i,name:'S'+i,brand:['ARAL','JET','ESSO'][i%3],street:'Hauptstr.',houseNumber:String(i),
  postCode:'90000',place:'Ort'+i,lat:q[0],lng:q[1]+0.002,e10:1.80+i*0.01,e5:1.86+i*0.01,isOpen:i!==2}});
const DAY='2026-10-28';
const poi=(name,cat,dist,lat,extra={})=>({poi:{name,categorySet:[{id:cat}],openingHours:{timeRanges:[{startTime:T(DAY,7),endTime:T(DAY,20)}]},...extra},position:{lat,lon:11},dist,address:{freeformAddress:'Markt 1'}});
// Orte je Tankstelle: Supermärkte bei ungeraden, Bäcker bei 3 (offen) und 9 (bei Ankunft zu)
function nearby(n){
  return async r=>{n.near++;const lat=+new URL(r.request().url()).searchParams.get('lat'),i=ST.findIndex(s=>Math.abs(s.lat-lat)<1e-6),res=[];
    if(i%2)res.push(poi('ALDI Süd',7332005,70,lat),poi('Lidl',7332005,300,lat),poi('REWE',7332005,450,lat),poi('Netto',7332005,800,lat));
    if(i===3)res.push(poi('Der Beck',9361018,100,lat),poi('der beck',9361018,400,lat),poi('Bäckerei-Konditorei-Cafe Polster',9361018,90,lat));
    if(i===9)res.push({...poi('Beck zu',9361018,100,lat),poi:{name:'Beck zu',categorySet:[{id:9361018}],openingHours:{timeRanges:[{startTime:T(DAY,14),endTime:T(DAY,18)}]}}});
    await json(r,{results:res});
  };
}
const sections=[{sectionType:'TRAFFIC',startPointIndex:20,endPointIndex:24,delayInSeconds:720,simpleCategory:'JAM',tec:{causes:[{mainCauseCode:2}]}},
  {sectionType:'TRAFFIC',startPointIndex:40,endPointIndex:43,delayInSeconds:0,simpleCategory:'ROAD_WORK',tec:{causes:[{mainCauseCode:3}]}},
  {sectionType:'TRAFFIC',startPointIndex:60,endPointIndex:62,delayInSeconds:30,simpleCategory:'JAM',tec:{causes:[{mainCauseCode:1}]}},
  {sectionType:'TRAFFIC',startPointIndex:85,endPointIndex:86,delayInSeconds:0,simpleCategory:'ROAD_CLOSURE'}];
const at=i=>{const q=lerp(i/99);return[q[1]+0.0005,q[0]]};

async function start(page,o={}){
  const n={near:0,route:[],inc:0};
  const errs=await setup(page,{time:'2026-10-28T09:30:00+01:00',ls:{tt:'TT',fuel:'e10',pois:o.pois||{},...o.ls},routes:[
    ['**/json/list.php*',r=>json(r,{ok:true,stations:ST})],
    ['**/api.tomtom.com/routing/**',r=>{n.route.push(r.request().url());return json(r,{routes:[{summary:{lengthInMeters:115000,travelTimeInSeconds:4300,trafficDelayInSeconds:900},sections,legs:[{points:routePoints()}]}]})}],
    ['**/api.tomtom.com/search/2/nearbySearch/**',nearby(n)],
    ['**/api.tomtom.com/search/2/search/**',r=>json(r,{results:[{type:'Geography',address:{freeformAddress:'83562 Rechtmehring',countrySubdivision:'Bayern'},position:{lat:49.05,lon:12.05}}]})],
    ['**/incidentDetails**',r=>{n.inc++;return json(r,{incidents:[
      {geometry:{type:'LineString',coordinates:[at(20),at(24)]},properties:{iconCategory:1,from:'Kreuz Nürnberg-Ost',to:'Lauf/Hersbruck',roadNumbers:['A3']}},
      {geometry:{type:'LineString',coordinates:[at(40),at(43)]},properties:{iconCategory:9,from:'Behringersdorf',to:'Lauf-West',roadNumbers:['A3']}},
      {geometry:{type:'Point',coordinates:[at(85)[0]+0.05,at(85)[1]]},properties:{iconCategory:8,from:'Weit',to:'Weg',roadNumbers:['B8']}}]})}],
  ]});
  await page.click('nav [data-v=route]');
  await page.click('#rd');await page.keyboard.type('Rechtm');await settle(page,700);
  await page.locator('#ac button').first().click();
  if(o.corr)await page.selectOption('#rc',String(o.corr));
  await page.click('#rgo');
  await until(page,()=>!!$('#rsum .sum')&&!/prüfe weitere|Suche Orte/.test($('#rsum').textContent+$('#ritems').textContent)&&!route?.poiBusy);
  return {n,errs};
}
const cards=page=>page.evaluate(()=>[...$$('#ritems .card')].map(c=>c.querySelector('b').textContent+'/'+c.querySelector('.r1 .p').textContent));

test('Route: Zusammenfassung, Median-Zeile, Meldungen mit Anschlussstellen',async({page})=>{
  const {n,errs}=await start(page,{corr:5});
  const sum=await page.textContent('#rsum .sum');
  expect(sum).toContain('115,0 km');
  expect(sum).toContain('(+15 min Stau)');
  expect(await page.locator('#ritems .card').count()).toBe(10);
  // Median-Ersparnis in einer Zeile
  const med=page.locator('#ritems .card .facts',{hasText:'ggü. Median'}).first();
  await expect(med).toContainText(/[−+]\d,\d\d € ggü. Median/);
  expect((await med.boundingBox()).height).toBeLessThan(26);
  // Meldungen: Stau ohne Verzögerung entfällt, Treffer bekommen Straße und Anschlussstellen
  await until(page,()=>[...$$('#rsum .irow')].some(x=>x.textContent.includes('→')));
  const inc=await page.evaluate(()=>[...$$('#rsum .irow')].map(x=>x.textContent));
  expect(inc).toHaveLength(3);
  expect(inc[0]).toMatch(/^Unfall · A3 Kreuz Nürnberg-Ost → Lauf\/Hersbruck \(km \d+–\d+\) · \+12 min$/);
  expect(inc[1]).toMatch(/^Baustelle · A3 Behringersdorf → Lauf-West/);
  expect(inc[2]).toMatch(/^Sperrung · km \d+/);
  expect(n.inc).toBe(1);
  expect(n.route[0]).toContain('sectionType=traffic');
  expect(errs).toEqual([]);
});

test('Route: Orte in der Nähe, je Kategorie bis 3, Google-Maps-Links über Tankstelle zum Ziel',async({page})=>{
  const {n,errs}=await start(page,{pois:{sm:true,bk:true},corr:5});
  const card=page.locator('#ritems .card',{hasText:'Hauptstr. 3,'});
  const rows=await card.locator('.prow').allTextContents();
  expect(rows[0]).toBe('ALDI Süd 70 m, bis 20:00 · Lidl 300 m, bis 20:00 · REWE 450 m, bis 20:00');
  expect(rows[1]).toMatch(/^Bäckerei-Konditorei-C… 90 m, bis 20:00 · Der Beck 100 m, bis 20:00$/);
  const href=decodeURIComponent(await card.locator('.prow a',{hasText:'REWE'}).getAttribute('href'));
  expect(href).toContain('maps/dir/?api=1');
  expect(href).toContain('destination=83562 Rechtmehring');
  expect(href).toContain('waypoints=ARAL, Hauptstr. 3, 90000 Ort3|REWE, Markt 1');
  const nav=decodeURIComponent(await card.locator('.act a').getAttribute('href'));
  expect(nav).toContain('destination=83562 Rechtmehring&waypoints=ARAL, Hauptstr. 3, 90000 Ort3');
  expect(n.near).toBe(10);
  expect(errs).toEqual([]);
});

test('Route: Filter „Nur mit“, Offen und Marken',async({page})=>{
  const {n,errs}=await start(page,{corr:5});
  expect(await cards(page)).toHaveLength(10);
  await page.click('#open');await settle(page);
  await expect(page.locator('#rsum')).toContainText('1 Tankstelle durch Filter ausgeblendet (nur offene)');
  await page.click('#open');
  await page.click('#flb');
  expect((await page.locator('#brands label').allTextContents()).map(t=>t.trim())).toEqual(['ARAL (5)','ESSO (4)','JET (5)']);
  await page.locator('#brands input[value=JET]').uncheck();await page.click('#flt button[value=ok]');await settle(page);
  expect((await cards(page)).some(c=>c.startsWith('JET'))).toBe(false);
  await page.click('#flb');await page.click('#ball');await page.click('#flt button[value=ok]');
  await page.check('#rpf [data-rpf=sm]');
  await until(page,()=>!/prüfe weitere/.test($('#rsum').textContent)&&!route.poiBusy);
  await expect(page.locator('#rsum')).toContainText('Nur mit Supermarkt, bei Ankunft geöffnet: 7 gefunden, 7 ohne');
  await page.check('#rpf [data-rpf=bk]');await settle(page);
  // Bäcker 9 ist bei Ankunft zu, bleibt nur Tankstelle 3
  expect(await cards(page)).toEqual(['ARAL/1,830']);
  // alle Kategorien in einer Anfrage: Umschalten kostet keine weitere Suche
  expect(n.near).toBe(14);
  expect(errs).toEqual([]);
});
