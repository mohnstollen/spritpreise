const {test,expect}=require('@playwright/test');
const {setup,settle,json}=require('./helpers');

const NOW='2026-11-05T17:00:00+01:00';
const favs={a:{id:'a',name:'Nah',brand:'ARAL',place:'Herzogenaurach',lat:49.57,lng:10.88,g:'default'},b:{id:'b',name:'Fern',brand:'Shell',place:'Erlangen',lat:49.59,lng:11.0,g:'g1'}};
const groups=[{id:'default',name:'Allgemein'},{id:'g1',name:'Arbeit'}];
// Preisverlauf für a: 6 vollständige Tage, abends 19–21 Uhr 8 ct billiger
function hist(){
  const h=[],d0=new Date(NOW);d0.setHours(0,0,0,0);
  for(let d=6;d>=1;d--){const t=d0.getTime()-d*864e5;h.push([t+5*36e5,1.99,1.93,1.79],[t+12*36e5,2.03,1.97,1.83],[t+19*36e5,1.95,1.89,1.75],[t+21*36e5+6e5,2.01,1.95,1.81])}
  return h;
}
const ok={run:Date.parse(NOW)-20*6e4,err:'',n:2,planned:30,notify:true,battery:true,widgets:1,maker:'Google'};
async function app(page,status=ok,ls={}){
  return setup(page,{time:NOW,android:{status},ls:{fuel:'e10',favs,order:['a','b'],groups,hist:{a:hist()},...ls},routes:[
    ['**/json/prices.php*',r=>json(r,{ok:true,prices:{a:{status:'open',e5:2.0,e10:1.94,diesel:1.8},b:{status:'open',e5:1.9,e10:1.85}}})],
    ['**/json/list.php*',r=>json(r,{ok:true,stations:[{id:'x9',name:'Billig',brand:'JET',lat:49.6,lng:10.95,e5:1.8,e10:1.75,diesel:1.7,isOpen:true}]})]]});
}
const last=page=>page.evaluate(()=>syncs[syncs.length-1]);
const status=page=>page.evaluate(()=>[...$$('#bgstat > div')].map(d=>d.innerText.replace(/\n/g,' ')));

test('Abgleich mit Widget und Preisalarm',async({page})=>{
  const errs=await app(page);
  let c=await last(page);
  expect(c).toMatchObject({key:'KEY',fuel:'e10',interval:30,widget:['a','b'],names:{a:{n:'ARAL',p:'Herzogenaurach'}}});
  await page.click('nav [data-v=favs]');await settle(page,600);
  await page.click('[data-alarm="a"]');await settle(page,150);
  await page.fill('#askI','1,899');await page.press('#askI','Enter');await settle(page,200);
  c=await last(page);
  expect(c.alarms).toEqual({a:{fuel:'e10',below:1.899}});
  expect(await page.evaluate(()=>notifyReq)).toBe(1);
  await page.evaluate(()=>openSettings());await page.selectOption('#wgrp','g1');await page.selectOption('#bgint','60');await page.click('#save');await settle(page,300);
  c=await last(page);
  expect(c.widget).toEqual(['b']);expect(c.interval).toBe(60);
  expect(errs).toEqual([]);
});

test('Hintergrund-Status: alles in Ordnung',async({page})=>{
  await app(page);
  await page.evaluate(()=>openSettings());
  const s=await status(page);
  expect(s[0]).toBe('Letzte Abfrage: 16:40 Uhr ✓ 2 Tankstellen');
  expect(s[1]).toBe('Geplant: alle 30 min');
  expect(s[2]).toBe('Benachrichtigungen: erlaubt');
  expect(s[3]).toBe('Akku: keine Einschränkung');
  expect(s.join()).not.toContain('Autostart');
});

