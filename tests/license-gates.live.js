// Live Electron DOM, actual plugin source and real disposable signatures; no real settings are changed.
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const {generateKeyPairSync, sign, createHash} = require('crypto');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-license-gates-'));
  const pair=generateKeyPairSync('ed25519');
  const pem=pair.publicKey.export({type:'spki',format:'pem'}).toString().trim();
  const installed=path.join(app.vault.adapter.getBasePath(),app.vault.configDir,'plugins','crisp-visual','main.js');
  const original=fs.readFileSync(installed,'utf8');
  const source=original.replace(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/,pem);
  const module={exports:{}};
  const obsidian=require('obsidian');
  new Function('require','module','exports',source+'\nmodule.exports.fixtureManager=visualLicenseManagerFor;')(name=>name==='obsidian'?{...obsidian,requestUrl:async()=>({status:200,json:{valid:true}})}:require(name),module,module.exports);
  const Plugin=module.exports;
  const fakeApp={appId:'LOCAL-LIVE-TEST',workspace:{getLeavesOfType:()=>[],activeLeaf:{view:{editor:{replaceSelection(){editorWrites++;}}}}}};
  const plugin={app:fakeApp,settings:{mediaRoot:root,insertFormat:'standard_markdown'},saveSettings:async()=>{}};
  const manager=Plugin.fixtureManager(plugin);
  let editorWrites=0,scans=0;
  const view=Object.create(Plugin.classes.CrispVisualView.prototype);
  const container=document.createElement('div');container.append(document.createElement('div'),document.createElement('div'));
  Object.assign(view,{plugin,items:[],searchQuery:'',selectedColor:'all',selectedFormat:'all',selectedRatio:'all',selectedStar:'all',selectedFolderId:'all',selectedTag:null,densityMode:'standard',expandedFolders:new Set(),containerEl:container,galleryContainer:document.createElement('div')});
  Object.defineProperty(view,'app',{value:fakeApp});
  const scanner=new Plugin.classes.MediaScanner(plugin);view.scanner=scanner;
  view.watcher={start(){},stop(){}};
  const results=[];
  async function check(name,fn){try{if(!await fn())throw new Error('assertion failed');results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
  const item={id:'ONE',name:'Sample',ext:'png',filePath:path.join(root,'sample.png'),tags:[],folders:[],foldersNamed:[],mtime:1,star:0,width:1,height:1,size:68,eagleUri:'eagle://item/ONE'};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=','base64');
  await check('unactivated opening renders activation only without scanning',async()=>{
    const originalScan=scanner.scan;scanner.scan=async()=>{scans++;return [item];};
    try{await view.onOpen();return scans===0&&!!container.querySelector('.crisp-visual-locked')&&!container.querySelector('.crisp-visual-card');}finally{scanner.scan=originalScan;}
  });
  await check('unactivated direct scanner and cached filters expose zero assets',async()=>{
    view.items=Array.from({length:25},(_,i)=>({...item,id:String(i),name:`asset-${i}`}));view.applyFilters();
    return (await scanner.scan()).length===0&&view.filteredItems.length===0;
  });
  await check('unactivated import and insertion perform zero writes',async()=>{
    try{await scanner.ingestBuffer(png,'blocked');}catch{}
    view.insertToActiveNote(item);return editorWrites===0&&fs.readdirSync(root).length===0&&!view.generateInsertSyntax(item);
  });
  await check('cached render and inspector cannot expose locked assets',()=>{
    view.renderMasonry();view.openInspector({...item,ocrText:'PRIVATE_PROBE'});
    return !container.querySelector('.crisp-visual-card')&&!document.querySelector('.crisp-visual-inspector-overlay');
  });
  await check('display and method replacements cannot unlock',async()=>{
    manager.status={valid:true,payload:{}};manager.isEntitled=()=>true;
    plugin.licenseVerifier=async()=>({valid:true});await manager.verify('invalid');
    view.items=[item];view.applyFilters();return view.filteredItems.length===0;
  });
  await check('real signed activation restores import insertion and full search',async()=>{
    const payload=Buffer.from(JSON.stringify({product:'Crisp Suite',features:['all'],expiresAt:'2999-01-01T00:00:00Z'})).toString('base64url');
    await manager.verify(payload+'.'+sign(null,Buffer.from(payload),pair.privateKey).toString('base64url'));
    const asset=await scanner.ingestBuffer(png,'allowed');view.insertToActiveNote(item);
    view.items=Array.from({length:25},(_,i)=>({...item,id:String(i),name:`asset-${i}`}));view.searchQuery='asset-24';view.applyFilters();
    return fs.existsSync(asset.mainFile)&&editorWrites===1&&view.filteredItems[0]?.id==='24';
  });
  await check('revocation blocks writes clears caches and restores activation card',async()=>{
    await manager.verify('invalid');await view.refresh();const before=fs.readdirSync(root).length;
    try{await scanner.ingestBuffer(png,'revoked');}catch{}view.insertToActiveNote(item);
    return editorWrites===1&&fs.readdirSync(root).length===before&&view.items.length===0&&view.filteredItems.length===0&&!!container.querySelector('.crisp-visual-locked');
  });
  await view.onClose();
  const report={host:'Live Obsidian Electron',artifactSha256:createHash('sha256').update(original).digest('hex'),fixture:root,results,passed:results.every(r=>r.passed)};
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));return JSON.stringify(report);
})()
