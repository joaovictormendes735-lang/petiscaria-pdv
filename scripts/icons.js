import { chromium } from 'playwright';
import { readFile,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const path=process.env.BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(path?{executablePath:path}:{})});
try{
  const page=await browser.newPage();
  const source=await readFile('public/favicon.svg','utf8');
  for(const size of [192,512]){
    const data=await page.evaluate(async({source,size})=>{const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(source);await img.decode();const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const c=canvas.getContext('2d');c.fillStyle='#16754b';c.fillRect(0,0,size,size);c.drawImage(img,size*.15,size*.15,size*.7,size*.7);return canvas.toDataURL('image/png').split(',')[1];},{source,size});
    await writeFile('public/icon'+size+'.png',Buffer.from(data,'base64'));
  }
}finally{await browser.close();}
