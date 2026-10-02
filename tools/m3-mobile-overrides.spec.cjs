'use strict';const {test,expect}=require('@playwright/test'),fs=require('fs'),path=require('path');const root=path.resolve(process.env.BXH_M31_ROOT||process.cwd());
for(const v of [{name:'desktop',w:1280,h:800},{name:'iphone',w:390,h:844},{name:'android',w:412,h:915}]){
 test('M3 mobile override '+v.name,async({page})=>{const rs=[];page.on('response',r=>rs.push(r));await page.setViewportSize({width:v.w,height:v.h});const r=await page.goto('/tools/m3-mobile-overrides-fixture.html');expect(r.status()).toBe(200);const cr=rs.find(x=>new URL(x.url()).pathname==='/modules/mobile-overrides/styles.css');expect(cr).toBeTruthy();expect(await cr.body()).toEqual(fs.readFileSync(path.join(root,'modules/mobile-overrides/styles.css')));
 const row=page.locator('.people-roster-table tr'),source=page.locator('.people-col-source');
 if(v.w<=760){expect(await row.evaluate(e=>getComputedStyle(e).display)).toBe('grid');expect(await row.evaluate(e=>getComputedStyle(e).gridTemplateColumns)).not.toBe('none');expect(await source.evaluate(e=>getComputedStyle(e).display)).toBe('none');}
 else {expect(await row.evaluate(e=>getComputedStyle(e).display)).not.toBe('grid');}
 });}