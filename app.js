(()=> {
  /* ============ Firebase helpers (minimal additions) ============ */
  let cloudSaveDebounced = ()=>{}; // becomes real after init

  async function fbInit(){
    try{
      if(!window.firebaseConfig || !firebase?.initializeApp) return null;
      if(!firebase.apps.length){
        firebase.initializeApp(window.firebaseConfig);
      }
      // Sign in anonymously so Firestore rules can require auth
      try{ await firebase.auth().signInAnonymously(); }catch(e){}
      const db=firebase.firestore();
      // Optional offline cache (ignore if it fails)
      try{ await db.enablePersistence({synchronizeTabs:true}); }catch(e){}
      window.db=db;
      return db;
    }catch(e){ return null; }
  }
  async function cloudDocRef(){
    if(!window.db) return null;
    let id=(window.CLOUD_DOC_ID && String(window.CLOUD_DOC_ID).trim()) || "";
    try{ if(!firebase.auth().currentUser) await firebase.auth().signInAnonymously(); }catch(e){}
    if(!id) id = firebase.auth().currentUser?.uid || "";
    if(!id) return null;
    window.CLOUD_DOC_PATH=`wallet/${id}`;
    return window.db.doc(window.CLOUD_DOC_PATH);
  }
  async function cloudLoad(){
    const ref=await cloudDocRef(); if(!ref) return;
    const snap=await ref.get();
    if(snap.exists){
      const data=snap.data()||{};
      if(data.settings){
        SETTINGS={...SETTINGS, ...data.settings, version: SETTINGS.version};
        saveBalances(); applyBalances();
      }
      if(Array.isArray(data.transactions)){
        transactions=data.transactions.slice();
        saveTransactions(); renderTransactions(); refreshCashbackTile();
      }
    }else{
      // First run: seed the cloud with whatever we have locally
      await ref.set({
        settings: SETTINGS,
        transactions: transactions,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }
  async function cloudSave(){
    try{
      const ref=await cloudDocRef(); if(!ref) return;
      await ref.set({
        settings: SETTINGS,
        transactions: transactions,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, {merge:true});
    }catch(e){}
  }
  function debounce(fn,ms){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);} }
  cloudSaveDebounced = debounce(cloudSave, 600);

  /* ============ Your existing app ============ */
  const app=document.getElementById('app');
  document.getElementById('backTxn').addEventListener('click', ()=>{ app.className='app pos-0'; });

  const SETTINGS_DEFAULT = {version:9,cardBalance:69.45,availableBalance:255.55,cashback:0.00,
    cardNumber:'5278 6812 3931 7295',cardExpiry:'07/30',cardCvv:'528'};

  function loadBalances(){
    try{
      const raw = localStorage.getItem('demo_balances');
      if(raw){
        const s = JSON.parse(raw);
        return {
          ...SETTINGS_DEFAULT,
          ...s,
          cardBalance: isFinite(+s.cardBalance) ? +s.cardBalance : SETTINGS_DEFAULT.cardBalance,
          availableBalance: isFinite(+s.availableBalance) ? +s.availableBalance : SETTINGS_DEFAULT.availableBalance,
          cashback: isFinite(+s.cashback) ? +s.cashback : SETTINGS_DEFAULT.cashback,
          version: SETTINGS_DEFAULT.version
        };
      }
    }catch(e){}
    return {...SETTINGS_DEFAULT};
  }
  let SETTINGS=loadBalances();
  const saveBalances=()=>{ localStorage.setItem('demo_balances',JSON.stringify(SETTINGS)); cloudSaveDebounced(); };

  const CASHBACK_VERSION=2, CBV_KEY='cbv_current';
  const ensureCbv=()=>{const stored=Number(localStorage.getItem(CBV_KEY)||'0');if(stored!==CASHBACK_VERSION){localStorage.setItem(CBV_KEY,String(CASHBACK_VERSION))}return CASHBACK_VERSION};
  const currentCbv=()=>Number(localStorage.getItem(CBV_KEY)||ensureCbv()); ensureCbv();

  /* Payment sheet (amount picker) */
  const sheet=document.getElementById('sheet'), dim=document.getElementById('dim'),
        openPay=document.getElementById('openPay'), closeSheetBtn=document.getElementById('closeSheet');
  const closeSheet=()=>{ sheet.classList.remove('active'); };
  openPay.addEventListener('click',()=>{
    sheet.classList.add('active');
    MAX = Math.max(0, SETTINGS.cardBalance);
    if (MAX > 0) { lockedAtMax=false; lastFrac=0; applyFromFraction(1,false); }
  });
  dim.addEventListener('click',closeSheet); closeSheetBtn.addEventListener('click',closeSheet);
  document.addEventListener('keydown',e=>{if(e.key==='Escape') closeSheet()});

  /* Slider (ring amount chooser) */
  const MIN=0.00; let MAX=SETTINGS.cardBalance; let THRESH=+(MAX*0.82).toFixed(2);
  const ringWrap=document.getElementById('ringWrap'), ringSvg=document.getElementById('ringSvg'),
        progress=document.getElementById('progress'), handle=document.getElementById('handle'),
        amountLabel=document.getElementById('amountLabel'), payBtn=document.getElementById('payNowBtn'),
        info=document.getElementById('payInfo');
  const R=120, C=2*Math.PI*R; progress.setAttribute('stroke-dasharray',`${C}`); progress.setAttribute('stroke-dashoffset',`${C}`);
  let amount=MIN, dragging=false, lastFrac=0, lockedAtMax=false;

  function setUI(v){
    if(lockedAtMax||Math.abs(v-MAX)<0.01){progress.setAttribute('stroke','url(#gradBlue)');
      info.innerHTML='Pay Card Balance<small>Paying the total amount you’ve spent is a great way to clear your balance and stay ahead on your finances.</small>'}
    else if(v>THRESH){progress.setAttribute('stroke','url(#gradGreen)');
      info.innerHTML='Pay More Toward Your Balance<small>Paying more of your card balance helps free up available credit and reduces the amount to pay next month.</small>'}
    else{progress.setAttribute('stroke','url(#gradGray)');
      info.innerHTML='Pay Statement Amount<small>Paying your monthly balance helps avoid interest charges.</small>'}
  }
  const signedDelta=(a,b)=>(((a-b)+1.5)%1)-0.5;

  function applyFromFraction(fracRaw,fromDrag=false){
    let f=Math.max(0,Math.min(0.999999,fracRaw)); const delta=signedDelta(f,lastFrac);
    if(lockedAtMax){ if(delta>0){f=1}else{lockedAtMax=false} }
    const NEAR_MAX=0.995; if(!lockedAtMax&&f>=NEAR_MAX){lockedAtMax=true;f=1}
    lastFrac=f; const fracForAmount=(f===1)?1:f; amount=+((MIN+fracForAmount*(MAX-MIN)).toFixed(2));
    const dash=C*(1-fracForAmount); progress.style.transition=fromDrag?'none':'stroke-dashoffset 220ms ease, stroke 220ms ease';
    progress.setAttribute('stroke-dashoffset',`${dash}`);
    const ang=(-90+360*fracForAmount)*Math.PI/180; const hx=160+R*Math.cos(ang), hy=160+R*Math.sin(ang);
    handle.style.transition=fromDrag?'none':'cx 180ms ease, cy 180ms ease'; handle.setAttribute('cx',hx.toFixed(2)); handle.setAttribute('cy',hy.toFixed(2));
    amountLabel.textContent='$'+amount.toFixed(2); payBtn.textContent='Pay $'+amount.toFixed(2); setUI(amount);
  }

  const cardBalanceEl=document.getElementById('cardBalance'), availableEl=document.getElementById('availableBalance'),
        cashbackEl=document.getElementById('cashback'); const fmtUSD=n=>n.toLocaleString(undefined,{style:'currency',currency:'USD'});
  function applyBalances(){
    cardBalanceEl.textContent=fmtUSD(SETTINGS.cardBalance); availableEl.textContent=`${fmtUSD(SETTINGS.availableBalance)} Available`;
    if(cashbackEl) cashbackEl.textContent=fmtUSD(SETTINGS.cashback);
    MAX=Math.max(0,SETTINGS.cardBalance); THRESH=+(MAX*0.82).toFixed(2); lockedAtMax=false; lastFrac=0; applyFromFraction(0,false);
  }

  function fractionFromPointer(evt){
    const rect=ringWrap.getBoundingClientRect();
    const x=(evt.touches?evt.touches[0].clientX:evt.clientX)-rect.left;
    const y=(evt.touches?evt.touches[0].clientY:evt.clientY)-rect.top;
    const cx=rect.width/2, cy=rect.height/2; let theta=Math.atan2(y-cy,x-cx); theta+=Math.PI/2; if(theta<0) theta+=Math.PI*2;
    return theta/(Math.PI*2);
  }
  const start=e=>{dragging=true;applyFromFraction(fractionFromPointer(e),true);e.preventDefault()}
  const move=e=>{if(!dragging)return;applyFromFraction(fractionFromPointer(e),true)}
  const end=()=>{dragging=false}
  handle.addEventListener('mousedown',start); handle.addEventListener('touchstart',start,{passive:false});
  ringSvg.addEventListener('mousedown',start); ringSvg.addEventListener('touchstart',start,{passive:false});
  window.addEventListener('mousemove',move,{passive:false}); window.addEventListener('touchmove',move,{passive:false});
  window.addEventListener('mouseup',end); window.addEventListener('touchend',end);

  document.getElementById('otherAmountBtn').addEventListener('click',()=>{
    const raw=prompt('Enter a payment amount (0.00–'+MAX.toFixed(2)+')', amount.toFixed(2));
    if(!raw) return; const n=parseFloat(raw.replace(/[^\d.]/g,'')); if(isFinite(n)){applyFromFraction(Math.max(0,Math.min(1,n/Math.max(1,MAX))),false)}
  });

  function applyBalanceDelta(cardDelta,availDelta){
    const nextCard=+(SETTINGS.cardBalance+cardDelta).toFixed(2);
    SETTINGS.cardBalance=nextCard<0?0:nextCard; SETTINGS.availableBalance=+(SETTINGS.availableBalance+availDelta).toFixed(2);
    saveBalances(); applyBalances();
  }

  /* === Pay flow to full confirm page (no transaction yet) === */
  let pendingPayAmt = 0;
  let confirmFlow = 'pay';                       // 'pay' | 'cashback'
  const payAmountLabel = document.getElementById('payAmountLabel');
  const payBackBtn = document.getElementById('payBackBtn');
  const payCancelBtn = document.getElementById('payCancelBtn');
  const payTitleEl = document.querySelector('#payPage .payTitle');
  const transferLabel = document.getElementById('transferLabel');
  payBackBtn.addEventListener('click', ()=>{ app.className='app pos-0'; });
  payCancelBtn.addEventListener('click', ()=>{ app.className='app pos-0'; });

  function openPayPage() {
    payTitleEl.textContent = (confirmFlow === 'cashback') ? 'Cashback Deposit' : 'Pay Card';
    transferLabel.textContent = (confirmFlow === 'cashback') ? 'Transfer to' : 'Transfer from';
    payAmountLabel.textContent = '$' + pendingPayAmt.toFixed(2);
    closeSheet();
    if (confirmFlow === 'cashback') { closeCbSheet(); }
    app.className = 'app pos-2';
    resetSlider();
  }
  payBtn.addEventListener('click', ()=>{
    pendingPayAmt = amount;
    if (pendingPayAmt <= 0) return;
    confirmFlow = 'pay';
    openPayPage();
  });

  applyBalances();

  /* Transactions & cashback */
  const TXN_STORE_KEY='demo_txns';

  function saveTransactions(){try{localStorage.setItem(TXN_STORE_KEY,JSON.stringify(transactions))}catch(e){} refreshCashbackTile(); cloudSaveDebounced(); }
  function rid(){return 't_'+Math.random().toString(36).slice(2,9)}

  /* CASHBACK LOGIC */
  const round2=n=>Math.round(n*100)/100;
  const CASHBACK_RATES={shopping:0.05,food:0.04, travel:0.04, streaming:0.04,gaming:0.03, messaging:0.03};
  const rateForCategory = cat => CASHBACK_RATES[cat] ?? 0;
  const calcCashback=(amt,cat)=>round2((Number(amt)||0)*rateForCategory(cat));
  const getTxnCashback=t=>(typeof t.cashback==='number') ? t.cashback : (t.kind==='purchase' ? calcCashback(t.amount, t.category) : 0);

  /* Seed transactions if none */
  const SEED_TXNS = (function(){
    const cv = currentCbv();
    return [
      {id:'t_seed1',kind:'purchase',merchant:'DISCORD* GIFT-NITRO-MO',amount:10.66,iso:'2025-04-07T15:00:00.000Z',status:'Approved',card:'Sapphire Reserve',category:'gaming',cashback:calcCashback(10.66,'gaming'),cbv:cv},
      {id:'t_seed2',kind:'purchase',merchant:'DISCORD* GIFT-NITRO-MO',amount:10.66,iso:'2025-04-07T14:00:00.000Z',status:'Approved',card:'Sapphire Reserve',category:'gaming',cashback:calcCashback(10.66,'gaming'),cbv:cv},
      {id:'t_seed3',kind:'purchase',merchant:'Nike',amount:64.35,iso:'2025-08-24T17:10:00.000Z',status:'Approved',card:'Sapphire Reserve',category:'shopping',cashback:calcCashback(64.35,'shopping'),cbv:cv},
      {id:'t_seed4',kind:'purchase',merchant:"McDonald's PlayPlace",amount:31.29,iso:'2025-08-22T12:00:00.000Z',status:'Approved',card:'Sapphire Reserve',category:'food',cashback:calcCashback(31.29,'food'),cbv:cv},
      {id:'t_seed5',kind:'purchase',merchant:'State Farm Insurance',amount:156.34,iso:'2025-08-21T12:00:00.000Z',status:'Approved',card:'Sapphire Reserve',category:'shopping',cashback:calcCashback(156.34,'shopping'),cbv:cv},
      {id:'t_seed6',kind:'purchase',merchant:'Apple',amount:2.99,iso:'2025-08-20T12:00:00.000Z',status:'Approved',card:'Sapphire Reserve',category:'messaging',cashback:calcCashback(2.99,'messaging'),cbv:cv},
      {id:'t_seed7',kind:'payment',merchant:'From Apple Cash',amount:458.72,iso:'2025-08-19T12:00:00.000Z',status:'Posted',card:'Sapphire Reserve',category:'payment',cashback:0,cbv:cv},
      {id:'t_seed8',kind:'purchase',merchant:'Delta Air Lines',amount:386.67,iso:'2025-04-28T12:00:00.000Z',status:'Approved',card:'Sapphire Reserve',category:'travel',cashback:calcCashback(386.67,'travel'),cbv:cv},
      {id:'t_seed9',kind:'purchase',merchant:'Amazon',amount:23.49,iso:'2025-08-24T10:30:00.000Z',status:'Approved',card:'Sapphire Reserve',category:'shopping',cashback:calcCashback(23.49,'shopping'),cbv:cv}
    ];
  })();

  function loadTransactions(){
    try{
      const raw=localStorage.getItem(TXN_STORE_KEY);
      if(raw){
        const arr=JSON.parse(raw);
        if(Array.isArray(arr) && arr.length) return arr;
      }
    }catch(e){}
    return SEED_TXNS.slice();
  }

  const CAT_MAP={food:'food-icon.png',gaming:'gaming-icon.png',streaming:'watch-icon.png',travel:'travel-icon.png',messaging:'messaging-icon.png',shopping:'shopping-icon.png',payment:'payment-icon.png'};
  const catLabel=(k)=>({food:'Food/Drinks',gaming:'Gaming',streaming:'Streaming',travel:'Travel',messaging:'Messaging',shopping:'Shopping',payment:'Payment'}[k]||'Other');
  const iconByCat=(k)=> CAT_MAP[k] || 'payment-icon.png';

  const KEYWORD_ICON_RULES = [
    { patterns: [/doordash/i, /dd\*/i, /dashpass/i], icon: 'doordash-icon.png' },
    { patterns: [/affirm/i], icon: 'affirm-icon.png' },
    { patterns: [/amazon/i, /\bamzn\b/i, /amzn\s*mk?tp/i, /prime\b/i], icon: 'amazon-icon.png' },
    { patterns: [/discord/i, /nitro/i], icon: 'discord-icon.png' },
    { patterns: [/\bapple\b/i, /apple\.?com\/bill/i, /itunes/i, /app\s*store/i, /apple\s*pay/i], icon: 'apple-icon.png' },
    { patterns: [/\bgoogle\b/i, /google\s*play/i, /(gpay|google\s*pay)/i], icon: 'google-icon.png' },
    { patterns: [/american\s+air(lines)?/i, /\baadvantage\b/i, /\baa\s?(?:#|flight|tkt|ticket)?/i], icon: 'aa-icon.png' },
    { patterns: [/singapore\s+air(lines)?/i, /\bkrisflyer\b/i, /\bsia\b/i], icon: 'sing-icon.png' },
    /* NEW: card payment keywords -> Chase icon */
    { patterns: [/card\s*payment/i, /payment.*7295/i, /\b7295\b/i], icon: 'chase-icon.png' },
  ];

  function chooseIconForMerchant(name){
    if (!name) return null;
    const s = String(name);
    for (const rule of KEYWORD_ICON_RULES){
      for (const rx of rule.patterns){
        if (rx.test(s)) return rule.icon;
      }
    }
    return null;
  }
  /* Force all payment txns to use chase icon */
  function iconForTransaction(t){ 
    if (t.kind==='payment') return 'chase-icon.png';
    return chooseIconForMerchant(t.merchant) || iconByCat(t.category); 
  }

  /* Load transactions */
  let transactions = loadTransactions() || [];

  function formatDisplay(t){const negative=(t.status==='Refunded'||t.status==='Posted');return (negative?'- ':'')+'$'+Number(t.amount).toFixed(2)}
  function formatMoneyAbs(n){return '$'+Math.abs(n).toFixed(2)}
  function shortDate(iso){const d=new Date(iso);return d.toLocaleDateString(undefined,{month:'2-digit',day:'2-digit',year:'2-digit'})}
  function fullDateTime(iso){const d=new Date(iso);return d.toLocaleDateString(undefined,{month:'2-digit',day:'2-digit',year:'2-digit'})+', '+d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}

  function renderTransactions(){
    transactions.sort((a,b)=>new Date(b.iso)-new Date(a.iso));
    const rows=transactions.map(t=>{
      const pct = Math.round(rateForCategory(t.category)*100);
      const pctChip = (t.kind==='purchase' && pct>0) ? `<div class="cbChip">${pct}%</div>` : '';
      return `
      <div class="txnRow" data-id="${t.id}" tabindex="0" role="button" aria-label="Open ${t.merchant} transaction">
        <div class="txnIcon"><img src="./${iconForTransaction(t)}" alt="" /></div>
        <div class="txnMain">
          <div class="txnTitle">${t.merchant}${t.status?` <span style="opacity:.6">• ${t.status}</span>`:''}</div>
          <div class="txnSub">${shortDate(t.iso)}</div>
        </div>
        <div class="txnRight">
          <div class="amtWrap">
            <div class="txnAmt">${formatDisplay(t)}</div>
            ${pctChip}
          </div>
          <div class="chev">›</div>
        </div>
      </div>`;
    }).join('');

    document.getElementById('txnList').innerHTML=`<div class="txnStack">${rows||''}</div>`;
    document.querySelectorAll('#txnList .txnRow').forEach(row=>{
      row.addEventListener('click',()=>openTxn(row.dataset.id));
      row.addEventListener('keypress',e=>{if(e.key==='Enter')openTxn(row.dataset.id)});
    });
  }

  function computeCashbackAvailable(){
    const cv=currentCbv();
    return Math.round(transactions.reduce((sum,t)=>{
      if((t.cbv||0)!==cv) return sum;
      if(t.kind==='purchase') return sum+getTxnCashback(t);
      if(t.kind==='cashback_deposit') return sum-(Number(t.amount)||0);
      return sum;
    },0)*100)/100;
  }
  function refreshCashbackTile(){
    const total=Math.max(0,computeCashbackAvailable());
    SETTINGS.cashback=total; saveBalances();
    if(cashbackEl) cashbackEl.textContent=fmtUSD(total);
  }

  let currentTxnId=null;
  function openTxn(id){
    const t=transactions.find(x=>x.id===id); if(!t) return; currentTxnId=id;
    document.getElementById('txnIcon').src = './' + iconForTransaction(t);
    document.getElementById('txnAmount').textContent=formatMoneyAbs(t.amount);
    document.getElementById('txnMerchant').textContent=t.merchant;
    document.getElementById('txnDate').textContent=fullDateTime(t.iso);
    document.getElementById('txnStatus').innerHTML=`<strong>Status: ${t.status||'Approved'}</strong>`;
    document.getElementById('txnCard').textContent=t.card||'Sapphire Reserve';
    document.getElementById('txnTotal').textContent=formatMoneyAbs(t.amount);
    const cbRow=document.getElementById('cashbackRow');
    if(t.kind==='purchase'){document.getElementById('txnCashback').textContent='$'+getTxnCashback(t).toFixed(2);cbRow.classList.remove('hidden')}
    else{cbRow.classList.add('hidden')}
    const depRow=document.getElementById('depositTargetRow');
    if(t.kind==='cashback_deposit'){const last4=t.acctLast4||(t.account||'').slice(-4)||'';document.getElementById('depositTargetValue').textContent='•••• '+last4;depRow.classList.remove('hidden')}
    else{depRow.classList.add('hidden')}
    app.className='app pos-1';
  }
  document.getElementById('deleteTxnBtn').addEventListener('click',()=>{
    if(!currentTxnId)return; const i=transactions.findIndex(t=>t.id===currentTxnId);
    if(i>-1){transactions.splice(i,1);saveTransactions();renderTransactions();currentTxnId=null;app.className='app pos-0'}
  });

  /* Public helpers */
  window.addPurchase=({merchant,amount,iso,card='Sapphire Reserve',status='Approved',category='shopping'})=>{
    const amt=Number(amount);
    transactions.push({
      id:rid(),kind:'purchase',merchant,amount:amt,iso,status,card,category,
      cashback:calcCashback(amt,category),cbv:currentCbv()
    });
    saveTransactions();renderTransactions();applyBalanceDelta(+amt,-amt);
  };
  window.addRefund=({merchant,amount,iso,card='Sapphire Reserve',status='Refunded',category='shopping'})=>{
    const amt=Number(amount);transactions.push({id:rid(),kind:'refund',merchant,amount:amt,iso,status,card,category,cashback:0});
    saveTransactions();renderTransactions();applyBalanceDelta(-amt,+amt);
  };
  window.addPayment=({amount,iso,card='Sapphire Reserve',merchant='Card Payment',status='Posted',category='payment'})=>{
    const amt=Number(amount);transactions.push({id:rid(),kind:'payment',merchant,amount:amt,iso,status,card,category,cashback:0});
    saveTransactions();renderTransactions();applyBalanceDelta(-amt,+amt);
  };
  window.addCashbackDeposit=({amount,iso,card='Sapphire Reserve',status='Posted',account,routing})=>{
    transactions.push({id:rid(),kind:'cashback_deposit',merchant:'Cashback deposited',amount:Number(amount),iso,status,card,category:'payment',cashback:0,cbv:currentCbv(),account,routing,acctLast4:(account||'').slice(-4)});
    saveTransactions();renderTransactions();
  };
  window.removeTransaction=(id)=>{const i=transactions.findIndex(t=>t.id===id);if(i>-1){transactions.splice(i,1);saveTransactions();renderTransactions();}}
  window.removeTransactionWhere=(criteria)=>{const i=transactions.findIndex(t=>Object.entries(criteria).every(([k,v])=>t[k]===v));if(i>-1){transactions.splice(i,1);saveTransactions();renderTransactions();}}

  renderTransactions(); refreshCashbackTile();

  /* Card details */
  const cardSheet=document.getElementById('cardSheet'),cardDim=document.getElementById('cardDim'),
        closeCardSheetBtn=document.getElementById('closeCardSheet'),
        cdNumber=document.getElementById('cdNumber'),cdExpiry=document.getElementById('cdExpiry'),cdCvv=document.getElementById('cdCvv');
  function openCardSheet(){cdNumber.textContent=(SETTINGS.cardNumber||'').replace(/\s+/g,'').replace(/(\d{4})(?=\d)/g,'$1 ');
    cdExpiry.textContent=SETTINGS.cardExpiry||'MM/YY'; cdCvv.textContent=SETTINGS.cardCvv||'000'; cardSheet.classList.add('active')}
  function closeCardSheet(){cardSheet.classList.remove('active')}
  cardDim.addEventListener('click',closeCardSheet); closeCardSheetBtn.addEventListener('click',closeCardSheet);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCardSheet()});
  const bigCardEl=document.getElementById('bigCard'); if(bigCardEl){bigCardEl.style.cursor='pointer'; bigCardEl.addEventListener('click',openCardSheet)}

  /* Add Txn flow */
  const addTxnSheet=document.getElementById('addTxnSheet'),addTxnDim=document.getElementById('addTxnDim'),
        openAddTxn=document.getElementById('openAddTxn'),closeAddTxn=document.getElementById('closeAddTxn'),
        txMerchant=document.getElementById('txMerchant'),txAmount=document.getElementById('txAmount'),
        txWhen=document.getElementById('txWhen'),txStatus=document.getElementById('txStatus'),
        txCategory=document.getElementById('txCategory'),
        txContinue=document.getElementById('txContinue'),txCancelFromForm=document.getElementById('txCancelFromForm');
  const confirmSheet=document.getElementById('confirmTxnSheet'),confirmDim=document.getElementById('confirmDim'),
        closeConfirm=document.getElementById('closeConfirm'),confirmSummary=document.getElementById('confirmSummary'),
        confirmAddBtn=document.getElementById('confirmAddBtn'),editTxnBtn=document.getElementById('editTxnBtn');
  function openAddSheet(){addTxnSheet.classList.add('active')}
  function closeAddSheet(){addTxnSheet.classList.remove('active')}
  function openConfirm(){confirmSheet.classList.add('active')}
  function closeConfirmSheet(){confirmSheet.classList.remove('active')}
  openAddTxn.addEventListener('click',openAddSheet);
  addTxnDim.addEventListener('click',closeAddSheet); closeAddTxn.addEventListener('click',closeAddSheet);
  txCancelFromForm.addEventListener('click',closeAddSheet);
  confirmDim.addEventListener('click',closeConfirmSheet); closeConfirm.addEventListener('click',closeConfirmSheet);
  editTxnBtn.addEventListener('click',()=>{closeConfirmSheet();openAddSheet()});
  let pendingTxn=null;
  function fullDateTime2(iso){const d=new Date(iso);return d.toLocaleDateString(undefined,{month:'2-digit',day:'2-digit',year:'2-digit'})+', '+d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}
  txContinue.addEventListener('click',()=>{
    const m=(txMerchant.value||'').trim(); const a=parseFloat(txAmount.value);
    const w=txWhen.value?new Date(txWhen.value):new Date(); const s=txStatus.value||'Approved';
    const c=txCategory.value||'shopping';
    if(!m||!isFinite(a))return;
    pendingTxn={merchant:m,amount:+a.toFixed(2),iso:w.toISOString(),status:s,category:c};
    confirmSummary.innerHTML=`<p><b>Merchant:</b> ${m}</p>
      <p><b>Amount:</b> $${pendingTxn.amount.toFixed(2)}</p>
      <p><b>Date &amp; Time:</b> ${fullDateTime2(pendingTxn.iso)}</p>
      <p><b>Status:</b> ${s}</p>
      <p><b>Category:</b> ${catLabel(c)}</p>`;
    closeAddSheet(); openConfirm();
  });
  confirmAddBtn.addEventListener('click',()=>{
    if(!pendingTxn)return; const {merchant,amount,iso,status,category}=pendingTxn;
    if(status==='Approved'){window.addPurchase({merchant,amount,iso,status,card:'Sapphire Reserve',category})}
    else if(status==='Refunded'){window.addRefund({merchant,amount,iso,status,card:'Sapphire Reserve',category})}
    else{window.addPayment({amount,iso,status,card:'Sapphire Reserve',merchant,category})}
    pendingTxn=null; closeConfirmSheet();
  });

  /* Cashback sheet */
  const cashbackTile=document.getElementById('cashbackTile'),cbSheet=document.getElementById('cashbackSheet'),
        cbDim=document.getElementById('cbDim'),cbViews=document.getElementById('cbViews'),
        cbClose1=document.getElementById('cbClose1'),cbClose2=document.getElementById('cbClose2'),
        cbDepositBtn=document.getElementById('cbDepositBtn'),cbSubmit=document.getElementById('cbSubmit'),
        cbCancel=document.getElementById('cbCancel'),cbAcct=document.getElementById('cbAcct'),cbRouting=document.getElementById('cbRouting');
  function openCbSheet(){cbViews.style.transform='translateX(0%)'; cbAmount=0; cbLockedAtMax=false; cbLastFrac=0; cbApplyFromFraction(0,false); cbSheet.classList.add('active')}
  function closeCbSheet(){cbSheet.classList.remove('active')}
  cashbackTile.addEventListener('click',openCbSheet); cbDim.addEventListener('click',closeCbSheet);
  cbClose1.addEventListener('click',closeCbSheet); cbClose2.addEventListener('click',closeCbSheet); cbCancel.addEventListener('click',closeCbSheet);

  const cbRingWrap=document.getElementById('cbRingWrap'),cbRingSvg=document.getElementById('cbRingSvg'),cbProgress=document.getElementById('cbProgress'),
        cbHandle=document.getElementById('cbHandle'),cbAmountLabel=document.getElementById('cbAmountLabel');
  const CB_R=120, CB_C=2*Math.PI*CB_R; cbProgress.setAttribute('stroke-dasharray',`${CB_C}`); cbProgress.setAttribute('stroke-dashoffset',`${CB_C}`);
  let CB_MAX=0, cbAmount=0, cbDragging=false, cbLastFrac=0, cbLockedAtMax=false;

  function cbSetMax(){CB_MAX=Math.max(0,computeCashbackAvailable())}
  function cbSetUI(v){cbProgress.setAttribute('stroke',v>0?'url(#cbGradGreen)':'url(#cbGradGray)')}
  function cbSignedDelta(a,b){return (((a-b)+1.5)%1)-0.5}
  function cbApplyFromFraction(fracRaw,fromDrag=false){
    cbSetMax(); let f=Math.max(0,Math.min(0.999999,fracRaw)); const delta=cbSignedDelta(f,cbLastFrac);
    if(cbLockedAtMax){if(delta>0){cbLockedAtMax=true;f=1}else{cbLockedAtMax=false}}
    const NEAR_MAX=0.995; if(!cbLockedAtMax&&f>=NEAR_MAX){cbLockedAtMax=true;f=1}
    cbLastFrac=f; const fracForAmount=(f===1)?1:f; cbAmount=+((0+fracForAmount*(CB_MAX-0)).toFixed(2));
    const dash=CB_C*(1-fracForAmount); cbProgress.style.transition=fromDrag?'none':'stroke-dashoffset 220ms ease, stroke 220ms ease'; cbProgress.setAttribute('stroke-dashoffset',`${dash}`);
    const ang=(-90+360*fracForAmount)*Math.PI/180; const hx=160+CB_R*Math.cos(ang), hy=160+CB_R*Math.sin(ang);
    cbHandle.style.transition=fromDrag?'none':'cx 180ms ease, cy 180ms ease'; cbHandle.setAttribute('cx',hx.toFixed(2)); cbHandle.setAttribute('cy',hy.toFixed(2));
    cbAmountLabel.textContent='$'+cbAmount.toFixed(2); cbDepositBtn.textContent='Deposit $'+cbAmount.toFixed(2); cbDepositBtn.disabled=!(cbAmount>0); cbSetUI(cbAmount);
  }
  function cbFracFromPointer(evt){
    const rect=cbRingWrap.getBoundingClientRect();
    const x=(evt.touches?evt.touches[0].clientX:evt.clientX)-rect.left, y=(evt.touches?evt.touches[0].clientY:evt.clientY)-rect.top;
    const cx=rect.width/2, cy=rect.height/2; let theta=Math.atan2(y-cy,x-cx); theta+=Math.PI/2; if(theta<0) theta+=Math.PI*2; return theta/(Math.PI*2);
  }
  const cbStart=e=>{cbDragging=true;cbApplyFromFraction(cbFracFromPointer(e),true);e.preventDefault()}
  const cbMove=e=>{if(!cbDragging)return;cbApplyFromFraction(cbFracFromPointer(e),true)}
  const cbEnd=()=>{cbDragging=false}
  cbHandle.addEventListener('mousedown',cbStart); cbHandle.addEventListener('touchstart',cbStart,{passive:false});
  cbRingSvg.addEventListener('mousedown',cbStart); cbRingSvg.addEventListener('touchstart',cbStart,{passive:false});
  window.addEventListener('mousemove',cbMove,{passive:false}); window.addEventListener('touchmove',cbMove,{passive:false});
  window.addEventListener('mouseup',cbEnd); window.addEventListener('touchend',cbEnd);

  /* Route cashback deposit to the same confirm page */
  cbDepositBtn.addEventListener('click', ()=>{
    if(cbAmount<=0) return;
    pendingPayAmt = cbAmount;
    confirmFlow = 'cashback';
    openPayPage();
  });

  /* (Second page fields remain available but are not used in this flow) */
  cbSubmit.addEventListener('click', ()=>{
    const acct=(cbAcct.value||'').trim(), routing=(cbRouting.value||'').trim();
    if(!acct||!routing||cbAmount<=0) return;
    const nowIso=new Date().toISOString();
    window.addCashbackDeposit({amount:cbAmount,iso:nowIso,account:acct,routing});
    cbAmount=0; cbApplyFromFraction(0,false); closeCbSheet();
  });
  cbCancel.addEventListener('click', closeCbSheet);

  /* Update Balances sheet logic */
  const balancesSheet=document.getElementById('balancesSheet'),
        balancesDim=document.getElementById('balancesDim'),
        openBalances=document.getElementById('openBalances'),
        closeBalances=document.getElementById('closeBalances'),
        balancesSaveBtn=document.getElementById('balancesSaveBtn'),
        balancesCancelBtn=document.getElementById('balancesCancelBtn'),
        editCardBalance=document.getElementById('editCardBalance'),
        editAvailableBalance=document.getElementById('editAvailableBalance'),
        editCashback=document.getElementById('editCashback');

  function openBalancesSheet(){
    editCardBalance.value = (Number(SETTINGS.cardBalance)||0).toFixed(2);
    editAvailableBalance.value = (Number(SETTINGS.availableBalance)||0).toFixed(2);
    editCashback.value = (Number(SETTINGS.cashback)||0).toFixed(2);
    balancesSheet.classList.add('active');
  }
  function closeBalancesSheet(){ balancesSheet.classList.remove('active'); }

  openBalances.addEventListener('click', openBalancesSheet);
  balancesDim.addEventListener('click', closeBalancesSheet);
  closeBalances.addEventListener('click', closeBalancesSheet);
  balancesCancelBtn.addEventListener('click', closeBalancesSheet);

  balancesSaveBtn.addEventListener('click', ()=>{
    const card = parseFloat(editCardBalance.value);
    const avail = parseFloat(editAvailableBalance.value);
    const cb = parseFloat(editCashback.value);
    if (isFinite(card)) SETTINGS.cardBalance = +card.toFixed(2);
    if (isFinite(avail)) SETTINGS.availableBalance = +avail.toFixed(2);
    if (isFinite(cb)) SETTINGS.cashback = +cb.toFixed(2);
    saveBalances();
    applyBalances();
    closeBalancesSheet();
  });

  /* ===== Pay Confirmation page interactions ===== */
  const openAcctPicker = document.getElementById('openAcctPicker');
  const acctSheet = document.getElementById('acctSheet');
  const acctDim = document.getElementById('acctDim');
  const acctClose = document.getElementById('acctClose');
  const acctSave = document.getElementById('acctSave');
  const fromAcctNameEl = document.getElementById('fromAcctName');

  function openAcctSheet(){ acctSheet.classList.add('active'); }
  function closeAcctSheet(){ acctSheet.classList.remove('active'); }

  openAcctPicker.addEventListener('click', openAcctSheet);
  acctDim.addEventListener('click', closeAcctSheet);
  acctClose.addEventListener('click', closeAcctSheet);
  acctSave.addEventListener('click', ()=>{
    const sel = document.querySelector('#acctList input[name="acct"]:checked');
    if (sel) fromAcctNameEl.textContent = sel.value;
    closeAcctSheet();
  });

  /* Slide to confirm */
  const slideWrap = document.getElementById('slideWrap');
  const slideThumb = document.getElementById('slideThumb');
  const slideLabel = document.getElementById('slideLabel');
  const slideFill = document.getElementById('slideFill');
  let draggingSlide=false, startX=0, thumbX=0, maxX=0, confirmed=false, thumbW=52;

  function resetSlider(){
    confirmed=false;
    slideThumb.style.transition='';
    slideThumb.style.left='4px';
    slideFill.style.transition='';
    slideFill.style.width='0px';
    slideWrap.classList.remove('slideDone');
    slideLabel.textContent='Slide to confirm';
  }

  function beginDrag(e){
    if(confirmed) return;
    draggingSlide=true;
    startX=(e.touches?e.touches[0].clientX:e.clientX);
    const wrapRect=slideWrap.getBoundingClientRect();
    const thumbRect=slideThumb.getBoundingClientRect();
    maxX = wrapRect.width - thumbRect.width - 8; // both side paddings 4px
    thumbX = parseFloat(slideThumb.style.left||'4');
    thumbW = thumbRect.width;
    slideThumb.style.transition='none';
    slideFill.style.transition='width .15s ease';
    e.preventDefault();
  }
  function moveDrag(e){
    if(!draggingSlide||confirmed) return;
    const x=(e.touches?e.touches[0].clientX:e.clientX);
    const dx=x-startX;
    let nx=Math.max(4,Math.min(4+dx+ (thumbX-4),4+maxX));
    slideThumb.style.left=nx+'px';
    // Blue trail follows thumb
    const fillW = Math.max(0, (nx - 4) + thumbW);
    slideFill.style.width = fillW + 'px';
  }
  function endDrag(){
    if(!draggingSlide||confirmed) return;
    draggingSlide=false;
    const currentLeft=parseFloat(slideThumb.style.left||'4');
    const threshold=4+maxX*0.92;
    if(currentLeft>=threshold){
      // Confirmed
      confirmed=true;
      slideThumb.style.left=(4+maxX)+'px';
      slideFill.style.width='calc(100% - 8px)';
      slideWrap.classList.add('slideDone');
      slideLabel.textContent='Processing…';
      performPayment();
    }else{
      slideThumb.style.transition='left .25s ease';
      slideThumb.style.left='4px';
      slideFill.style.transition='width .25s ease';
      slideFill.style.width='0px';
    }
  }
  slideThumb.addEventListener('mousedown',beginDrag);
  slideThumb.addEventListener('touchstart',beginDrag,{passive:false});
  window.addEventListener('mousemove',moveDrag,{passive:false});
  window.addEventListener('touchmove',moveDrag,{passive:false});
  window.addEventListener('mouseup',endDrag);
  window.addEventListener('touchend',endDrag);

  function showLoadingChip(message){
    const chip=document.createElement('div');
    chip.className='loadingChip';
    chip.innerHTML='<div class="spinner"></div><div>'+(message||'Submitting payment…')+'</div>';
    document.body.appendChild(chip);
    return chip;
  }

  function performPayment(){
    const isDeposit = (confirmFlow === 'cashback');
    const chip=showLoadingChip(isDeposit ? 'Submitting deposit…' : 'Submitting payment…');
    const nowIso = new Date().toISOString();

    if (isDeposit){
      window.addCashbackDeposit({amount:pendingPayAmt,iso:nowIso,account:fromAcctNameEl.textContent});
    }else{
      // merchant ensures chase icon rule
      window.addPayment({amount:pendingPayAmt,iso:nowIso,merchant:'CARD PAYMENT 7295',category:'payment'});
    }

    setTimeout(()=>{
      chip.remove();
      app.className='app pos-0';
      resetSlider();
    },3000);
  }

  /* === Start Firebase sync (loads cloud over local if present) === */
  (async ()=>{ const db=await fbInit(); if(db){ await cloudLoad(); } })();

})();
