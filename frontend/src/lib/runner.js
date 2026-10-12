function runner(CFG){ (async()=>{
  const N=s=>(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const KEYS=[['rohsamendments','rohs2'],['rohsrestrictions','rohs'],['reachrestrictions','reach67'],['persistentorganicpollutants','pops'],['otherrestricted','other'],['persistentbioaccumulative','tsca'],['batteryrestrictions','battery'],['reachcandidatelist','svhc'],['bomcheckpfas','pfas'],['criticalrawmaterials','crm'],['californiaproposition65','prop65'],['substanceofconcern','soc'],['industryrestricted','industry'],['packaging','packaging']];
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  if(CFG.expand){ document.querySelectorAll('button.p-accordionheader[aria-expanded="false"]').forEach(b=>b.click()); await sleep(1500); }
  const rows=[...document.querySelectorAll('div[id^="substanceRow-"]')].map(row=>{
    const panel=row.closest('.p-accordionpanel'); const head=panel&&panel.querySelector('.p-accordionheader');
    const hN=head?N(head.innerText):''; const k=KEYS.find(([p])=>hN.startsWith(p));
    const nm=row.querySelector('[id^="substanceName-"]'); const radios={};
    row.querySelectorAll('input[type=radio]').forEach(r=>radios[r.value]=r);
    return {row,num:row.id.replace('substanceRow-',''),sec:k?k[1]:null,secTxt:head?head.innerText.trim():'?',name:nm?nm.innerText.trim():'',nN:N(nm?nm.innerText:''),radios};});
  const LBL={y:'Yes',n:'No',e:'No (but Exempt)',u:'Missing'}, COL={y:'#16a34a',n:'#dc2626',e:'#f97316',u:'#64748b'};
  const cur=r=>Object.keys(r.radios).find(v=>r.radios[v].checked)||'';
  const fire=(el,type)=>{ const o={bubbles:true,cancelable:true,view:window,button:0};
    el.dispatchEvent(type.startsWith('pointer')?new PointerEvent(type,o):new MouseEvent(type,o)); };
  const realClick=el=>{ ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>fire(el,t)); };
  const setR=async(r,v)=>{ const inp=r.radios[v]; if(!inp) return false;
    const lab=document.getElementById('statusRadioBtn-'+r.num+'-'+v)||inp.closest('label');
    if(CFG.mode!=='fill'){ if(lab){lab.style.outline='3px dashed '+COL[v]; lab.style.outlineOffset='-3px';} return true; }
    if(inp.checked) return true;
    lab.scrollIntoView({block:'center'});
    realClick(lab); await sleep(40);
    if(!inp.checked){ realClick(inp); await sleep(40); }
    if(!inp.checked){ inp.checked=true; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); await sleep(40); }
    return inp.checked; };
  const visible=el=>{ if(!el) return false; const s=getComputedStyle(el); const rc=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&rc.width>0&&rc.height>0; };
  const getDlg=()=>[...document.querySelectorAll('.p-dialog,[role="dialog"],[role="alertdialog"]')].filter(d=>!d.closest('#rcdHelperBanner')).find(visible)||null;
  const waitDlg=async ms=>{ const t0=Date.now(); while(Date.now()-t0<ms){ const d=getDlg(); if(d) return d; await sleep(80);} return null; };
  const waitClosed=async ms=>{ const t0=Date.now(); while(Date.now()-t0<ms){ if(!getDlg()) return true; await sleep(100);} return !getDlg(); };
  const btnBy=(root,txt)=>{ const t=N(txt); return [...root.querySelectorAll('button')].filter(visible).find(b=>{const l=b.querySelector('.p-button-label'); const n=N(l?l.innerText:b.innerText); return n===t||n.startsWith(t);}); };
  let ABORT=false;
  const banner=(title,msg)=>new Promise(res=>{
    let b=document.getElementById('rcdHelperBanner'); if(b) b.remove();
    b=document.createElement('div'); b.id='rcdHelperBanner';
    b.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1e1b4b;color:#fff;padding:12px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.4);font:14px/1.4 Segoe UI,Arial;max-width:560px;border:3px solid #f59e0b';
    b.innerHTML='<b>⏸ RCD helper czeka – '+title+'</b><div style="margin:6px 0 10px;font-size:13px">'+msg+'</div>'+
      '<button data-a="go" style="background:#16a34a;color:#fff;border:0;padding:6px 12px;border-radius:6px;margin-right:6px;cursor:pointer">Dalej ▶</button>'+
      '<button data-a="stop" style="background:#dc2626;color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer">Przerwij ■</button>'+
      '<span style="font-size:11px;opacity:.75;margin-left:8px">(skrypt ruszy sam po zamknięciu okna przez Save)</span>';
    document.body.appendChild(b);
    let done=false; const fin=v=>{ if(done) return; done=true; clearInterval(iv); b.remove(); res(v); };
    b.querySelector('[data-a=go]').onclick=()=>fin('go');
    b.querySelector('[data-a=stop]').onclick=()=>{ABORT=true; fin('stop');};
    let seenOpen=!!getDlg(), closedFor=0;
    const iv=setInterval(()=>{ const open=!!getDlg(); if(open){seenOpen=true; closedFor=0;} else if(seenOpen){ closedFor+=200; if(closedFor>=600) fin('closed'); } },200);
  });
  const handleDlg=async(r,v,wait)=>{
    const d=await waitDlg(wait); if(!d) return '';
    const manual=(CFG.socManual&&r.sec==='soc')||(CFG.exManual&&v==='e');
    const cnk=btnBy(d,'Concentration not known');
    if(cnk){ realClick(cnk); await sleep(350); }
    if(manual){
      const what=r.sec==='soc'?'wpisz CAS substancji (SoC)'+(r._cas?': '+r._cas:''):'wybierz wyjątek / uzupełnij pola';
      await banner(r.name,'Okno otwarte'+(cnk?' („Concentration not known?” już kliknięte)':'')+'. <b>'+what+'</b>, potem kliknij <b>Save</b> w oknie.');
      return getDlg()?'⚠ okno nadal otwarte':'✍ ręcznie';
    }
    const dd=getDlg()||d; const sv=btnBy(dd,'Save');
    if(sv){ realClick(sv); if(await waitClosed(2000)) return cnk?'auto: Concentration not known + Save':'auto: Save'; }
    await banner(r.name,'Nie udało się zapisać okna automatycznie (brak wymaganego pola?). <b>Uzupełnij i kliknij Save</b>.');
    return getDlg()?'⚠ okno nadal otwarte':'✍ ręcznie';
  };
  const VAL={No:'n',EX:'e',Missing:'u'};
  const rep=[], used=new Set(), exl=[]; let fail=0;
  for(const t of CFG.targets){ const tn=N(t.x);
    const hits=rows.filter(r=>!used.has(r)&&r.sec===t.s&&(t.m==='prefix'?r.nN.startsWith(tn):r.nN===tn));
    if(!hits.length){rep.push({Sekcja:t.sec,Pozycja:t.x,Cel:t.a,Wynik:'❌ nie znaleziono'});continue;}
    for(const r of hits){ if(ABORT) break; used.add(r); let v=VAL[t.a]||'n'; if(v==='e'&&!r.radios.e) v='n';
      r._cas=(t.cas||[]).join(', ');
      const was=r.radios[v]&&r.radios[v].checked;
      let ok=await setR(r,v); let dl='';
      if(CFG.mode==='fill'&&!was&&v!=='u'){ dl=await handleDlg(r,v,900); ok=r.radios[v].checked; }
      if(!ok) fail++; if(v==='e') exl.push(r.name);
      rep.push({Sekcja:r.secTxt.slice(0,45),Pozycja:r.name,Cel:t.a,Wynik:(ok?(CFG.mode==='fill'?'✔ ':'podgląd: ')+LBL[v]:'⚠ nie zaznaczone'),Okno:dl}); }
    if(ABORT) break; }
  let yes=0, skip=0;
  if(CFG.fillYes) for(const r of rows){ if(used.has(r)||r.sec==='packaging') continue;
    if(ABORT) break; if(cur(r)&&!CFG.overwrite){skip++;continue;}
    let ok=await setR(r,'y'); if(CFG.mode==='fill'&&getDlg()){ const dl=await handleDlg(r,'y',100); rep.push({Sekcja:r.secTxt.slice(0,45),Pozycja:r.name,Cel:'Yes',Wynik:'okno',Okno:dl}); ok=r.radios.y.checked; }
    if(ok) yes++; else fail++; }
  console.log('%c[RCD helper] '+CFG.mode.toUpperCase()+' | wiersze: '+rows.length,'font-weight:bold;color:#4f46e5');
  console.table(rep); if(exl.length) console.warn('Sprawdź wybrany wyjątek:\n'+exl.join('\n'));
  const tgt=rep.filter(r=>r.Cel!=='Yes'), miss=tgt.filter(r=>r.Wynik.startsWith('❌'));
  alert('[RCD helper] '+(CFG.mode==='fill'?'WYPEŁNIONO':'PODGLĄD')+'\nWiersze substancji: '+rows.length+'\nNo/wyjątek/Missing: '+(tgt.length-miss.length)+'/'+tgt.length+(miss.length?'\nNie znaleziono: '+miss.map(m=>m.Pozycja).join(', '):'')+(ABORT?'\n■ PRZERWANO przez użytkownika':'')+'\nYes: '+yes+' (pominięte wypełnione: '+skip+')'+(fail?'\n⚠ Nie udało się zaznaczyć: '+fail:'')+(exl.length?'\n\n⚠ Sprawdź wyjątki:\n'+exl.join('\n'):'')+'\n\nSprawdź przed zapisem.');
})(); }
