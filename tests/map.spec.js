const {test,expect}=require('@playwright/test');
const {setup,settle,until,json,T}=require('./helpers');

const P=(cat,c,props={})=>({type:'Feature',geometry:{type:'Point',coordinates:c},properties:{iconCategory:cat,...props}});
const INCIDENTS=[P(1,[11.07,49.45],{events:[{description:'Unfall'}],from:'Erlangen-Tennenlohe',to:'Nürnberg-Nord',length:2300,delay:840,roadNumbers:['A3']}),P(3,[11.071,49.45]),
  P(8,[11.08,49.45],{roadNumbers:[]}),P(8,[11.081,49.45]),P(8,[11.082,49.45],{roadNumbers:['St2240']}),
  P(8,[11.09,49.45],{roadNumbers:['A73']}),P(9,[11.091,49.45],{roadNumbers:['B4']}),P(9,[11.092,49.45],{delay:420}),P(9,[11.093,49.45],{delay:60}),P(7,[11.094,49.45]),P(6,[11.1,49.45])];

test('Verkehrsmeldungen auf der Karte: Standard „Nur wichtige“, Filter ohne neue Anfrage',async({page})=>{
  let n=0;
  const errs=await setup(page,{ls:{tt:'TT',traffic:true},routes:[['**/incidentDetails**',r=>{n++;return json(r,{incidents:INCIDENTS})}]]});
  await page.evaluate(()=>map.setView([49.45,11.08],13));
  await until(page,()=>incLayer.getLayers().length>0);
  const count=()=>page.evaluate(()=>incLayer.getLayers().length);
  // Unfall, Gefahr, A73, B4, Baustelle mit 7 min Stau; keine Wohnstraßen-Sperrungen, kein Stau-Symbol
  expect(await count()).toBe(5);
  await page.evaluate(()=>incLayer.getLayers()[0].openPopup());
  await expect(page.locator('.leaflet-popup-content')).toContainText('Unfall · A3');
  await expect(page.locator('.leaflet-popup-content')).toContainText('Erlangen-Tennenlohe → Nürnberg-Nord');
  for(const [v,want] of [['all',10],['off',0],['imp',5]]){
    await page.evaluate(()=>openSettings());await page.selectOption('#incf',v);await page.click('#save');await settle(page,900);
    expect(await count()).toBe(want);
  }
  // kleines Verschieben innerhalb des geladenen Ausschnitts kostet nichts
  await page.evaluate(()=>map.panBy([40,30],{animate:false}));await settle(page,1200);
  expect(n).toBe(1);
  // herausgezoomt keine Abfrage (TomTom erlaubt höchstens 10.000 km²)
  await page.evaluate(()=>map.setView([50.5,11],8,{animate:false}));await settle(page,1200);
  expect(n).toBe(1);
  expect(await page.evaluate(()=>map.hasLayer(incLayer))).toBe(false);
  expect(errs).toEqual([]);
});

test('Verkehrsmeldungen: Fehler 403 einmal melden, nicht wiederholen',async({page})=>{
  let n=0;
  await setup(page,{ls:{tt:'TT',traffic:true},routes:[['**/incidentDetails**',r=>{n++;return json(r,{detailedError:{message:'Forbidden'}},403)}]]});
  await page.evaluate(()=>map.setView([49.45,11.08],12));
  await expect(page.locator('#qtxt')).toContainText('Unfälle und Baustellen nicht verfügbar (TomTom: HTTP 403: Forbidden)');
  await page.evaluate(()=>map.setView([50.5,11],12,{animate:false}));await settle(page,1200);
  expect(n).toBe(1);
});

test('TomTom-Kontingent: Monatszähler je API, Hinweis ab 80 %, Monatswechsel',async({page})=>{
  const mon=new Date().toISOString().slice(0,7);
  await setup(page,{ls:{tt:'TT',ttq:{mon,n:{route:15999},warn:{}}}});
  await page.click('nav [data-v=route]');await page.fill('#rd','Ziel');await page.click('#rgo');
  await expect(page.locator('#qtxt')).toContainText('TomTom Routen: diesen Monat schon 16.000 von 20.000');
  await page.evaluate(()=>openSettings());
  await expect(page.locator('#qset')).toContainText('Routen 16.000 / 20.000');
  await expect(page.locator('#qset')).toContainText('Suche 0 / 2.500');
  const old=await page.evaluate(()=>{Q.mon='2000-01';qCount('search');return JSON.stringify(Q.n)});
  expect(old).toBe('{"search":1}');
});

