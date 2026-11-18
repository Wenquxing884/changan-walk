import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('screenshots/door-flash', {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11']});
const report={errors:[],views:[]};
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto('http://127.0.0.1:5175/?test=1');
 await page.waitForFunction(()=>window.__CHANGAN__?.snapshot().ready);
 await page.waitForTimeout(500);
 const doorId=await page.evaluate(()=>{
  const app=window.__CHANGAN__;app.setAnimationEnabled(false);
  document.querySelectorAll('#performance,.toast,.landmarks,.crosshair').forEach(e=>e.style.visibility='hidden');
  const door=app.doors.find(d=>d.kind==='shop');
  app.setPlayerPosition(door.position.x+door.normal.x*2.2,door.position.z+door.normal.z*2.2);
  app.facePlayer(door.position.x-door.normal.x*4,door.position.z-door.normal.z*4);
  return door.id;
 });
 for(const degrees of [0,45,88,90,91.8]){
   await page.evaluate(({doorId,degrees})=>{
    const app=window.__CHANGAN__,d=app.doors.find(d=>d.id===doorId);
    if(d.open) app.interactDoor(d.id);
    else app.interactDoor(d.id);
    d.open=degrees>0;d.angle=d.targetAngle=degrees*Math.PI/180;
   },{doorId,degrees});
   await page.waitForTimeout(150);
   await page.screenshot({path:`screenshots/door-flash/current-${degrees}.png`});
   const first=await page.locator('#world').screenshot();
   await page.waitForTimeout(250);
   const second=await page.locator('#world').screenshot();
   const difference=await page.evaluate(async([aa,bb])=>{
    const load=async a=>{const im=new Image();im.src='data:image/png;base64,'+a;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data};
    const [a,b]=await Promise.all([load(aa),load(bb)]);let changed=0,max=0;for(let i=0;i<a.length;i+=4){const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));if(d>2)changed++;max=Math.max(max,d)}return {changed,max};
   },[first.toString('base64'),second.toString('base64')]);
   report.views.push({degrees,difference});
 }
 report.clearance=await page.evaluate(doorId=>{
  const app=window.__CHANGAN__,door=app.doors.find(d=>d.id===doorId),leaves=app.scene.getObjectByName('双扇木门 · hinged leaves'),braces=app.scene.getObjectByName('门扉横枨');
  const inv=door.transform.clone().invert(),matrix=door.transform.clone();
  // Work with actual instanced geometry. A closed wall begins at +/-width/2.
  const bounds=[];
  for(const [mesh,count,stride] of [[leaves,2,1],[braces,6,3]]){
   for(let j=0;j<count;j++){
    const i=door.index*(2*stride)+j;mesh.getMatrixAt(i,matrix);matrix.premultiply(inv);mesh.geometry.computeBoundingBox();
    const box=mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
    bounds.push({mesh:mesh.name,instance:j,minX:box.min.x,maxX:box.max.x,doorHalf:door.width/2});
   }
  }
  return bounds;
 },doorId);
 await writeFile('reports/door-flash-current.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close()}
