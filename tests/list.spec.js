const {test,expect}=require('@playwright/test');
const {setup,settle}=require('./helpers');

const me=[49.58,10.95];
const st=(id,brand,name,street,dlat,e10)=>({id,brand,name,street,houseNumber:'1',lat:me[0]+dlat,lng:me[1],e10,e5:e10+0.06,isOpen:true});
const show=async(page,stations)=>{
  await page.evaluate(([s,me])=>{S.me=me;S.stations=s;list()},[stations,me]);
  return page.evaluate(()=>({sum:$('#sum').innerText,cards:[...$$('#items .card')].map(c=>c.querySelector('b').textContent+': '+(c.querySelector('.sv')?.textContent||''))}));
};

test.describe('Liste mit Umwegrechner',()=>{
  test.beforeEach(async({page})=>{
    await setup(page,{ls:{fuel:'e10',lit:40,cons:7,sort:'save'}});
    await page.click('nav [data-v=list]');
  });

  test('Autobahn-Tankstelle ist nie Vergleichswert',async({page})=>{
    const r=await show(page,[st('a','ARAL','Aral','Am Europakanal',0.042,1.949),st('b','ELO','ELO','Dambachstr.',0.024,2.039),
      st('c','ESSO','Esso','Erlanger Str.',0.014,2.049),st('x','SHELL','Shell Raststätte Aurach','A3',0.005,2.609)]);
    expect(r.sum).toContain('Vergleichstankstelle: ESSO');
    expect(r.sum).toContain('ohne Autobahn-Aufschlag');
    expect(r.cards).toContain('ESSO: Vergleichstankstelle (nächste ohne Autobahn-Aufschlag)');
    expect(r.cards.find(c=>c.startsWith('ARAL'))).toMatch(/^ARAL: 2,9\d € günstiger als die Vergleichstankstelle$/);
    expect(r.cards.find(c=>c.startsWith('SHELL'))).toContain('teurer als die Vergleichstankstelle');
  });

  test('unerkannte teure Tankstelle zählt als Ausreißer',async({page})=>{
    const r=await show(page,[st('a','ARAL','Aral','X',0.042,1.949),st('c','ESSO','Esso','Y',0.014,2.049),st('d','JET','JET','Z',0.02,2.0),
      st('x','TOTAL','TotalEnergies','Industriestr.',0.005,2.609)]);
    expect(r.sum).toContain('Vergleichstankstelle: ESSO');
  });

  test('Zusammenfassung mit Median',async({page})=>{
    const r=await show(page,[st('a','A','A','X',0.01,1.9),st('b','B','B','Y',0.02,1.95),st('c','C','C','Z',0.03,2.5)]);
    expect(r.sum).toMatch(/Median 1,950/);
    expect(r.sum).toContain('3 Tankstellen');
  });

  test('Filter blendet Marken aus',async({page})=>{
    await show(page,[st('a','ARAL','Aral','X',0.01,1.9),st('b','JET','JET','Y',0.02,1.95)]);
    await page.click('#flb');
    await page.locator('#brands input[value=JET]').uncheck();
    await page.click('#flt button[value=ok]');await settle(page);
    await expect(page.locator('#items .card b')).toHaveText(['ARAL']);
  });
});
