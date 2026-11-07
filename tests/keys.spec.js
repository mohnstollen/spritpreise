const {test,expect}=require('@playwright/test');
const {setup,settle,json}=require('./helpers');

const KEY='485d7d5a-0d2d-4bcd-8bcd-0123456789ab';
const keyOf=url=>new URL(url).searchParams.get('apikey');

test('Keys: unsichtbare Zeichen und Leerzeichen werden entfernt, auch bei gespeicherten Keys',async({page})=>{
  const seen=[];
  // gespeicherter Key aus einer älteren Version mit geschütztem Leerzeichen und unsichtbarem Zeichen
  await setup(page,{ls:{key:' '+KEY.slice(0,8)+'​'+KEY.slice(8)+' ',tt:' TT​'},routes:[['**/json/list.php*',r=>{seen.push(keyOf(r.request().url()));return json(r,{ok:true,stations:[]})}]]});
  expect(await page.evaluate(()=>[S.key,S.tt,localStorage.getItem('key')])).toEqual([KEY,'TT',JSON.stringify(KEY)]);
  await page.evaluate(()=>map.setView([49.6,10.9],13));await settle(page,2000);
  expect(seen.at(-1)).toBe(KEY);
  // neu eingefügt mit Leerzeichen und Anführungszeichen
  await page.evaluate(()=>openSettings());
  await page.fill('#key',` „${KEY}“ `);
  await expect(page.locator('#keyst')).toHaveText('Leer- oder Sonderzeichen werden beim Speichern entfernt');
  await page.fill('#tt',' TT 2 ');
  await page.click('#save');await settle(page);
  expect(await page.evaluate(()=>[S.key,S.tt])).toEqual([KEY,'TT2']);
});

test('Tankerkönig-Key testen: Format und Antwort des Servers',async({page})=>{
  let ok=true;
  await setup(page,{ls:{key:KEY},routes:[['**/json/list.php*',r=>json(r,ok?{ok:true,stations:[]}:{ok:false,message:'apikey nicht angegeben, falsch, oder im falschen Format'})]]});
  await page.evaluate(()=>openSettings());
  await expect(page.locator('#keyst')).toHaveText('');
  await page.fill('#key','485d7d5a-0d2d-a3cd-bb');
  await page.click('#keytest');
  await expect(page.locator('#keyst')).toHaveText('Format stimmt nicht (21 statt 36 Zeichen, nur 0–9, a–f und Bindestriche)');
  await page.fill('#key',KEY);await page.click('#keytest');
  await expect(page.locator('#keyst')).toHaveText('✓ Tankerkönig nimmt den Key an');
  ok=false;await page.click('#keytest');
  await expect(page.locator('#keyst')).toContainText('Tankerkönig: apikey nicht angegeben, falsch, oder im falschen Format.');
});

test('Abgelehnter Key: verständlicher Hinweis auf der Karte',async({page})=>{
  await setup(page,{ls:{key:KEY},routes:[['**/json/list.php*',r=>json(r,{ok:false,message:'apikey nicht angegeben, falsch, oder im falschen Format'})]]});
  await page.evaluate(()=>map.setView([49.6,10.9],13));await settle(page,2000);
  await expect(page.locator('#msg')).toContainText('Tankerkönig lehnt den API-Key ab: unter ⚙ „Tankerkönig-Key testen“');
});