test('Hintergrund-Status: Probleme mit Knöpfen zu den Systemeinstellungen',async({page})=>{
  await app(page,{run:Date.parse(NOW)-5*36e5,err:'UnknownHostException: Unable to resolve host',planned:30,notify:false,battery:false,maker:'Xiaomi',area:'JET 1.749'});
  await page.evaluate(()=>openSettings());
  const s=await status(page);
  expect(s[0]).toBe('Letzte Abfrage: 12:00 Uhr – keine Verbindung – verzögert');
  expect(s.join('|')).toContain('Benachrichtigungen: blockiert Erlauben');
  expect(s.join('|')).toContain('Autostart: bei Xiaomi nötig Prüfen');
  expect(s.join('|')).toContain('Umkreis zuletzt: JET 1,749 €');
  await page.click('[data-sys=notify]');await page.click('[data-sys=battery]');await page.click('[data-sys=autostart]');
  expect(await page.evaluate(()=>sys)).toEqual(['notify','battery','autostart']);
  await page.click('#bgnow');
  expect(await page.evaluate(()=>refreshes)).toBe(1);
  await page.evaluate(()=>{ST={...ST,run:Date.now(),err:'',n:2}});await settle(page,8500);
  expect((await status(page))[0]).toContain('✓ 2 Tankstellen');
});

test('Hintergrund-Status: Planungsfehler',async({page})=>{
  await app(page,{planned:0,planErr:'Error: requested job be persisted without permission',notify:true,battery:true,maker:'Google'});
  await page.evaluate(()=>openSettings());
  const s=await status(page);
  expect(s[0]).toBe('Letzte Abfrage: noch keine');
  expect(s[1]).toBe('Geplant: nein – Error: requested job be persisted without permission');
});

test('Umkreis-Alarm: nur mit Grenze, Mittelpunkt, Abgleich',async({page})=>{
  await app(page);
  await page.evaluate(()=>openSettings());
  await page.check('#aon');await page.click('#save');await settle(page,200);
  expect(await page.evaluate(()=>$('#dlg').open)).toBe(true);
  await page.fill('#abelow','abc');await page.click('#save');await settle(page,200);
  expect(await page.evaluate(()=>$('#dlg').open)).toBe(true);
  await page.fill('#abelow','1,799');await page.selectOption('#arad','15');await page.selectOption('#afuel','diesel');
  await page.click('#ame');
  await expect(page.locator('#actr')).toContainText('dein Standort');
  await page.click('#save');await settle(page,300);
  const a=(await last(page)).area;
  expect(a).toMatchObject({on:true,wid:false,fuel:'diesel',below:1.799,rad:15,lat:49.57,lng:10.88,src:'me'});
  expect(await page.evaluate(()=>notifyReq)).toBe(1);
  await settle(page,600);
  expect(await page.evaluate(()=>refreshes)).toBe(1);
  await page.evaluate(()=>openSettings());
  expect([await page.isChecked('#aon'),await page.inputValue('#abelow'),await page.inputValue('#arad')]).toEqual([true,'1,799','15']);
});

test('Günstigste im Umkreis im Widget: ohne Alarm und ohne Grenze',async({page})=>{
  await app(page);
  await page.evaluate(()=>openSettings());
  await page.check('#awid');await page.click('#save');await settle(page,300);await settle(page,800);
  const a=(await last(page)).area;
  // Mittelpunkt automatisch vom Standort, Alarm bleibt aus
  expect(a).toMatchObject({on:false,wid:true,fuel:'e10',lat:49.57,lng:10.88,src:'me'});
  expect(await page.evaluate(()=>notifyReq)).toBe(0);
  expect(await page.evaluate(()=>refreshes)).toBe(1);
});

test('Beste Tankzeit aus dem Preisverlauf',async({page})=>{
  await app(page);
  await page.click('nav [data-v=favs]');await settle(page,600);
  await expect(page.locator('#favs .card',{hasText:'ARAL'}).locator('.bt')).toHaveText('Meist am günstigsten 20–22 Uhr, ca. 8 ct unter dem Tageshoch (aus 6 Tagen)');
  // ohne genug Daten keine Angabe
  await expect(page.locator('#favs .card',{hasText:'Shell'}).locator('.bt')).toHaveCount(0);
});

test('Aus Widget oder Benachrichtigung öffnen',async({page})=>{
  const errs=await app(page);
  await page.evaluate(()=>appOpen('b'));await settle(page,400);
  expect(await page.evaluate(()=>S.view)).toBe('favs');
  await expect(page.locator('#favs .card.hl b')).toHaveText('Shell');
  await page.evaluate(()=>appOpen('x9',49.6,10.95));await settle(page,1500);
  expect(await page.evaluate(()=>S.view)).toBe('map');
  await expect(page.locator('.leaflet-popup b').first()).toHaveText('JET');
  expect(errs).toEqual([]);
});
