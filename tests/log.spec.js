const {test,expect}=require('@playwright/test');
const {setup,settle,json,A}=require('./helpers');

// Tankstelle direkt am Standort und eine weiter weg
const ST=[{id:'here',name:'Aral Tankstelle',brand:'ARAL',street:'Hauptstr.',houseNumber:'1',place:'Herzogenaurach',lat:A[0]+0.001,lng:A[1],e5:1.909,e10:1.859,diesel:1.759,isOpen:true},
  {id:'far',name:'JET',brand:'JET',street:'Ring',place:'Erlangen',lat:A[0]+0.01,lng:A[1],e5:1.999,e10:1.899,diesel:1.799,isOpen:true},
  {id:'f3',name:'Esso',brand:'ESSO',street:'Weg',place:'Erlangen',lat:A[0]+0.012,lng:A[1],e5:2.019,e10:1.939,diesel:1.839,isOpen:true}];

async function open(page,ls={}){
  const errs=await setup(page,{time:'2026-11-06T17:00:00+01:00',ls:{fuel:'e10',lit:40,cons:7,...ls},routes:[['**/json/list.php*',r=>json(r,{ok:true,stations:ST})]]});
  await page.click('#loc');await settle(page,2500);
  await page.click('nav [data-v=log]');
  return errs;
}

test('Neuer Tankvorgang: Tankstelle und Preis vorbelegt, Betrag berechnet',async({page})=>{
  const errs=await open(page);
  await expect(page.locator('#log .empty')).toContainText('Noch keine Tankvorgänge');
  await page.click('#lgAdd');
  expect(await page.inputValue('#lgSt')).toBe('ARAL Herzogenaurach, Hauptstr.');
  expect(await page.inputValue('#lgP')).toBe('1,859');
  expect(await page.inputValue('#lgDt')).toBe('2026-11-06T17:00');
  // ohne Mengenangabe nicht speichern
  await page.click('#logd button[value=ok]');
  await expect(page.locator('#lgInfo')).toHaveText('Bitte zwei von Liter, Preis und Betrag eintragen.');
  await page.fill('#lgL','40');await page.fill('#lgK','45200');
  await page.click('#logd button[value=ok]');await settle(page);
  const log=await page.evaluate(()=>LOG);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({name:'ARAL Herzogenaurach, Hauptstr.',sid:'here',fuel:'e10',l:40,p:1.859,eur:74.36,odo:45200,full:true});
  // Median der Umgebung beim Tanken (1,899) → 4 ct je Liter gespart
  expect(log[0].med).toBeCloseTo(1.899,3);
  await expect(page.locator('.lrow')).toHaveCount(1);
  await expect(page.locator('.lrow')).toContainText('06.11.26 · ARAL Herzogenaurach, Hauptstr.');
  await expect(page.locator('.lrow')).toContainText('E10: 40,00 l × 1,859 € = 74,36 €');
  await expect(page.locator('.lstat')).toContainText('gespart ggü. Median der Umgebung: 1,60 €');
  expect(errs).toEqual([]);
});

test('Verbrauch voll bis voll, Monate, Übernahme in den Umwegrechner, Bearbeiten und Löschen',async({page})=>{
  const t=d=>Date.parse('2026-11-06T12:00:00+01:00')-d*864e5;
  const log=[{id:'a',t:t(40),name:'A',fuel:'e10',l:30,p:1.9,eur:57,odo:44000,full:true},
    {id:'b',t:t(25),name:'B',fuel:'e10',l:20,p:1.8,eur:36,odo:0,full:false},
    {id:'c',t:t(20),name:'C',fuel:'e10',l:25,p:1.85,eur:46.25,odo:44600,full:true},
    {id:'d',t:t(2),name:'D',fuel:'e10',l:38,p:1.87,eur:71.06,odo:45100,full:true}];
  const errs=await open(page,{log});
  const st=page.locator('.lstat');
  // (20+25+38) l auf 1.100 km
  await expect(st).toContainText('Verbrauch: 7,5 l/100 km (2 Füllungen, 1.100 km)');
  await expect(st).toContainText('November 2026: 71,06 €');
  await expect(st).toContainText('Oktober 2026: 82,25 € (45,0 l)');
  await expect(st).toContainText('September 2026: 57,00 €');
  await page.click('#lgCons');
  expect(await page.evaluate(()=>S.cons)).toBe(7.5);
  await expect(page.locator('#lgCons')).toHaveCount(0);
  // neuester Eintrag zuerst; Antippen bearbeitet
  await page.locator('.lrow').first().click();
  await expect(page.locator('#lgT')).toHaveText('Tankvorgang bearbeiten');
  expect(await page.inputValue('#lgL')).toBe('38');
  await page.fill('#lgB','');await page.fill('#lgL','40');
  await page.click('#logd button[value=ok]');await settle(page);
  expect((await page.evaluate(()=>LOG.find(x=>x.id==='d'))).eur).toBe(74.8);
  await page.locator('.lrow').first().click();await page.click('#lgDel');await settle(page);
  expect(await page.evaluate(()=>LOG.map(x=>x.id))).toEqual(['a','b','c']);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('log')).length)).toBe(3);
  expect(errs).toEqual([]);
});

test('Fünf Reiter passen auf ein schmales Handy',async({page})=>{
  await setup(page);
  const w=await page.evaluate(()=>[...$$('nav button')].map(b=>b.scrollWidth<=b.clientWidth));
  expect(w).toEqual([true,true,true,true,true]);
});
