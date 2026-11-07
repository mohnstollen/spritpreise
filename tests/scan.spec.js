const {test,expect}=require('@playwright/test');
const {setup,settle,json}=require('./helpers');

// Nachgebildete ML-Kit-Ausgabe: je Spalte eine Zeile mit Position (x links, y Mitte, h Höhe).
// skew: schräg fotografiert, y verschiebt sich mit x
const lines=(rows,skew=0)=>rows.flatMap(([y,cols,h=28])=>cols.map(([x,t])=>({t,x,y:Math.round(y+x*skew),h})));

// Beleg 1: enilive Herzogenaurach (wie fotografiert, leicht schräg)
const ENILIVE=lines([
  [90,[[120,'enilive Tekdemir']],44],[160,[[210,'Isabel Tekdemir']]],[205,[[210,'Ohmstr. 7']]],[250,[[210,'91074 Herzogenaurach']]],
  [295,[[40,'Tankstellen-Nr.: 0000003619']]],[340,[[250,'Tel.: 09132/ 83 66 159']]],[385,[[250,'Fax.: 09132/73 73 11']]],
  [460,[[40,'USt-Id-Nr. Gesellschaft (#) DE129275205']]],[500,[[40,'Beleg-Nr. 8554/002/00002 16.10.26 10:22']]],
  [580,[[40,'*000014 Super E10'],[580,'76,04 EUR A#*']]],[625,[[40,'*Zp 03'],[230,'37,85 1'],[490,'2,009 EUR/1'],[790,'#*']]],
  [670,[[60,'Tankbeginn: 16.10.2026 10:19:22']]],[760,[[60,'---------- Promotion ----------']]],[810,[[60,'001110 6ct/L Sep-Okt\'26 A'],[800,'#']]],
  [930,[[195,'Gesamtbetrag']],48],[935,[[555,'76,04 EUR']],46],
  [1030,[[40,'Typ'],[310,'Netto'],[530,'Mwst'],[720,'Brutto']]],[1070,[[40,'A:19,00%'],[310,'63,90'],[520,'12,14'],[740,'76,04']]],
  [1190,[[160,'+KUNDENBELEG+']]],[1240,[[40,'Datum'],[600,'16.10.2026']]],[1290,[[40,'Uhrzeit'],[640,'10:22:12']]],
  [1520,[[40,'Betrag'],[590,'76,04 EUR']]],[1560,[[40,'Karte'],[460,'###########7191']]]
],0.012);
// Beleg 2: Rosi's Autohof Denkendorf, Literpreis eine Zeile tiefer gedruckt
const ROSIS=lines([
  [100,[[250,'Rosi`s']],56],[160,[[170,'Autohof Denkendorf']]],[210,[[170,'Bajuwarenstraße 2']]],[260,[[175,'85095 Denkendorf']]],
  [310,[[25,'Tankstellen-Nr.: 0000001623']]],[400,[[220,'Fax.:'],[360,'189079']]],
  [500,[[35,'Beleg-Nr. 1832/011/00001 25.05.26 17:30']]],[540,[[35,'Es bediente Sie : Larissa']]],[610,[[30,'Rechnung']]],
  [655,[[30,'*000014 Super 95 E10']]],[690,[[30,'*Zp 14'],[200,'37,85 1'],[550,'73,01 EUR#A*']]],[725,[[450,'1,929 EUR/1'],[700,'# *']]],
  [810,[[170,'Gesamtbetrag'],[545,'73,01 EUR']],48],[915,[[30,'A:19,00%'],[275,'61,35'],[465,'11,66'],[640,'73,01']]],
  [1340,[[30,'Betrag'],[530,'73,01 EUR']]],[1840,[[30,'# Tank & Rast'],[600,'278647238']]]
]);

test('Belege lesen: enilive und Rosi\'s',async({page})=>{
  await setup(page);
  const r1=await page.evaluate(l=>parseReceipt(ocrRows(l)),ENILIVE);
  expect(r1).toMatchObject({l:37.85,p:2.009,eur:76.04,fuel:'e10',plz:'91074',town:'Herzogenaurach',street:'Ohmstr.',no:'7',head:'enilive Tekdemir'});
  expect(await page.evaluate(t=>new Date(t).toString().slice(4,21),r1.t)).toBe('Oct 16 2026 10:22');
  const r2=await page.evaluate(l=>parseReceipt(ocrRows(l)),ROSIS);
  expect(r2).toMatchObject({l:37.85,p:1.929,eur:73.01,fuel:'e10',plz:'85095',town:'Denkendorf',street:'Bajuwarenstraße',head:'Rosi`s'});
  expect(await page.evaluate(t=>new Date(t).toString().slice(4,21),r2.t)).toBe('May 25 2026 17:30');
});