test('TomTom 429 meldet Limit oder zu viele Anfragen',async({page})=>{
  await setup(page,{ls:{tt:'TT'},routes:[['**/api.tomtom.com/routing/**',r=>json(r,{detailedError:{message:'Too Many Requests'}},429)]]});
  await page.click('nav [data-v=route]');await page.fill('#rd','Ziel');await page.click('#rgo');
  await expect(page.locator('#qtxt')).toContainText('zu viele Anfragen (HTTP 429)');
});

test('Popup: Fahrzeit vom Standort und Orte in der Nähe, 5 Minuten zwischengespeichert',async({page})=>{
  const n={route:0,near:0};
  const STN={id:'eni',name:'Eni',brand:'AGIP ENI',street:'Ohmstraße',houseNumber:'7',postCode:'91074',place:'Herzogenaurach',lat:49.565,lng:10.885,e5:2.079,e10:2.019,diesel:2.259,isOpen:true};
  const errs=await setup(page,{time:'2026-10-28T09:37:00+01:00',ls:{tt:'TT',pois:{sm:true,bk:true}},routes:[
    ['**/json/list.php*',r=>json(r,{ok:true,stations:[STN]})],
    ['**/api.tomtom.com/routing/**',r=>{n.route++;return json(r,{routes:[{summary:{lengthInMeters:7300,travelTimeInSeconds:720,trafficDelayInSeconds:240}}]})}],
    ['**/api.tomtom.com/search/2/nearbySearch/**',r=>{n.near++;return json(r,{results:[
      {poi:{name:'Penny',categorySet:[{id:7332005}],openingHours:{timeRanges:[{startTime:T('2026-10-28',7),endTime:T('2026-10-28',20)}]}},position:{lat:49.5655,lon:10.885},dist:50,address:{freeformAddress:'Ohmstr. 9, Herzogenaurach'}},
      {poi:{name:'Backstube',categorySet:[{id:9361018}],openingHours:{timeRanges:[{startTime:T('2026-10-28',12),endTime:T('2026-10-28',18)}]}},position:{lat:49.566,lon:10.885},dist:290,address:{}}]})}]]});
  await page.evaluate(()=>map.setView([49.565,10.885],13));await settle(page,2500);
  await page.click('.leaflet-marker-icon .pin');
  const ext=page.locator('.leaflet-popup .pext');
  await expect(ext).toContainText('7,3 km');
  await expect(ext).toContainText('12 min');
  await expect(ext).toContainText('+4 min');
  await expect(ext).toContainText('Penny 50 m, bis 20:00');
  await expect(ext).toContainText('Backstube 290 m, zu bei Ankunft');
  const href=decodeURIComponent(await ext.locator('a',{hasText:'Penny'}).getAttribute('href'));
  expect(href).toContain('destination=Penny, Ohmstr. 9, Herzogenaurach&waypoints=AGIP ENI, Ohmstraße 7, 91074 Herzogenaurach');
  await page.evaluate(()=>map.closePopup());await page.click('.leaflet-marker-icon .pin');await settle(page);
  expect(n).toEqual({route:1,near:1});
  expect(errs).toEqual([]);
});

test('Verkehrslage: Kachelfehler zeigt TomToms Begründung',async({page})=>{
  await setup(page,{ls:{tt:'TT',traffic:true},routes:[['**/api.tomtom.com/traffic/map/**',r=>r.fulfill({status:403,body:'Developer Inactive',headers:{'access-control-allow-origin':'*'}})]]});
  await page.evaluate(()=>map.setView([49.5,11],12));
  await expect(page.locator('#trf')).toHaveText('Verkehr ⚠');
  await page.click('#trf');
  await expect(page.locator('#askT')).toHaveText('Verkehrslage nicht verfügbar');
  await expect(page.locator('#ask')).toContainText('HTTP 403: Developer Inactive');
});
