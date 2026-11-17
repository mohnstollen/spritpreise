const {test,expect}=require('@playwright/test');
const {setup,settle,until,json,A,lerp,routePoints}=require('./helpers');

// Strecke 115 km; Tankstellen bei ca. km 1, 50 und 98 (Beispiel: früh 1,809, spät 1,839)
const at=f=>{const q=lerp(f);return{lat:q[0],lng:q[1]+0.001}};
const ST=[{id:'early',brand:'ARAL',name:'Aral',...at(0.01),e10:1.809,isOpen:true},{id:'mid',brand:'ESSO',name:'Esso',...at(0.43),e10:1.859,isOpen:true},
  {id:'late',brand:'JET',name:'Jet',...at(0.85),e10:1.839,isOpen:true}];

async function routeWith(page,ls){
  const errs=await setup(page,{time:'2026-11-17T09:00:00+01:00',ls:{tt:'TT',fuel:'e10',lit:40,cons:7,...ls},routes:[
    ['**/json/list.php*',r=>json(r,{ok:true,stations:ST})],
    ['**/api.tomtom.com/routing/**',r=>r.request().url().includes('/batch/')?json(r,{},403):json(r,{routes:[{summary:{lengthInMeters:115000,travelTimeInSeconds:4300},legs:[{points:routePoints()}]}]})]]});
  await page.click('nav [data-v=route]');await page.fill('#rd','Ziel');await page.fill('#rr','100');await page.selectOption('#rc','1');
  await page.click('#rgo');await until(page,()=>!!$('#rsum .sum'));
  return errs;
}

test('Tank-Tipp: früh günstiger tanken statt fast leer (Beispiel 1,809 vs. 1,839)',async({page})=>{
  const errs=await routeWith(page,{tank:50});
  const tip=page.locator('#rsum .tip');
  await expect(tip).toContainText('Früh tanken bei km 1 (ARAL, 1,809 €, ca. 43 l)');
  await expect(tip).toContainText('fast leer bei km 98 (JET, 1,839 €, ca. 50 l)');
  // 43 l × 3 ct, Rest wird zum Median der Strecke (1,839) nachgetankt
  expect(await tip.innerText()).toMatch(/ca\. 1,29 € günstiger/);
  expect(errs).toEqual([]);
});

test('Tank-Tipp: Weiterfahren, wenn es später deutlich günstiger ist',async({page})=>{
  ST[2].e10=1.759;
  await routeWith(page,{tank:50});
  await expect(page.locator('#rsum .tip')).toContainText('Weiterfahren lohnt: bei km 98 (JET, 1,759 €');
  ST[2].e10=1.839;
});

test('Tank-Tipp: ohne Tankgröße ein Hinweis',async({page})=>{
  await routeWith(page,{});
  await expect(page.locator('#rsum')).toContainText('Mit Tankgröße und Verbrauch unter ⚙');
});

test('Reichweite auf der Karte: TomTom-Fläche, Tankstellen außerhalb ausgegraut',async({page})=>{
  let url='';
  const d=0.05,box=[[A[0]-d,A[1]-d],[A[0]-d,A[1]+d],[A[0]+d,A[1]+d],[A[0]+d,A[1]-d]];
  const errs=await setup(page,{ls:{tt:'TT'},routes:[
    ['**/json/list.php*',r=>json(r,{ok:true,stations:[{id:'in',brand:'IN',name:'In',lat:A[0]+0.01,lng:A[1],e5:1.9,isOpen:true},{id:'out',brand:'OUT',name:'Out',lat:A[0]+0.2,lng:A[1],e5:1.8,isOpen:true}]})],
    ['**/calculateReachableRange/**',r=>{url=r.request().url();return json(r,{reachableRange:{boundary:box.map(([la,lo])=>({latitude:la,longitude:lo}))}})}]]});
  await page.click('#loc');await settle(page,800);
  await page.evaluate(()=>{map.setView([49.6,10.9],11)});await settle(page,2500);
  await page.click('#rng');await page.fill('#askI','80');await page.press('#askI','Enter');await settle(page,800);
  expect(url).toContain('distanceBudgetInMeters=80000');
  await expect(page.locator('#rng')).toHaveText('Reichweite 80 km');
  const cls=await page.evaluate(()=>marks.map(o=>o.id+':'+o.m.getElement().firstElementChild.className));
  expect(cls).toContain('in:pin r');
  expect(cls.find(c=>c.startsWith('out:'))).toContain('out');
  // erneut tippen blendet aus
  await page.click('#rng');await settle(page);
  await expect(page.locator('#rng')).toHaveText('Reichweite');
  expect(await page.evaluate(()=>marks.some(o=>o.m.getElement().firstElementChild.classList.contains('out')))).toBe(false);
  expect(errs).toEqual([]);
});

test('Reichweite ohne TomTom-Key: Kreis als Schätzung',async({page})=>{
  await setup(page,{});
  await page.click('#rng');await page.fill('#askI','65');await page.press('#askI','Enter');await settle(page,500);
  await expect(page.locator('#msg')).toContainText('Erreichbar mit 65 km Reichweite, geschätzt als Luftlinie');
  expect(await page.evaluate(()=>rngPoly.length)).toBe(48);
});