test('Scan im Logbuch: Felder füllen, Tankstelle zuordnen, markieren, Hinweise',async({page})=>{
  const favs={eni:{id:'eni',name:'Eni',brand:'AGIP ENI',street:'Ohmstraße',houseNumber:'7',postCode:'91074',place:'Herzogenaurach',lat:49.565,lng:10.885,g:'default'}};
  const errs=await setup(page,{time:'2026-11-07T12:00:00+01:00',android:{status:{}},ls:{fuel:'e5',favs,order:['eni']}});
  await page.evaluate(()=>{window.scans=0;Android.scanReceipt=()=>scans++});
  await page.click('nav [data-v=log]');await page.click('#lgAdd');
  await expect(page.locator('#lgScan')).toBeVisible();
  await page.click('#lgScan');
  await expect(page.locator('#lgScan')).toHaveText('Scanne …');
  expect(await page.evaluate(()=>scans)).toBe(1);
  await page.evaluate(l=>scanResult(JSON.stringify(l),''),ENILIVE);
  await expect(page.locator('#lgScan')).toHaveText('📷 Beleg scannen');
  // Beleg passt zum Favoriten AGIP ENI (Ohmstr. 7 = Ohmstraße 7)
  expect(await page.inputValue('#lgSt')).toBe('AGIP ENI Herzogenaurach, Ohmstraße');
  expect(await page.inputValue('#lgDt')).toBe('2026-10-16T10:22');
  expect(await page.inputValue('#lgF')).toBe('e10');
  expect([await page.inputValue('#lgL'),await page.inputValue('#lgP'),await page.inputValue('#lgB')]).toEqual(['37,85','2,009','76,04']);
  await expect(page.locator('#lgInfo')).toHaveText('Erkannt: Tankstelle, Datum, Sorte, Liter, Preis, Betrag. Bitte prüfen und speichern.');
  expect(await page.locator('#logd .scan').count()).toBe(6);
  // von Hand korrigiert: Markierung weg
  await page.fill('#lgK','45210');await page.fill('#lgL','37,86');
  expect(await page.locator('#logd .scan').count()).toBe(5);
  await page.fill('#lgL','37,85');
  await page.click('#logd button[value=ok]');await settle(page);
  const e=await page.evaluate(()=>LOG[0]);
  expect(e).toMatchObject({sid:'eni',fuel:'e10',l:37.85,p:2.009,eur:76.04,odo:45210});
  // unbekannte Tankstelle: Name und Ort vom Beleg
  await page.click('#lgAdd');await page.click('#lgScan');
  await page.evaluate(l=>scanResult(JSON.stringify(l),''),ROSIS);
  expect(await page.inputValue('#lgSt')).toBe('Rosi`s, Denkendorf');
  expect(await page.inputValue('#lgB')).toBe('73,01');
  // Zahlen passen nicht zusammen
  await page.evaluate(()=>{scanResult(JSON.stringify([{t:'Super E10',x:0,y:10,h:20},{t:'40,00 l  2,000 EUR/l',x:0,y:50,h:20},{t:'Gesamtbetrag 90,00 EUR',x:0,y:90,h:20}]),'')});
  await expect(page.locator('#lgInfo')).toHaveText('Liter × Preis (80,00 €) passt nicht zum Betrag (90,00 €). Bitte prüfen.');
  // kein Beleg, Fehler, Abbruch
  await page.evaluate(()=>scanResult(JSON.stringify([{t:'Hallo Welt',x:0,y:0,h:20}]),''));
  await expect(page.locator('#lgInfo')).toContainText('kein Tankbeleg erkannt');
  await page.evaluate(()=>scanResult(null,'Waiting for the text recognition model to be downloaded'));
  await expect(page.locator('#lgInfo')).toHaveText('Die Texterkennung wird noch eingerichtet. Bitte in einer Minute erneut versuchen.');
  await page.click('#lgScan');await page.evaluate(()=>scanResult(null,''));
  await expect(page.locator('#lgScan')).toHaveText('📷 Beleg scannen');
  expect(errs).toEqual([]);
});

test('Ohne App kein Scan-Knopf',async({page})=>{
  await setup(page);
  await page.click('nav [data-v=log]');await page.click('#lgAdd');
  await expect(page.locator('#lgScan')).toBeHidden();
});
