// Browser-Tests der PWA: Alle externen Dienste (Tankerkönig, TomTom, Kacheln, Leaflet-CDN) werden
// in tests/helpers.js nachgebildet, die Tests brauchen also kein Netz und keine API-Keys.
const {defineConfig}=require('@playwright/test');

module.exports=defineConfig({
  testDir:'tests',
  timeout:60000,
  fullyParallel:true,
  forbidOnly:!!process.env.CI,
  retries:process.env.CI?1:0,
  reporter:process.env.CI?[['list'],['html',{open:'never'}]]:'list',
  use:{
    baseURL:'http://localhost:8767',
    viewport:{width:360,height:900},
    locale:'de-DE',
    timezoneId:'Europe/Berlin',
    // Der Service Worker würde Anfragen an den Nachbildungen vorbei aus dem Cache bedienen
    serviceWorkers:'block'
  },
  webServer:{command:'node tests/server.js',port:8767,reuseExistingServer:!process.env.CI}
});
