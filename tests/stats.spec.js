const {test,expect}=require('@playwright/test');
const {setup,settle,json}=require('./helpers');

const NOW='2026-11-17T18:00:00+01:00';
const favs={a:{id:'a',name:'Aral',brand:'ARAL',place:'Herzogenaurach',lat:49.57,lng:10.88,g:'default'},b:{id:'b',name:'Neu',brand:'JET',place:'Erlangen',lat:49.59,lng:11,g:'default'}};
// 14 Tage E10: morgens 1,95, ab 12 Uhr 1,99, abends 19–21 Uhr 1,89; sonntags 3 ct teurer
function hist(){
  const h=[],d0=new Date(NOW);d0.setHours(0,0,0,0);
  for(let d=14;d>=1;d--){const t=d0.getTime()-d*864e5,so=new Date(t).getDay()===0?0.03:0;
    h.push([t+5*36e5,2.01+so,1.95+so,1.81],[t+12*36e5,2.05+so,1.99+so,1.85],[t+19*36e5,1.95+so,1.89+so,1.75],[t+21*36e5,2.01+so,1.95+so,1.81])}
  return h;
}

test('30-Tage-Statistik eines Favoriten',async({page})=>{
  const errs=await setup(page,{time:NOW,ls:{fuel:'e10',favs,order:['a','b'],hist:{a:hist(),b:[[Date.parse(NOW)-36e5,1.9,1.85,1.7]]}},routes:[
    ['**/json/prices.php*',r=>json(r,{ok:true,prices:{a:{status:'open',e5:2.01,e10:1.95,diesel:1.81},b:{status:'open',e5:1.9,e10:1.85}}})]]});
  await page.click('nav [data-v=favs]');await settle(page,600);
  await page.locator('#favs .card',{hasText:'ARAL'}).locator('[data-stat]').click();
  const d=page.locator('#statd');
  await expect(d.locator('#stT')).toHaveText('ARAL Herzogenaurach · E10');
  await expect(d).toContainText('Seit');
  const kv=await d.locator('.kv').innerText();
  expect(kv).toMatch(/Tiefstpreis\s+1,890 € · Di/);
  expect(kv).toMatch(/Höchstpreis\s+2,020 € · So/);
  expect(kv).toMatch(/Aktuell\s+1,950 €/);
  // Sonntag ist am teuersten und rot markiert
  const so=d.locator('.bars').first();
  await expect(so).toContainText('So');
  expect(await so.locator('.bar.hi').count()).toBe(1);
  // Tagesverlauf: 20 Uhr am günstigsten (−10 ct zum Tageshoch)
  await expect(d.locator('.bars').nth(1)).toContainText('20 Uhr');
  const rows=await d.locator('.bars').nth(1).innerText();
  expect(rows).toMatch(/20 Uhr\s+−10 ct/);
  await d.locator('button[value=ok]').click();
  // zu wenig Daten
  await page.locator('#favs .card',{hasText:'JET'}).locator('[data-stat]').click().catch(()=>{});
  expect(errs).toEqual([]);
});

test('Datensicherung nennt das Logbuch',async({page})=>{
  await setup(page);
  await page.evaluate(()=>openSettings());
  await expect(page.locator('#dlg')).toContainText('Tank-Logbuch, gemerkte Routen und Einstellungen');
});
