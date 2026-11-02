const $ = (s, root = document) => root.querySelector(s);
const app = $('#app'), dialog = $('#dialog');
const S = {session: null, workspace: {servers: [], commands: [], settings: {}, costs: {}}, page: 'overview', provider: null, query: '', status: '', view: 'table', revision: 0};
let passwordViewEpoch=0;
const paths = {
 overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 server:'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/>',
 terminal:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
 settings:'<path d="m10 3-.7 2.2-2 .9-2.1-.5-2 3.5L4.8 11v2l-1.6 1.9 2 3.5 2.1-.5 2 .9L10 21h4l.7-2.2 2-.9 2.1.5 2-3.5-1.6-1.9v-2l1.6-1.9-2-3.5-2.1.5-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>',
 globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
 plus:'<path d="M12 5v14M5 12h14"/>', arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',chevron:'<path d="m9 5 7 7-7 7"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 logout:'<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M9 12h12m-4-4 4 4-4 4"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>', copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15Z"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
 wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5ZM3 8h18M7 5V3h11v2"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',pulse:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',refresh:'<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',external:'<path d="M14 3h7v7M21 3l-9 9M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',check:'<path d="m5 12 4 4L19 6"/>'};
function icon(name, size=18){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.server}</svg>`;}
const brand = `<div class="brand"><svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="m4 25 16 8 16-8v6l-16 8-16-8Z" fill="#a1aec8"/><path d="m4 16 16 8 16-8v7l-16 8-16-8Z" fill="#667da8"/><path d="m4 10 16-8 16 8-16 8Z" fill="currentColor"/><path d="M4 10v6l16 8v-6Z" fill="#5270c4"/><path d="m20 18 16-8v6l-16 8Z" fill="#3551ad"/></svg><div><span class="brand-name">VPS 管家</span><span class="brand-sub">YOUR PRIVATE CLOUD</span></div></div>`;
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const action = (name, label, ico='', cls='button', id='') => `<button type="button" class="${cls}" data-action="${name}"${id?` data-id="${e(id)}"`:''}>${ico?icon(ico,16):''}${label}</button>`;
const money = n => Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
// Calendar fields keep their recorded day; only "today" follows the browser timezone.
function calendarDate(value){
  if(!value)return null;
  const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  const d=match?new Date(Number(match[1]),Number(match[2])-1,Number(match[3])):new Date(value);
  return Number.isNaN(d.valueOf())?null:d;
}
const shortDate = value => calendarDate(value)?.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})||'未设置';
const dateValue = value => {const d=calendarDate(value);return d?[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'):'';};
const daysLeft = s => {const d=calendarDate(s.renewalDate||s.renewalDateText);if(!d)return null;const t=new Date();return (Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()))/86400000;};
const dueText = s => {const d=daysLeft(s);return d===null?'未设置续费日期':d<0?`已到期 ${-d} 天`:d===0?'今天到期':`${d} 天后到期`;};
const statusMap={online:['运行中',''],maintenance:['维护中','warning'],idle:['闲置','stopped'],expired:['已到期','danger']};
const badge = s => {const [label,cls]=statusMap[s]||['未记录','stopped'];return `<span class="status ${cls}"><span class="dot"></span>${label}</span>`;};
const cycleMap={monthly:'月',quarterly:'季',yearly:'年'};
const price = s => s.monthlyCostAmount===null||s.monthlyCostAmount===undefined||String(s.monthlyCostAmount).trim()===''?'未记录价格':`${e(s.monthlyCostCurrency||'CNY')} ${money(s.monthlyCostAmount)} / ${cycleMap[s.monthlyCostCycle]||'月'}`;
function normalizeBandwidth(raw){
 const value=String(raw??'').trim();
 const match=/^(\d+(?:\.\d+)?|\.\d+)\s*(?:([mMgG])(?:bps|b\/s|bit\/s)?)?$/.exec(value);
 return match?`${match[1]}${(match[2]||'M').toUpperCase()}`:value;
}
const safeURL = raw => {try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}};
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3500);}
async function api(path, method='GET', data, revision=S.revision){const headers={Accept:'application/json'};if(method!=='GET'){headers['Content-Type']='application/json';if(S.session?.csrfToken)headers['X-CSRF-Token']=S.session.csrfToken;headers['If-Match']=String(revision);}const r=await fetch('/api'+path,{method,headers,credentials:'same-origin',cache:'no-store',body:data===undefined?undefined:JSON.stringify(data)});const result=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401&&S.session?.authenticated&&!path.startsWith('/security/')&&!path.startsWith('/settings/telegram')&&path!=='/backup'){S.session=null;S.workspace={servers:[],commands:[],settings:{},costs:{}};closeDialog();await init();}const err=new Error(typeof result.error==='string'?result.error:result.message||'请求未完成，请稍后重试。');err.status=r.status;throw err;}return result;}
async function loadWorkspace(){S.workspace=await api('/workspace');S.revision=S.workspace.revision;S.workspace.servers ||= [];S.workspace.commands ||= [];S.workspace.settings ||= {};S.workspace.costs ||= {};}
async function mutate(path,method,data,revision=S.revision){try{const result=await api(path,method,data,revision);await loadWorkspace();return result;}catch(err){if(err.status===409){await loadWorkspace();render();err.message='资料已在其他页面更新，请核对后再保存。';throw err;}throw err;}}
let setupToken=new URLSearchParams(location.hash.slice(1)).get('setup')||'';
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
async function init(){try{S.session=await api('/session');if(S.session.authenticated){await loadWorkspace();render();}else renderAuth();}catch(err){app.innerHTML=`<div class="error-page">${icon('server',32)}<h1>暂时无法连接</h1><p>${e(err.message)}</p>${action('retry','重新连接','refresh','button primary')}</div>`;}}
function renderAuth(){clearCredentialViews();const setup=S.session?.setupRequired;app.innerHTML=`<div class="auth"><section class="auth-story">${brand}<div class="auth-copy"><div class="eyebrow">A QUIETER WAY TO MANAGE</div><h1>每一台服务器，<br><span>都井然有序。</span></h1><p>资产、账单与连接信息，集中在你的私人空间。让基础设施管理，变得简单而从容。</p></div><div class="auth-story-foot">SELF-HOSTED · PRIVATE · ALWAYS YOURS</div></section><main class="auth-main"><div class="auth-box"><div class="auth-badge">${icon('shield',15)} 私人资产管理台</div><h1>${setup?'创建你的管理账户':'欢迎回来'}</h1><p class="subtitle">${setup?'只需完成首次设置，即可开始管理资产。请使用独立的管理密码。':'登录后，继续管理你的服务器与日常开销。'}</p><form data-form="${setup?'setup':'login'}"><div class="form-error" role="alert"></div>${setup&&!setupToken?field('token','首次设置令牌','','text','由部署者提供的初始化令牌',true):''}${field('username','用户名','','text','3–40 位字母、数字、横线或下划线',true,'autocomplete="username" minlength="3" maxlength="40"')}${field('password','密码','','password',setup?'至少 14 位，使用独立密码':'输入管理密码',true,`autocomplete="${setup?'new-password':'current-password'}" minlength="${setup?14:1}" maxlength="128"`)}${setup?field('confirmPassword','确认密码','','password','再次输入密码',true,'autocomplete="new-password" minlength="14" maxlength="128"'):field('otp','动态验证码 / 恢复码','','text','未开启双重验证时留空',false,'autocomplete="one-time-code" maxlength="64"')}<button class="button primary" type="submit">${setup?'创建账户并进入':'安全登录'}${icon('arrow',16)}</button></form><p class="auth-foot">数据仅存储在你部署的服务器上<br>请勿使用服务器的 root 登录密码作为管理密码。</p></div></main></div>`;}
const navItems=[['overview','资产总览','overview'],['servers','服务器','server'],['providers','服务商','globe'],['custom-monthly','自定义月付','wallet'],['renewals','续费日程','calendar'],['commands','指令库','terminal'],['backups','数据备份','shield'],['settings','系统设置','settings']];
function render(){clearCredentialViews();if(!S.session?.authenticated)return renderAuth();const account=S.session.account||{};const current=navItems.find(x=>x[0]===S.page);app.innerHTML=`<div class="shell"><aside class="sidebar">${brand}${action('menu-close','<span class="sr-only">收起导航</span>','close','icon-button mobile-close')}<div class="nav-label">资产管理</div><nav class="nav" aria-label="主导航">${navItems.map(([key,title,ico],index)=>`${index===3?'<div class="nav-section-label">账单与工具</div>':index===6?'<div class="nav-section-label">安全与设置</div>':''}<button data-nav="${key}" class="${key===S.page?'active':''}" ${key===S.page?'aria-current="page"':''}>${icon(ico)}${title}${key==='servers'?`<span class="nav-count">${S.workspace.servers.length}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="private-note"><div class="note-title">${icon('shield',14)} 私人工作空间</div>你的资产资料由你掌控。<br>登录后可直接查看已保存的密码。</div><div class="account"><div class="avatar">${e((account.username||'A').slice(0,1).toUpperCase())}</div><div><div class="account-name">${e(account.username||'管理员')}</div><div class="account-sub">${account.totpEnabled?'双重验证已开启':'管理账户'}</div></div>${action('logout','<span class="sr-only">退出登录</span>','logout','icon-button')}</div></div></aside><div class="main"><header class="topbar"><div class="breadcrumb">${action('menu','<span class="sr-only">展开导航</span>','menu','icon-button mobile-menu')}<span class="home-crumb">工作空间</span><span class="home-crumb">/</span><strong>${current[1]}</strong></div><div class="topbar-right"><span class="date">${new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><span class="live-tag"><span class="dot"></span>已连接</span>${action('refresh','<span class="sr-only">刷新资料</span>','refresh','icon-button')}</div></header><main class="page" id="page-content">${({overview:overviewPage,servers:serversPage,providers:providersPage,'custom-monthly':customMonthlyPage,renewals:renewalsPage,commands:commandsPage,backups:backupsPage,settings:settingsPage}[S.page])()}</main></div></div>`;document.title=`${current[1]} · VPS 管家`;if(S.page==='backups'&&!S.backups&&!backupLoading)loadBackups();}
function pageHead(title,subtitle,eyebrow,buttons=''){return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${buttons?`<div class="head-actions">${buttons}</div>`:''}</div>`;}
function empty(title,description,ico='server',button=''){return `<div class="empty"><div class="empty-icon">${icon(ico,25)}</div><h3>${title}</h3><p>${description}</p>${button}</div>`;}
function stat(label,value,hint,ico){return `<div class="stat"><div class="stat-top">${label}${icon(ico,19)}</div><div class="stat-value">${value}</div><div class="stat-bottom">${hint}</div></div>`;}
function finance(){const c=S.workspace.costs;return `<div class="finance-heading"><h2>费用概览</h2>${action('cost-servers','选择统计服务器','settings','button small-button cost-selection-trigger')}</div><div class="finance"><article class="finance-card featured"><div class="finance-label">${icon('wallet',15)} 月付开销</div><div class="money"><span class="currency">¥</span>${money(c.monthlyTotal)}<span class="money-unit">/ 月</span></div><p class="finance-hint">参与统计的服务器折算后的每月开销</p></article><article class="finance-card"><div class="finance-label">${icon('calendar',15)} 年付开销</div><div class="money"><span class="currency">¥</span>${money(c.yearlyTotal)}<span class="money-unit">/ 年</span></div><p class="finance-hint">参与统计的服务器折算后的每年开销</p></article><article class="finance-card"><div class="finance-label">${icon('overview',15)} 总资产金额</div><div class="money"><span class="currency">¥</span>${money(c.recordedTotal)}</div><p class="finance-hint">参与统计的服务器单期价格合计</p></article></div><div class="finance-note"><div class="finance-note-copy">${icon('info',12)}<span>按参考汇率折算人民币，供预算参考。${costScopeNote()}</span></div></div>`;}
function serverRow(s){return `<div class="list-row" role="button" tabindex="0" data-action="detail" data-id="${e(s.id)}"><div class="server-glyph">${icon('server',19)}</div><div class="row-copy"><div class="row-title">${e(s.name)}</div><div class="row-sub">${e(s.provider||'未设置服务商')} · ${e(s.ipAddress||'未记录 IP')}</div></div><div class="row-end">${badge(s.status)}<div class="row-sub">${price(s)}</div></div></div>`;}
function renewalRow(s){const d=daysLeft(s),date=calendarDate(s.renewalDate||s.renewalDateText);return `<div class="list-row" role="button" tabindex="0" data-action="detail" data-id="${e(s.id)}"><div class="timeline-date"><strong>${date.getDate()}</strong>${date.getMonth()+1} 月</div><div class="row-copy"><div class="row-title">${e(s.name)}</div><div class="row-sub">${e(s.provider||'未设置服务商')} · ${s.autoRenew?'自动续费':'手动续费'} · ${reminderBadge(s)}</div></div><div class="row-end"><span class="status ${d<0?'danger':d<=7?'warning':'stopped'}">${e(dueText(s))}</span><div class="row-sub">${price(s)}</div></div></div>`;}
function overviewPage(){const all=S.workspace.servers,due=all.filter(s=>daysLeft(s)!==null&&daysLeft(s)<=30).sort((a,b)=>daysLeft(a)-daysLeft(b));return pageHead('资产总览','你的基础设施，一目了然。','OVERVIEW',action('server-new','添加服务器','plus','button primary'))+`<div class="stats">${stat('服务器',all.length,'全部资产','server')}${stat('运行中',all.filter(s=>s.status==='online').length,'按记录状态','pulse')}${stat('待续费',due.length,'30 天内或已到期','calendar')}${stat('绑定域名',all.reduce((n,s)=>n+(s.domains?.length||0),0),'已记录的域名','globe')}</div>`+finance()+`<div class="overview-grid"><section class="panel"><div class="panel-head"><div class="panel-title"><h2>我的服务器</h2><span class="count-label">${all.length}</span></div><button class="text-button" data-nav="servers">查看全部 ${icon('arrow',14)}</button></div>${all.length?[...all].sort((a,b)=>Number(b.isPinned)-Number(a.isPinned)).slice(0,5).map(serverRow).join(''):empty('从第一台服务器开始','添加服务器后，即可在这里查看资产、状态与费用。','server',action('server-new','添加服务器','plus','button small-button'))}</section><section class="panel"><div class="panel-head"><h2>近期续费</h2><button class="text-button" data-nav="renewals">查看日程 ${icon('arrow',14)}</button></div>${due.length?due.slice(0,5).map(renewalRow).join(''):empty('近期没有续费事项','填写服务器的续费日期，我们会在这里整理即将到期的资产。','calendar')}</section></div><div class="bottom-note">${icon('shield',13)} 私人资产空间 · 状态与费用来自你记录的资料</div>`;}
function searchBox(placeholder){return `<label class="search">${icon('search',17)}<span class="sr-only">${placeholder}</span><input class="input" id="search" type="search" value="${e(S.query)}" placeholder="${placeholder}" autocomplete="off"></label>`;}
function providerKey(server){return String(server.provider||'').trim();}
function providerLabel(name){return name||'未设置服务商';}
function providerLink(server){return action('provider-open',e(providerLabel(providerKey(server))),'','provider-link',providerKey(server));}
function providerGroups(){
 const groups=new Map();
 for(const server of S.workspace.servers){const name=providerKey(server);if(!groups.has(name))groups.set(name,{name,servers:[]});groups.get(name).servers.push(server);}
 return [...groups.values()].sort((a,b)=>b.servers.length-a.servers.length||a.name.localeCompare(b.name,'zh-CN'));
}
function openProvider(name){if(dialog.open&&closeDialog()===false)return;S.page='providers';S.provider=name;S.query='';S.status='';render();window.scrollTo?.({top:0,behavior:'instant'});}
function providerResults(){
 const query=S.query.trim().toLowerCase();
 const groups=providerGroups().filter(group=>[providerLabel(group.name),...group.servers.flatMap(s=>[s.name,s.ipAddress,s.region,...(s.tags||[])])].join(' ').toLowerCase().includes(query));
 if(!groups.length)return `<section class="panel">${empty(S.workspace.servers.length?'没有匹配的服务商':'从第一台机器开始',S.workspace.servers.length?'试试服务商名称、机器名称或 IP。':'添加服务器并填写服务商，同一商家的机器会自动归到一起。','globe',S.workspace.servers.length?'':action('server-new','添加服务器','plus','button primary'))}</section>`;
 return `<div class="provider-grid">${groups.map(group=>`<button type="button" class="provider-card" data-action="provider-open" data-id="${e(group.name)}"><div class="provider-card-head"><span class="server-glyph">${icon('globe',22)}</span>${icon('arrow',18)}</div><h2 class="provider-name">${e(providerLabel(group.name))}</h2><p class="provider-meta">${group.servers.length} 台服务器 · ${group.servers.filter(s=>s.status==='online').length} 台运行中</p><p class="provider-preview">${e(group.servers.slice(0,3).map(s=>s.name).join(' / '))}${group.servers.length>3?' …':''}</p><div class="provider-card-foot"><span>${icon('server',15)} 查看机器与账单</span>${icon('chevron',15)}</div></button>`).join('')}</div>`;
}
function providersPage(){
 if(S.provider===null)return pageHead('服务商','同一商家的多台机器，集中在一页管理。','PROVIDERS',action('server-new','添加服务器','plus','button primary'))+`<div class="toolbar">${searchBox('搜索服务商、机器名称或 IP')}<span class="count-label">${providerGroups().length} 组 · ${S.workspace.servers.length} 台机器</span></div><div id="results">${providerResults()}</div>`;
 const records=S.workspace.servers.filter(s=>providerKey(s)===S.provider);
 const due=records.filter(s=>{const days=daysLeft(s);return days!==null&&days>=0&&days<=7;}).length;
 return `<div class="provider-workspace">${action('provider-back','全部服务商','arrow','text-button provider-back')}`+pageHead(e(providerLabel(S.provider)),S.provider?'这个商家的每台机器，都有独立的连接资料与续费记录。':'为机器填写相同服务商名称，即可集中管理。','PROVIDER',action('provider-server-new',S.provider?'添加该商家机器':'添加机器','plus','button primary'))+`<div class="provider-summary"><div class="provider-summary-item"><span>机器数量</span><strong>${records.length}<small> 台</small></strong></div><div class="provider-summary-item"><span>运行中</span><strong>${records.filter(s=>s.status==='online').length}<small> 台</small></strong></div><div class="provider-summary-item"><span>未来 7 天到期</span><strong>${due}<small> 台</small></strong></div></div>`+serverToolbar()+`<div id="results">${serverResults()}</div></div>`;
}
function filteredServers(){const q=S.query.toLowerCase();return S.workspace.servers.filter(s=>(S.page!=='providers'||S.provider===null||providerKey(s)===S.provider)&&(!S.status||s.status===S.status)&&[s.name,s.ipAddress,s.provider,s.region,...(s.tags||[])].join(' ').toLowerCase().includes(q)).sort((a,b)=>Number(b.isPinned)-Number(a.isPinned));}
function serverToolbar(){return `<div class="toolbar">${searchBox('搜索名称、IP、服务商或标签')}<div class="toolbar-right"><select class="input" id="status-filter" aria-label="筛选服务器状态"><option value="">全部状态</option>${Object.entries(statusMap).map(([v,[l]])=>`<option value="${v}" ${S.status===v?'selected':''}>${l}</option>`).join('')}</select><div class="segmented" aria-label="显示方式">${action('view-table','<span class="sr-only">列表视图</span>','list',S.view==='table'?'active':'')}${action('view-cards','<span class="sr-only">卡片视图</span>','overview',S.view==='cards'?'active':'')}</div></div></div>`;}
function serversPage(){return pageHead('服务器','每一份资产，都有清晰的归属。','SERVERS',action('provider-back','按服务商查看','globe','button')+action('server-new','添加服务器','plus','button primary'))+serverToolbar()+`<div id="results">${serverResults()}</div>`;}
function serverResults(){const records=filteredServers();if(!records.length){const grouped=S.page==='providers'&&S.provider!==null,hasRecords=grouped?S.workspace.servers.some(s=>providerKey(s)===S.provider):S.workspace.servers.length;return `<section class="panel">${empty(hasRecords?'没有匹配的服务器':grouped?'这个服务商还没有机器':'你的服务器空间已就绪',hasRecords?'试试其他关键词或状态。':grouped?'点击添加，为这个商家记录一台机器。':'添加第一台服务器，把连接信息、账单和续费日期妥善记录。','server',hasRecords?'':action(grouped?'provider-server-new':'server-new','添加服务器','plus','button primary'))}</section>`;}if(S.view==='cards')return `<div class="server-cards">${records.map(s=>`<article class="server-card" role="button" tabindex="0" data-action="detail" data-id="${e(s.id)}"><div class="server-card-top"><div class="server-glyph">${icon('server')}</div><div class="row-copy"><div class="row-title">${e(s.name)}</div><div class="row-sub">${e(s.provider||'未设置服务商')}</div></div>${badge(s.status)}</div><dl class="card-info"><div><dt>IP 地址</dt><dd class="mono">${e(s.ipAddress||'—')}</dd></div><div><dt>所在区域</dt><dd>${e(s.region||'—')}</dd></div><div><dt>配置 / 套餐</dt><dd>${e(s.plan||'—')}</dd></div><div><dt>续费日期</dt><dd>${shortDate(s.renewalDate||s.renewalDateText)} ${reminderBadge(s)}</dd></div></dl><div class="card-footer"><div class="card-price">${price(s)}</div>${icon('arrow',15)}</div></article>`).join('')}</div>`;return `<section class="panel table-wrap"><table class="server-table"><thead><tr><th>服务器 / 服务商</th><th>IP 地址</th><th>状态</th><th>单期账单</th><th>续费日期</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${records.map(s=>`<tr><td><div class="table-name"><div class="server-glyph">${icon('server',17)}</div><div class="row-copy"><button data-action="detail" data-id="${e(s.id)}" class="row-title">${e(s.name)}</button><div class="row-sub">${providerLink(s)}${s.isPinned?' · 置顶':''}</div></div></div></td><td class="mono" data-label="IP 地址">${e(s.ipAddress||'—')}</td><td data-label="状态">${badge(s.status)}</td><td data-label="单期账单">${price(s)}</td><td data-label="续费日期">${shortDate(s.renewalDate||s.renewalDateText)}<div class="row-sub">${e(dueText(s))} · ${reminderBadge(s)}</div></td><td>${action('server-edit','<span class="sr-only">编辑 '+e(s.name)+'</span>','edit','icon-button',s.id)}</td></tr>`).join('')}</tbody></table></section>`;}
function renewalsPage(){const dated=S.workspace.servers.filter(s=>daysLeft(s)!==null).sort((a,b)=>daysLeft(a)-daysLeft(b));const groups=[['已到期',dated.filter(s=>daysLeft(s)<0)],['未来 30 天',dated.filter(s=>daysLeft(s)>=0&&daysLeft(s)<=30)],['之后的日程',dated.filter(s=>daysLeft(s)>30)]];return pageHead('续费日程','提前安排每一次续费，让服务从容运行。','RENEWALS')+finance()+(dated.length?groups.filter(([,items])=>items.length).map(([name,items])=>`<section class="renewal-group"><h2 class="group-heading">${name}<span class="count-label">${items.length}</span></h2><div class="panel">${items.map(renewalRow).join('')}</div></section>`).join(''):`<section class="panel">${empty('还没有续费日程','为服务器填写续费日期，按时间查看即将到期的资产。','calendar',`<button class="button" data-nav="servers">管理服务器 ${icon('arrow',15)}</button>`)}</section>`);}
function commandsPage(){return pageHead('指令库','把常用操作，整理成随手可用的指令。','COMMAND LIBRARY',action('command-new','添加指令','plus','button primary'))+`<div class="toolbar">${searchBox('搜索指令名称、内容或分类')}<span class="small muted">${S.workspace.commands.length} 条已保存指令</span></div><div id="results">${commandResults()}</div><div class="bottom-note">${icon('info',13)} 指令仅供保存与复制，不会在服务器上自动执行。</div>`;}
function commandResults(){const q=S.query.toLowerCase(),items=S.workspace.commands.filter(c=>[c.title,c.command,c.category,c.note].join(' ').toLowerCase().includes(q));if(!items.length)return `<section class="panel">${empty(S.workspace.commands.length?'没有匹配的指令':'让重复操作，更轻松一点',S.workspace.commands.length?'试试其他关键词。':'保存常用命令和说明，需要时一键复制。','terminal',S.workspace.commands.length?'':action('command-new','添加第一条指令','plus','button'))}</section>`;return `<div class="command-list">${items.map(c=>`<article class="command-card"><div class="command-head"><div><h3>${e(c.title)}</h3><p class="command-description">${e(c.note||'暂无说明')}</p></div>${action('command-edit','<span class="sr-only">编辑指令</span>','edit','icon-button',c.id)}</div><code class="command-code">${e(c.command)}</code><div class="command-footer"><span class="tag">${e(c.category||'通用')}</span>${action('command-copy','复制指令','copy','button small-button',c.id)}</div></article>`).join('')}</div>`;}
function settingsPage(){const account=S.session.account||{},rates=S.workspace.settings.rates||{};return pageHead('系统设置','管理账户安全，以及你的工作空间。','SETTINGS')+`<div class="settings-grid"><section class="panel settings-account"><div class="panel-head"><h2>账户与安全</h2>${icon('shield',20)}</div><div class="settings-body"><div class="setting-row"><div><h3>管理账户</h3><p>${e(account.username||'管理员')}</p></div><span class="tag">私人账户</span></div><div class="setting-row"><div><h3>登录密码</h3><p>独立密码，至少 14 位；修改后其他会话将失效。</p></div>${action('password-change','修改密码','lock','button small-button')}</div><div class="setting-row"><div><h3>双重验证</h3><p>${account.totpEnabled?'已开启。登录与账户安全操作受双重验证保护。':'使用验证器生成动态验证码，进一步保护账户。'}</p></div>${action(account.totpEnabled?'totp-disable':'totp-start',account.totpEnabled?'关闭':'开启','shield','button small-button')}</div><div class="setting-row"><div><h3>自动加密备份</h3><p>每日自动备份，保留最近 7 天；恢复前可核对变化。</p></div><button class="button small-button" data-nav="backups">备份与恢复</button></div><div class="setting-row"><div><h3>结束当前会话</h3><p>使用公用设备后，记得退出登录。</p></div>${action('logout','退出登录','logout','button small-button')}</div></div></section>${telegramSettingsCard()}<section class="panel settings-billing"><div class="panel-head"><h2>费用统计口径</h2>${icon('wallet',20)}</div><div class="settings-body"><div class="info-box">月付与年付为参与统计的服务器折算后的开销。总资产金额为这些服务器单期账单的合计，不代表市场估值。</div>${costSelectionEntry()}<div class="rates">${Object.entries(rates).map(([currency,value])=>`<div class="rate"><span>${e(currency)}</span><strong>¥ ${e(value)}</strong></div>`).join('')}</div><p class="field-hint">参考汇率：${e(S.workspace.settings.rateSource||'应用内固定参考汇率')}。实际扣款以服务商账单为准。</p></div></section></div>`;}

function reminderBadge(server){const selected=server.expiryReminder===true,active=S.workspace.settings.telegram?.enabled&&S.workspace.settings.telegram?.configured;return `<span class="reminder-label ${selected?'selected':''}">${selected?(active?'TG 提醒已选':'TG 已选 · 待开启'):'TG 不提醒'}</span>`;}
function reminderTime(value){const d=new Date(value);return value&&!Number.isNaN(d.valueOf())?d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'暂无';}
function telegramSettingsCard(){
 const t=S.workspace.settings.telegram||{},status=S.workspace.telegramStatus||{},query=S.workspace.telegramQueryStatus||{};
 return `<section class="panel telegram-panel"><div class="panel-head"><h2>Telegram 到期提醒</h2><span class="tag">${t.enabled&&t.configured?'已开启':t.configured?'已暂停':'未配置'}</span></div><div class="settings-body"><div class="setting-row"><div><h3>提前 7 天，提醒一次</h3><p>北京时间 09:00 起检查，每 5 分钟检查一次。每台机器的同一到期日期只提醒一次。</p></div>${action('telegram-settings','配置提醒','settings','button small-button')}</div>${telegramSelectionEntry()}<div class="setting-row"><div><h3>在 Telegram 中查询</h3><p>向机器人私聊发送「检查」或 /check，按竖排列表查看已选机器、到期日期及提醒状态。仅响应配置的接收账号。</p></div></div><p class="field-hint">首次开启或恢复后，距离到期 0–7 天的已选机器会补发一次；已过期的机器不再补发。续费后更新日期，即可进入下一轮提醒。</p><div class="telegram-status"><span>接收 Chat ID：${e(t.chatId||'未设置')}</span><span>Bot Token：${t.hasToken?'已加密保存':'未保存'}</span><span>${status.supervisionEnabled?'后台每 5 分钟检查 · 异常自动恢复':'后台每 5 分钟检查'}</span><span>最近检查：${e(reminderTime(status.lastCheckedAt))}（北京）</span><span>最近发送：${e(reminderTime(status.lastSentAt))}（北京）</span><span>TG 查询：${query.enabled&&query.configured?(query.lastError?'连接待恢复':'已启用'):'等待配置'}</span>${query.lastReplyAt?`<span>最近查询回复：${e(reminderTime(query.lastReplyAt))}（北京）</span>`:''}${status.pendingCount?`<span>待处理 ${e(status.pendingCount)} 条</span>`:''}${status.failedCount?`<span>发送失败 ${e(status.failedCount)} 条。临时错误会自动重试，也可检查配置后手动重试</span>`:''}</div>${status.lastError?`<div class="info-box warning">${e(status.lastError)}</div>`:''}${query.lastError?`<div class="info-box warning">TG 查询：${e(query.lastError)}</div>`:''}${status.uncertainCount||status.failedCount?`<div class="info-box warning"><p>${status.uncertainCount?`上次发送结果无法确认，请先查看 TG，重试可能收到重复消息。共 ${e(status.uncertainCount)} 条。`:'有提醒未发送成功，请检查 Bot Token、Chat ID，并确认已向机器人发送 /start。'}</p>${action('telegram-retry','重试未成功提醒','','button small-button')}</div>`:''}<div class="telegram-actions">${t.configured?action('telegram-test','发送测试消息','arrow','button small-button'):''}</div></div></section>`;
}
const costSelectionStates=new WeakMap();
function costScopeNote(){
 const servers=S.workspace.servers,c=S.workspace.costs,selected=servers.filter(s=>s.excludeFromCosts!==true).length,excluded=servers.length-selected;
 const invalid=Number(c.invalidCostCount??Math.max(0,Number(c.excludedCount||0)-excluded));
 return ` 已选 ${selected} / ${servers.length} 台${excluded?` · 手动排除 ${excluded} 台`:''}。${invalid?`其中 ${invalid} 台账单信息不完整，暂未计入金额。`:''}`;
}
function costSelectionEntry(){
 return `<div class="setting-row cost-selection-entry"><div><h3>参与费用统计的服务器</h3><p>${costScopeNote()}</p></div>${action('cost-servers','选择统计服务器','settings','button small-button')}</div>`;
}
function costSelectionSummary(boxes){const selected=boxes.filter(b=>b.checked).length;return `已选 ${selected} / ${boxes.length} 台 · 排除 ${boxes.length-selected} 台`;}
function costSelectionForm(){
 const servers=S.workspace.servers;
 return `<div class="cost-selection-feedback info-box warning" role="alert" hidden></div><fieldset class="cost-selection-controls"><legend class="sr-only">参与费用统计的服务器</legend><div class="cost-selection-tools"><div>${action('cost-select-all','全选','','button small-button')}${action('cost-select-none','全不选','','button small-button')}</div><span class="field-hint">勾选即参与统计</span></div><div class="cost-machine-list">${servers.length?servers.map(server=>`<label class="cost-machine-row"><input type="checkbox" name="costServerIds" value="${e(server.id)}" ${server.excludeFromCosts!==true?'checked':''}><span class="cost-machine-copy"><strong>${e(server.name||'未命名服务器')}</strong><span>${e(server.provider||'未设置服务商')}</span></span><span class="cost-machine-price">${price(server)}</span></label>`).join(''):'<p class="cost-selection-empty">暂无服务器，添加后默认参与费用统计。</p>'}</div></fieldset><p class="field-hint cost-selection-count" data-cost-selection-count aria-live="polite">${costSelectionSummary(servers.map(s=>({checked:s.excludeFromCosts!==true})))}</p><p class="field-hint cost-selection-note">取消勾选后，该服务器不计入月付开销、年付开销和总资产金额。服务器资料与到期提醒保持不变；新添加的服务器默认参与统计。</p>`;
}
function costSelectionDialog(){
 showDialog('选择统计服务器','选择哪些服务器计入费用，保存后同时更新三项金额。',costSelectionForm(),`${action('dialog-close','取消','','button')}<button class="button primary" type="submit" ${S.workspace.servers.length?'':'disabled'}>${icon('check',15)}保存选择</button>`,'cost-servers');
 const form=$('form',dialog);form.dataset.revision=String(S.revision);costSelectionStates.set(form,{revision:S.revision,busy:false,conflicted:false,saved:false,session:S.session});
}
function costSelectionState(form){
 let state=costSelectionStates.get(form);
 if(!state){state={revision:Number(form.dataset.revision),busy:false,conflicted:false,saved:false,session:S.session};costSelectionStates.set(form,state);}
 if(!Number.isSafeInteger(state.revision)||state.revision<0)throw new Error('选择状态已失效，请关闭后重新打开。');
 return state;
}
function updateCostSelectionCount(form){$('[data-cost-selection-count]',form).textContent=costSelectionSummary([...form.querySelectorAll('input[name="costServerIds"]')]);}
function selectCostServers(form,checked){
 const state=costSelectionState(form);if(state.busy||state.conflicted||state.saved)return;
 for(const box of form.querySelectorAll('input[name="costServerIds"]'))box.checked=checked;
 updateCostSelectionCount(form);
}
function lockCostSelection(form,state){
 $('.cost-selection-controls',form).disabled=state.busy||state.conflicted||state.saved;
 for(const button of form.querySelectorAll('[data-action="dialog-close"], [data-action="cost-selection-reload"], button[type="submit"]'))button.disabled=state.busy||(button.type==='submit'&&(state.conflicted||state.saved||!form.querySelectorAll('input[name="costServerIds"]').length));
 form.setAttribute?.('aria-busy',String(state.busy));
}
function costSelectionFeedback(form,message,label='重新加载最新选择'){
 const panel=$('.cost-selection-feedback',form);panel.hidden=false;panel.innerHTML=`<p>${e(message)}</p>${action('cost-selection-reload',label,'refresh','button small-button')}`;panel.scrollIntoView({block:'nearest'});
}
function currentCostSelection(form,state){return S.session===state.session&&S.session?.authenticated&&dialog.open&&$('form',dialog)===form;}
async function reloadCostSelection(form){
 const state=costSelectionState(form);if(state.busy)return;
 state.busy=true;lockCostSelection(form,state);
 try{
  await loadWorkspace();if(!currentCostSelection(form,state))return;
  render();state.busy=false;
  if(state.saved){closeDialog();toast('费用选择已保存，统计金额已更新');}else{costSelectionDialog();toast('已加载最新选择，请重新勾选并保存');}
 }finally{state.busy=false;lockCostSelection(form,state);if(S.session!==state.session&&$('form',dialog)===form)closeDialog();}
}
async function saveCostSelection(form){
 const state=costSelectionState(form);if(state.busy)return false;
 if(state.saved)throw new Error('选择已经保存，请重新加载统计结果。');
 if(state.conflicted)throw new Error('请先重新加载最新选择，再勾选并保存。');
 const serverIds=[...form.querySelectorAll('input[name="costServerIds"]')].filter(box=>box.checked).map(box=>box.value);
 state.busy=true;lockCostSelection(form,state);
 try{
  try{await api('/settings/costs/servers','PUT',{serverIds},state.revision);}
  catch(err){
   if(!currentCostSelection(form,state))throw err;
   if(err.status===409){state.conflicted=true;costSelectionFeedback(form,'资料已在其他页面更新。当前勾选仍保留，尚未保存。请重新加载最新选择，再勾选并保存；重新加载会替换当前未保存的勾选。');return false;}
   if(!err.status){state.conflicted=true;costSelectionFeedback(form,'暂时无法确认保存结果，当前勾选仍保留。请重新加载最新选择，核对服务器上实际保存的内容后再操作。');return false;}
   throw err;
  }
  state.saved=true;
  if(!currentCostSelection(form,state))return false;
  try{await loadWorkspace();}catch(err){if(currentCostSelection(form,state))costSelectionFeedback(form,'选择已保存，但页面金额暂未刷新成功。请重新加载统计结果，无需重复保存。','重新加载统计结果');else throw err;return true;}
  if(!currentCostSelection(form,state))return false;
  render();state.busy=false;closeDialog();toast('费用选择已保存，三项金额已更新');return true;
 }finally{state.busy=false;lockCostSelection(form,state);if(S.session!==state.session&&$('form',dialog)===form)closeDialog();}
}
function customMonthlyPage(){
 const stats=S.workspace.customMonthly||{},ids=new Set(stats.serverIds||[]),records=S.workspace.servers.filter(s=>ids.has(s.id));
 const rows=new Map((stats.rows||[]).map(row=>[row.id,row.monthlyTotal]));
 const invalid=Number(stats.invalidCostCount||0);
 const amount=value=>typeof value==='number'&&Number.isFinite(value)?`<strong>¥ ${money(value)}</strong><span>/ 月</span>`:'<span class="custom-monthly-unpriced">未计入</span>';
 return pageHead('自定义月付','单独统计自选服务器的月付。','CUSTOM MONTHLY',action('custom-monthly-servers','选择服务器','plus','button primary'))+`<div class="custom-monthly-summary"><article class="finance-card featured custom-monthly-total"><div class="finance-label">${icon('wallet',17)} 自选服务器月付开销</div><div class="money"><span class="currency">¥</span>${money(stats.monthlyTotal)}<span class="money-unit">/ 月</span></div><p class="finance-hint">季付、年付账单按月折算，统一以人民币汇总</p></article><section class="panel custom-monthly-scope"><div class="custom-monthly-metrics"><div><span>已选服务器</span><strong>${records.length}<small>台</small></strong></div><div><span>暂未计入</span><strong>${invalid}<small>台</small></strong></div></div><p>${invalid?'部分已选服务器的账单信息不完整，补全后将自动计入。':'已选服务器填写有效账单后，费用会自动更新。'}</p></section></div><div class="custom-monthly-note">${icon('info',14)}<span>此页选择单独保存，首页继续使用首页的统计范围。金额按参考汇率折算，供预算参考。</span></div><section class="panel custom-monthly-details"><div class="panel-head"><div class="panel-title"><h2>月付明细</h2><span class="count-label">${records.length}</span></div><span class="field-hint">点击服务器查看资料</span></div>${records.length?`<div class="custom-monthly-list-head" aria-hidden="true"><span>服务器 / 服务商</span><span>原始账单</span><span>折合月付</span><span></span></div>${records.map(server=>`<div class="custom-monthly-row" role="button" tabindex="0" data-action="detail" data-id="${e(server.id)}"><div class="custom-monthly-machine"><div class="server-glyph">${icon('server',18)}</div><div class="row-copy"><div class="row-title">${e(server.name)}</div><div class="row-sub">${e(server.provider||'未设置服务商')}</div></div></div><div class="custom-monthly-bill"><span class="custom-monthly-cell-label">原始账单</span>${price(server)}</div><div class="custom-monthly-amount"><span class="custom-monthly-cell-label">折合月付</span><div>${amount(rows.get(server.id))}</div></div>${icon('chevron',15)}</div>`).join('')}`:empty('先选择一组服务器','可以自由组合服务器，单独查看它们每月需要多少预算。','wallet',action('custom-monthly-servers','选择服务器','plus','button primary'))}</section>`;
}
const customMonthlySelectionStates=new WeakMap();
function customMonthlySelectionSummary(boxes){const selected=boxes.filter(b=>b.checked).length;return `已选 ${selected} / ${boxes.length} 台`;}
function customMonthlySelectionForm(){
 const servers=S.workspace.servers,selected=new Set(S.workspace.customMonthly?.serverIds||[]);
 return `<div class="cost-selection-feedback info-box warning" role="alert" hidden></div><fieldset class="cost-selection-controls"><legend class="sr-only">自定义月付的服务器</legend><div class="cost-selection-tools"><div>${action('custom-monthly-select-all','全选','','button small-button')}${action('custom-monthly-select-none','全不选','','button small-button')}</div><span class="field-hint">勾选加入此页统计</span></div><div class="cost-machine-list">${servers.length?servers.map(server=>`<label class="cost-machine-row"><input type="checkbox" name="customMonthlyServerIds" value="${e(server.id)}" ${selected.has(server.id)?'checked':''}><span class="cost-machine-copy"><strong>${e(server.name||'未命名服务器')}</strong><span>${e(server.provider||'未设置服务商')}</span></span><span class="cost-machine-price">${price(server)}</span></label>`).join(''):'<p class="cost-selection-empty">暂无服务器，添加后可在这里选择。</p>'}</div></fieldset><p class="field-hint cost-selection-count" data-cost-selection-count aria-live="polite">${customMonthlySelectionSummary(servers.map(s=>({checked:selected.has(s.id)})))}</p><p class="field-hint cost-selection-note">此页只计算勾选服务器的折合月付，选择单独保存。新添加的服务器需要在这里勾选加入。</p>`;
}
function customMonthlySelectionDialog(){
 showDialog('自定义月付的服务器','自由选择服务器，单独计算这一组的每月开销。',customMonthlySelectionForm(),`${action('dialog-close','取消','','button')}<button class="button primary" type="submit" ${S.workspace.servers.length?'':'disabled'}>${icon('check',15)}保存选择</button>`,'custom-monthly-servers');
 const form=$('form',dialog);form.dataset.revision=String(S.revision);customMonthlySelectionStates.set(form,{revision:S.revision,busy:false,conflicted:false,saved:false,session:S.session,page:S.page});
}
function customMonthlySelectionState(form){
 let state=customMonthlySelectionStates.get(form);
 if(!state){state={revision:Number(form.dataset.revision),busy:false,conflicted:false,saved:false,session:S.session,page:S.page};customMonthlySelectionStates.set(form,state);}
 if(!Number.isSafeInteger(state.revision)||state.revision<0)throw new Error('选择状态已失效，请关闭后重新打开。');
 return state;
}
function updateCustomMonthlySelectionCount(form){$('[data-cost-selection-count]',form).textContent=customMonthlySelectionSummary([...form.querySelectorAll('input[name="customMonthlyServerIds"]')]);}
function selectCustomMonthlyServers(form,checked){
 const state=customMonthlySelectionState(form);if(state.busy||state.conflicted||state.saved)return;
 for(const box of form.querySelectorAll('input[name="customMonthlyServerIds"]'))box.checked=checked;
 updateCustomMonthlySelectionCount(form);
}
function lockCustomMonthlySelection(form,state){
 $('.cost-selection-controls',form).disabled=state.busy||state.conflicted||state.saved;
 for(const button of form.querySelectorAll('[data-action="dialog-close"], [data-action="custom-monthly-selection-reload"], button[type="submit"]'))button.disabled=state.busy||(button.type==='submit'&&(state.conflicted||state.saved||!form.querySelectorAll('input[name="customMonthlyServerIds"]').length));
 form.setAttribute?.('aria-busy',String(state.busy));
}
function customMonthlySelectionFeedback(form,message,label='重新加载最新选择'){
 const panel=$('.cost-selection-feedback',form);panel.hidden=false;panel.innerHTML=`<p>${e(message)}</p>${action('custom-monthly-selection-reload',label,'refresh','button small-button')}`;panel.scrollIntoView({block:'nearest'});
}
function currentCustomMonthlySelection(form,state){return S.session===state.session&&S.session?.authenticated&&S.page===state.page&&dialog.open&&$('form',dialog)===form;}
async function reloadCustomMonthlySelection(form){
 const state=customMonthlySelectionState(form);if(state.busy)return;
 state.busy=true;lockCustomMonthlySelection(form,state);
 try{
  if(!await loadCustomMonthlyWorkspace(form,state))return;
  render();state.busy=false;
  if(state.saved){closeDialog();toast('自定义选择已保存，月付金额已更新');}else{customMonthlySelectionDialog();toast('已加载最新选择，请重新勾选并保存');}
 }finally{state.busy=false;lockCustomMonthlySelection(form,state);if(S.session!==state.session&&$('form',dialog)===form)closeDialog();}
}
async function saveCustomMonthlySelection(form){
 const state=customMonthlySelectionState(form);if(state.busy)return false;
 if(state.saved)throw new Error('选择已经保存，请重新加载统计结果。');
 if(state.conflicted)throw new Error('请先重新加载最新选择，再勾选并保存。');
 const serverIds=[...form.querySelectorAll('input[name="customMonthlyServerIds"]')].filter(box=>box.checked).map(box=>box.value);
 state.busy=true;lockCustomMonthlySelection(form,state);
 try{
  try{await api('/settings/custom-monthly/servers','PUT',{serverIds},state.revision);}
  catch(err){
   if(!currentCustomMonthlySelection(form,state))throw err;
   if(err.status===409){state.conflicted=true;customMonthlySelectionFeedback(form,'资料已在其他页面更新。当前勾选仍保留，尚未保存。请重新加载最新选择，再勾选并保存；重新加载会替换当前未保存的勾选。');return false;}
   if(!err.status){state.conflicted=true;customMonthlySelectionFeedback(form,'暂时无法确认保存结果，当前勾选仍保留。请重新加载最新选择，核对服务器上实际保存的内容后再操作。');return false;}
   throw err;
  }
  state.saved=true;
  if(!currentCustomMonthlySelection(form,state))return false;
  try{if(!await loadCustomMonthlyWorkspace(form,state))return false;}catch(err){if(currentCustomMonthlySelection(form,state))customMonthlySelectionFeedback(form,'选择已保存，但页面金额暂未刷新成功。请重新加载统计结果，无需重复保存。','重新加载统计结果');else throw err;return true;}
  if(!currentCustomMonthlySelection(form,state))return false;
  render();state.busy=false;closeDialog();toast('自定义选择已保存，月付金额已更新');return true;
 }finally{state.busy=false;lockCustomMonthlySelection(form,state);if(S.session!==state.session&&$('form',dialog)===form)closeDialog();}
}
async function loadCustomMonthlyWorkspace(form,state){const workspace=await api('/workspace');if(!currentCustomMonthlySelection(form,state))return false;workspace.servers ||= [];workspace.commands ||= [];workspace.settings ||= {};workspace.costs ||= {};S.workspace=workspace;S.revision=workspace.revision;return true;}
const telegramSelectionStates=new WeakMap();
function telegramSelectionSummary(boxes){
 const selected=boxes.filter(b=>b.checked),undated=selected.filter(b=>b.dataset.undated==='true').length;
 return `已选择 ${selected.length} 台 / 共 ${boxes.length} 台${undated?`，其中 ${undated} 台未填写有效续费日期`:''}`;
}
function telegramSelectionEntry(){
 const servers=S.workspace.servers,selected=servers.filter(s=>s.expiryReminder===true),undated=selected.filter(s=>daysLeft(s)===null).length;
 return `<div class="setting-row telegram-selection-entry"><div><h3>需要提醒的机器 <span class="telegram-selection-badge">${selected.length} / ${servers.length}</span></h3><p>已选择 ${selected.length} 台${undated?` · ${undated} 台未填写有效续费日期`:''}。点击选择后统一确认。</p></div>${action('telegram-servers','选择机器','server','button small-button')}</div>`;
}
function telegramSelectionForm(){
 const servers=S.workspace.servers,t=S.workspace.settings.telegram||{};
 const summary=telegramSelectionSummary(servers.map(s=>({checked:s.expiryReminder===true,dataset:{undated:String(daysLeft(s)===null)}})));
 return `<div class="telegram-selection-conflict info-box warning" role="alert" hidden></div><fieldset class="telegram-selection-controls"><legend class="sr-only">需要 Telegram 到期提醒的机器</legend><div class="telegram-selection-tools"><div>${action('telegram-select-all','全选','','button small-button')}${action('telegram-select-none','全不选','','button small-button')}</div><span class="field-hint">点击整行勾选</span></div><div class="telegram-machine-list">${servers.length?servers.map(server=>{
  const undated=daysLeft(server)===null;
  return `<label class="telegram-machine-row"><input type="checkbox" name="serverIds" value="${e(server.id)}" data-undated="${undated}" ${server.expiryReminder===true?'checked':''}><span class="telegram-machine-copy"><strong>${e(server.name||'未命名机器')}</strong><span>${e(server.provider||'未设置服务商')}</span></span><span class="telegram-machine-date ${undated?'telegram-machine-warning':''}">${undated?'未填写续费日期':`到期：${e(shortDate(server.renewalDate||server.renewalDateText))}`}</span></label>`;
 }).join(''):'<p class="telegram-selection-empty">暂无机器，添加服务器后即可在这里选择。</p>'}</div></fieldset><p class="field-hint telegram-selection-count" data-selection-count aria-live="polite">${summary}</p><p class="field-hint telegram-selection-note">${!t.configured?'提醒配置尚未完成，保存选择后暂时无法发送 TG 确认。请到「配置提醒」填写 Bot Token 和 Chat ID。':!t.enabled?'提醒总开关尚未开启。选择仍会保存并发送 TG 确认，开启总开关后才会发送到期提醒。':'点击「确定选择」后保存，并向你的 TG 发送一条确认消息。'} 未填写有效续费日期的机器暂不发送到期提醒。</p>`;
}
function telegramSelectionDialog(){
 showDialog('选择提醒机器','勾选需要到期提醒的机器，确认后会给你的 TG 发一条消息。',telegramSelectionForm(),`${action('dialog-close','取消','','button')}<button class="button primary" type="submit" ${S.workspace.servers.length?'':'disabled'}>${icon('check',15)}确定选择</button>`,'telegram-servers');
 const form=$('form',dialog);form.dataset.revision=String(S.revision);telegramSelectionStates.set(form,{revision:S.revision,busy:false,conflicted:false,confirmationId:null,selectionKey:null});
}
function telegramSelectionState(form){
 let state=telegramSelectionStates.get(form);
 if(!state){state={revision:Number(form.dataset.revision),busy:false,conflicted:false,confirmationId:null,selectionKey:null};telegramSelectionStates.set(form,state);}
 if(!Number.isSafeInteger(state.revision)||state.revision<0)throw new Error('选择状态已失效，请刷新页面后重试。');
 return state;
}
function updateTelegramSelectionCount(form){
 const boxes=[...form.querySelectorAll('input[name="serverIds"]')];
 $('[data-selection-count]',form).textContent=telegramSelectionSummary(boxes);
}
function selectTelegramServers(form,checked){
 const state=telegramSelectionState(form);if(state.busy||state.conflicted)return;
 for(const box of form.querySelectorAll('input[name="serverIds"]'))box.checked=checked;
 updateTelegramSelectionCount(form);
}
function showTelegramSelectionConflict(form,state){
 state.conflicted=true;
 const panel=$('.telegram-selection-conflict',form);panel.hidden=false;
 panel.innerHTML=`<p>资料已在其他页面更新。你刚才的勾选仍保留，但尚未保存。请重新加载最新选择，再勾选并确认；重新加载会替换此处的未保存勾选。</p>${action('telegram-selection-reload','重新加载最新选择','refresh','button small-button')}`;
 $('.telegram-selection-controls',form).disabled=true;
 panel.scrollIntoView({block:'nearest'});
}
function lockTelegramSelection(form,state){
 $('.telegram-selection-controls',form).disabled=state.busy||state.conflicted;
 for(const button of form.querySelectorAll('[data-action="dialog-close"], button[type="submit"]'))button.disabled=state.busy||(button.type==='submit'&&state.conflicted);
 form.setAttribute?.('aria-busy',String(state.busy));
}
async function reloadTelegramSelection(form){
 const state=telegramSelectionState(form);if(state.busy)return;
 state.busy=true;lockTelegramSelection(form,state);
 try{await loadWorkspace();render();state.busy=false;telegramSelectionDialog();toast('已加载最新选择，请重新勾选并确认');}finally{state.busy=false;lockTelegramSelection(form,state);}
}
function telegramSelectionResult(result,refreshFailed=false){
 const status=result.confirmation?.status||'uncertain';
 const messages={sent:'TG 确认消息已发送，请在 Telegram 中查看。',failed:'选择已生效，但 TG 确认消息发送失败。请检查提醒配置；这不会撤销已保存的选择。',uncertain:'选择已生效，但 TG 确认消息的发送结果暂时无法确认。请先查看 Telegram，避免重复发送。',skipped:'选择已生效，但尚未完成 TG 配置，因此没有发送确认消息。',pending:'选择已生效，TG 确认消息正在处理，请稍后查看 Telegram。'};
 showDialog('提醒选择已保存',`已选择 ${Number(result.selectedCount)||0} 台机器`, `<div class="info-box ${status==='sent'?'':'warning'}" role="status">${e(messages[status]||messages.uncertain)}${result.confirmation?.message?`<p class="telegram-result-detail">${e(result.confirmation.message)}</p>`:''}</div>${refreshFailed?'<p class="field-hint section-space">页面资料暂未刷新成功。选择已保存，请稍后刷新页面查看。</p>':''}`,action('dialog-close','知道了','check','button primary'));
}
async function saveTelegramSelection(form){
 const state=telegramSelectionState(form);if(state.busy)return false;
 if(state.conflicted)throw new Error('请先重新加载最新选择，再勾选并确认。');
 const serverIds=[...form.querySelectorAll('input[name="serverIds"]')].filter(box=>box.checked).map(box=>box.value);
 const selectionKey=JSON.stringify([...serverIds].sort());
 if(state.selectionKey!==selectionKey){state.selectionKey=selectionKey;state.confirmationId=crypto.randomUUID();}
 state.busy=true;lockTelegramSelection(form,state);
 let result;
 try{result=await api('/settings/telegram/servers','PUT',{serverIds,confirmationId:state.confirmationId},state.revision);}
 catch(err){
  if(err.status===409){showTelegramSelectionConflict(form,state);return false;}
  if(!err.status)err.message='请求结果暂时无法确认，请先查看 TG。保留当前勾选重试会查询同一条确认请求，不会主动重复发送。';
  throw err;
 }finally{state.busy=false;lockTelegramSelection(form,state);}
 let refreshFailed=false;
 state.busy=true;lockTelegramSelection(form,state);
 try{await loadWorkspace();render();}catch{refreshFailed=true;}finally{state.busy=false;lockTelegramSelection(form,state);}
 telegramSelectionResult(result,refreshFailed);return true;
}
const telegramEditorStates=new WeakMap();
function telegramSettingsDialog(){
 const t=S.workspace.settings.telegram||{};
 showDialog('Telegram 到期提醒','配置接收提醒的机器人，再为每台机器选择是否提醒。',`<div class="info-box"><ol class="telegram-steps"><li>在 TG 中找 @BotFather 创建机器人，获取 Bot Token。</li><li>打开你的机器人聊天，发送 /start；填写你的接收 Chat ID（数字 ID，不是用户名）。</li><li>保存后发送测试消息，再勾选需要提醒的机器。</li></ol></div><div class="form-grid section-space">${checkbox('enabled','开启 Telegram 到期提醒',t.enabled)}${field('chatId','接收 Chat ID',t.chatId||'','text','例如：123456789 或群组的负数 ID',false,'autocomplete="off" maxlength="32"',true)}${field('botToken','Bot Token','','password',t.hasToken?'已保存，留空保留原 Token':'输入 BotFather 提供的 Token',false,'autocomplete="new-password" maxlength="256" spellcheck="false"',true)}${t.hasToken?checkbox('clearToken','删除已保存的 Bot Token（同时需要关闭提醒）'):''}</div><p class="field-hint section-space">Token 加密保存在服务器内，保存后不会回显。提醒包含机器名称、到期日期、服务商和管理台链接，不发送密码或连接凭据。提醒时间为北京时间 09:00 起。</p><div class="section-title">${icon('lock',15)} 验证管理身份</div>${authFields()}`,saveFoot('保存提醒设置'),'telegram-settings');
 telegramEditorStates.set($('form',dialog),{revision:S.revision,review:null});
}
function telegramSettingsPayload(form){
 const f=new FormData(form),token=(f.get('botToken')?.toString()||'').trim(),clear=f.has('clearToken');
 if(clear&&token)throw new Error('请在填写新 Token 和删除旧 Token 中选择一种操作。');
 const data={enabled:f.has('enabled'),chatId:(f.get('chatId')?.toString()||'').trim(),password:f.get('password')?.toString()||'',otp:(f.get('otp')?.toString()||'').trim()};
 if(token)data.botToken=token;if(clear)data.clearToken=true;
 if(data.enabled&&(!data.chatId||clear||(!token&&!S.workspace.settings.telegram?.hasToken)))throw new Error('开启提醒前，请填写 Chat ID 和 Bot Token。');
 return data;
}
function showTelegramConflict(form,state){
 const latest=S.workspace.settings.telegram||{};
 state.review={revision:S.revision};$('.telegram-conflict',form)?.remove();
 const panel=document.createElement('section');panel.className='telegram-conflict info-box warning';
 panel.innerHTML=`<p>其他页面已更新资料。你的草稿仍保留，请核对当前提醒设置；确认后，下次保存将使用下方草稿替换提醒设置。</p><p>当前：${latest.enabled?'已开启':'已暂停'} · Chat ID：${e(latest.chatId||'未设置')} · Token：${latest.hasToken?'已保存':'未保存'}。Token 留空会保留最新的已存 Token。</p>${action('telegram-review','已核对，继续使用我的草稿','','button small-button')}`;
 $('.dialog-body',form).prepend(panel);panel.scrollIntoView({block:'nearest'});
}
function reviewTelegramSettings(form){
 const state=telegramEditorStates.get(form);if(!state?.review)return;
 state.revision=state.review.revision;state.review=null;
 $('.telegram-conflict',form)?.remove();$('button[type="submit"]',form).textContent='确认保存我的设置';
 toast('已保留草稿，请检查后点击保存');
}
async function saveTelegramSettings(form){
 const state=telegramEditorStates.get(form);if(!state)throw new Error('编辑状态已失效，请关闭后重新配置。');
 if(state.review)throw new Error('请先核对其他页面的最新设置，并确认继续使用草稿。');
 const data=telegramSettingsPayload(form);
 try{await mutate('/settings/telegram','PUT',data,state.revision);return true;}
 catch(err){if(err.status===409){showTelegramConflict(form,state);return false;}throw err;}
}
function telegramSendDialog(kind){
 const retry=kind==='telegram-retry',t=S.workspace.settings.telegram||{};
 showDialog(retry?'重试未成功的提醒':'发送 Telegram 测试消息',retry?'请先查看 TG，确认是否已经收到这些提醒。':'将使用已保存的配置，立即向你的 TG 发送一条测试消息。',`<div class="info-box ${retry?'warning':''}">接收 Chat ID：${e(t.chatId||'未设置')}。${retry?'失败的提醒将重新排队；结果未确认的提醒可能重复发送。只有提醒已开启且配置完整时才会继续发送。':'测试消息不会改变任何机器的到期提醒记录。'}</div>${retry?`<label class="checkbox-row section-space"><input type="checkbox" name="confirmRetry" required>我已检查 TG，确认重试可能重复的提醒</label>`:''}<div class="section-title">${icon('lock',15)} 验证管理身份</div>${authFields()}`,saveFoot(retry?'确认重试':'发送一条测试消息'),kind);
}

function field(name,label,value='',type='text',placeholder='',required=false,extra='',wide=false){return `<label class="field ${wide?'wide':''}"><span class="field-label">${label}${required?' <span class="required">*</span>':''}</span><input class="input" name="${e(name)}" type="${type}" value="${e(value)}" placeholder="${e(placeholder)}" ${required?'required':''} ${extra}></label>`;}
function selectField(name,label,value,options,wide=false){return `<label class="field ${wide?'wide':''}">${label}<select class="input" name="${e(name)}">${Object.entries(options).map(([v,l])=>`<option value="${e(v)}" ${v===value?'selected':''}>${e(l)}</option>`).join('')}</select></label>`;}
function area(name,label,value='',placeholder='',rows=3){return `<label class="field wide">${label}<textarea class="input" name="${e(name)}" rows="${rows}" placeholder="${e(placeholder)}" maxlength="20000">${e(value)}</textarea></label>`;}
function section(title,ico,html){return `<section class="form-section"><h3 class="section-title">${icon(ico,15)}${title}</h3><div class="form-grid">${html}</div></section>`;}
function showDialog(title,subtitle,body,foot='',form='',id=''){clearCredentialViews();passwordViewEpoch++;if(dialog.open)dialog.close();dialog.dataset.kind=form||'';dialog.dataset.sensitive=String(['密码资料','连接你的验证器','双重验证已开启'].includes(title));dialog.dataset.autoHide=String(title==='密码资料');dialog.innerHTML=`<${form?'form':'div'} class="dialog-shell" ${form?`data-form="${form}" data-id="${e(id)}"`:''}><header class="dialog-head"><div><h2 id="dialog-title">${e(title)}</h2>${subtitle?`<p>${e(subtitle)}</p>`:''}</div>${action('dialog-close','<span class="sr-only">关闭</span>','close','icon-button')}</header><div class="dialog-body"><div class="form-error" role="alert"></div>${body}</div>${foot?`<footer class="dialog-foot">${foot}</footer>`:''}</${form?'form':'div'}>`;dialog.showModal();if(['server','command'].includes(form))rememberEditor($('form',dialog),id);clearTimeout(closeDialog.timer);if(title==='密码资料')closeDialog.timer=setTimeout(()=>{if(dialog.open){closeDialog();toast('密码显示已自动关闭');}},60000);}
function closeDialog(){const form=$('form',dialog);if(form?.dataset.busy==='true'){toast('正在保存，请稍候');return false;}if(form?.dataset.form==='custom-monthly-servers'&&customMonthlySelectionStates.get(form)?.busy){toast('正在保存自定义选择，请稍候');return false;}if(form?.dataset.form==='cost-servers'&&costSelectionStates.get(form)?.busy){toast('正在保存费用选择，请稍候');return false;}if(form?.dataset.form==='telegram-servers'&&telegramSelectionStates.get(form)?.busy){toast('正在保存并发送确认，请稍候');return false;}passwordViewEpoch++;clearCredentialViews();clearTimeout(closeDialog.timer);dialog.close();dialog.innerHTML='';return true;}
const saveFoot=(label='保存',left='')=>`${left}${action('dialog-close','取消','','button')}<button class="button primary" type="submit">${icon('check',15)}${label}</button>`;
const checkbox=(name,label,checked=false)=>`<label class="checkbox-row"><input type="checkbox" name="${e(name)}" ${checked?'checked':''}>${label}</label>`;
function passwordField(name,label,s){return `<div class="field">${field(name,label,'','password',s.hasSecrets?.[name]?'已保存，留空不修改':'未设置','', 'autocomplete="new-password" maxlength="4096"')}${s.hasSecrets?.[name]?checkbox('clear_'+name,'删除已保存的密码'):''}</div>`;}
function domainEntry(d={}){return `<div class="repeat-entry domain-entry" data-record-id="${e(d.id||crypto.randomUUID())}" data-created="${e(d.createdAt||new Date().toISOString())}"><div class="repeat-head"><span>域名记录</span>${action('remove-entry','<span class="sr-only">删除这条域名</span>','trash','icon-button')}</div><div class="form-grid">${field('domain','域名',d.domain,'text','example.com',true)}${selectField('recordType','记录类型',d.recordType||'A',{A:'A',AAAA:'AAAA',CNAME:'CNAME',TXT:'TXT',MX:'MX',NS:'NS',OTHER:'其他'})}${field('target','解析目标',d.target)}${field('sslNote','SSL 说明',d.sslNote)}${field('remark','备注',d.remark,'text','',false,'',true)}</div></div>`;}
function usageEntry(u={}){return `<div class="repeat-entry usage-entry" data-record-id="${e(u.id||crypto.randomUUID())}"><div class="repeat-head"><span>用途记录</span>${action('remove-entry','<span class="sr-only">删除这条用途</span>','trash','icon-button')}</div><div class="form-grid">${field('usageTitle','名称',u.title,'text','例如：个人博客',true)}${selectField('usageKind','类型',u.kind||'website',{website:'网站',database:'数据库',proxy:'代理',bot:'机器人',storage:'存储',note:'其他'})}${field('usageDate','日期',dateValue(u.date)||dateValue(new Date()),'date')}${area('usageDetail','详细说明',u.detail,'用途、部署位置等',2)}</div></div>`;}
function editServer(id,defaults={}){const s=S.workspace.servers.find(x=>x.id===id)||{provider:defaults.provider||''};const body=section('基本信息','server',field('name','服务器名称',s.name,'text','给这台服务器起一个名字',true,'maxlength="120"')+field('provider','服务商',s.provider,'text','相同服务商名称会归到同一页',false,'maxlength="120"')+field('ipAddress','IP / 主机地址',s.ipAddress,'text','IPv4、IPv6 或主机名',false,'maxlength="253"')+selectField('status','运行状态',s.status||'online',Object.fromEntries(Object.entries(statusMap).map(([v,[l]])=>[v,l])))+field('region','所在区域',s.region,'text','例如：新加坡')+field('plan','配置 / 套餐',s.plan,'text','例如：2 核 / 4 GB / 80 GB')+field('purpose','主要用途',s.purpose)+field('tagsText','标签',(s.tags||[]).join(', '),'text','多个标签用逗号分隔')+field('monthlyTraffic','月流量',s.monthlyTraffic,'text','例如：1 TB')+field('bandwidth','带宽（M / G）',normalizeBandwidth(s.bandwidth),'text','例如 500M 或 1G，数字默认 M')+checkbox('isPinned','在列表顶部置顶',s.isPinned))+section('账单与续费','wallet',field('monthlyCostAmount','单期价格',s.monthlyCostAmount,'number','尚未填写',false,'min="0" step="0.000001"')+selectField('monthlyCostCurrency','账单币种',s.monthlyCostCurrency||'CNY',{CNY:'CNY · 人民币',USD:'USD · 美元',HKD:'HKD · 港币',EUR:'EUR · 欧元',JPY:'JPY · 日元',GBP:'GBP · 英镑',CAD:'CAD · 加元'})+selectField('monthlyCostCycle','付费周期',s.monthlyCostCycle||'monthly',{monthly:'月付',quarterly:'季付',yearly:'年付'})+field('renewalDate','下次续费日期',dateValue(s.renewalDate||s.renewalDateText),'date')+`<input type="hidden" name="costParticipationPresent" value="1">`+checkbox('includeInCosts','参与首页费用统计',s.excludeFromCosts!==true)+`<p class="field-hint wide">取消勾选后，不计入首页的月付开销、年付开销和总资产金额。</p>`+checkbox('autoRenew','已开启服务商自动续费',s.autoRenew)+checkbox('expiryReminder','通过 TG 提醒这台机器到期',s.expiryReminder)+`<p class="field-hint wide">勾选后，在到期前 7 天发送一次提醒。请先到系统设置配置 Telegram，并填写这台机器的续费日期。</p>`)+section('SSH 连接','terminal',field('username','SSH 用户名',s.username||'root')+field('sshPort','SSH 端口',s.sshPort||22,'number','22',true,'min="1" max="65535" step="1"')+passwordField('sshPassword','SSH 密码',s))+section('服务商控制台','globe',field('serverURL','控制台网址',s.serverURL,'url','https://',false,'',true)+field('serverURLUsername','控制台用户名',s.serverURLUsername)+passwordField('serverURLPassword','控制台密码',s))+section('管理面板','overview',field('panelURL','面板网址',s.panelURL,'url','https://',false,'',true)+field('panelUsername','面板用户名',s.panelUsername)+passwordField('panelPassword','面板密码',s))+`<section class="form-section"><h3 class="section-title">${icon('globe',15)} 绑定域名</h3><div id="domain-entries">${(s.domains||[]).map(domainEntry).join('')}</div>${action('domain-add','添加域名','plus','button small-button')}</section><section class="form-section"><h3 class="section-title">${icon('overview',15)} 用途记录</h3><div id="usage-entries">${(s.usages||[]).map(usageEntry).join('')}</div>${action('usage-add','添加用途','plus','button small-button')}</section>`+section('备注','edit',area('notes','记录补充信息',s.notes,'安装位置、重要提醒等',4))+`<div class="info-box">密码为空时保留已有值。已保存的密码可在服务器详情的对应账号旁点击「查看」。</div>`;showDialog(s.id?'编辑服务器':'添加服务器',s.id?'更新资料，保留清晰的资产记录。':'将连接信息与账单整理在一起。',body,saveFoot(s.id?'保存修改':'添加服务器',s.id?action('server-delete','删除','trash','button danger left',s.id):''),'server',s.id||'');}
function item(label,value,wide=false){return `<div class="detail-item ${wide?'wide':''}"><dt>${label}</dt><dd>${value||'—'}</dd></div>`;}
const detailTabs=[['overview','概览连接'],['configuration','配置资料'],['billing','账单续费'],['notes','域名备注']];
function detailServer(id,tab='overview',credential='sshPassword',focusTab=false){
 const s=S.workspace.servers.find(x=>x.id===id);if(!s)return;
 if(!detailTabs.some(x=>x[0]===tab))tab='overview';
 const tabs=`<div class="detail-tabs" role="tablist" aria-label="服务器资料分类">${detailTabs.map(([key,title])=>`<button type="button" role="tab" id="detail-tab-${key}" aria-selected="${key===tab}" aria-controls="detail-panel" tabindex="${key===tab?0:-1}" data-action="detail-tab" data-tab="${key}" data-id="${e(id)}">${title}</button>`).join('')}</div>`;
 let content='';
 if(tab==='overview'){
  const available=[['sshPassword','SSH 连接'],...(s.serverURL||s.serverURLUsername||s.hasSecrets?.serverURLPassword?[['serverURLPassword','控制台']]:[]),...(s.panelURL||s.panelUsername||s.hasSecrets?.panelPassword?[['panelPassword','管理面板']]:[])];
  if(!available.some(x=>x[0]===credential))credential='sshPassword';
  const cards={sshPassword:()=>credentialCard(s,'SSH 连接','terminal',s.username,(s.ipAddress||'未填写主机地址')+' · 端口 '+(s.sshPort||22),'sshPassword','',true),serverURLPassword:()=>credentialCard(s,'服务商控制台','globe',s.serverURLUsername,s.serverURL,'serverURLPassword',safeURL(s.serverURL)),panelPassword:()=>credentialCard(s,'管理面板','overview',s.panelUsername,s.panelURL,'panelPassword',safeURL(s.panelURL))};
  content=`<div class="detail-snapshot"><div><span>下次到期</span><strong>${shortDate(s.renewalDate||s.renewalDateText)}</strong><small>${e(dueText(s))}</small></div><div><span>套餐账单</span><strong>${price(s)}</strong><small>${s.autoRenew?'服务商自动续费':'手动续费'} · ${s.excludeFromCosts?'首页不统计':'首页参与统计'}</small></div></div><div class="credential-tabs" role="tablist" aria-label="账号类型">${available.map(([key,title])=>`<button type="button" role="tab" id="account-tab-${key}" aria-selected="${key===credential}" aria-controls="account-panel" tabindex="${key===credential?0:-1}" data-action="detail-account" data-secret="${key}" data-id="${e(id)}">${title}</button>`).join('')}</div><section id="account-panel" role="tabpanel" aria-labelledby="account-tab-${credential}" tabindex="0">${cards[credential]()}</section><div class="detail-quick-note">${reminderBadge(s)}<span>${e(s.plan||'配置暂未记录')}</span></div>`;
 }else if(tab==='configuration')content=`<dl class="detail-grid">${item('服务商',e(s.provider))}${item('区域',e(s.region))}${item('IP / 主机地址',e(s.ipAddress),true)}${item('配置 / 套餐',e(s.plan))}${item('主要用途',e(s.purpose))}${item('流量 / 带宽',e(s.monthlyTraffic||'—')+' / '+e(normalizeBandwidth(s.bandwidth)||'—'),true)}${item('标签',(s.tags||[]).map(t=>`<span class="tag">${e(t)}</span>`).join(' '),true)}</dl>`;
 else if(tab==='billing')content=`<div class="billing-summary"><dl class="detail-grid">${item('单期账单',price(s))}${item('下次到期',shortDate(s.renewalDate||s.renewalDateText))}${item('首页费用统计',s.excludeFromCosts===true?'不参与统计':'参与统计')}${item('续费方式',s.autoRenew?'服务商自动续费':'手动续费')}${item('到期提醒',reminderBadge(s),true)}</dl>${action('renewal-add','记录已续费','calendar','button primary',id)}</div>${renewalHistory(s)}`;
 else content=`<div class="section-title">${icon('globe',15)}绑定域名 <span class="count-label">${s.domains?.length||0}</span></div>${s.domains?.length?`<dl class="detail-grid">${s.domains.map(d=>item(e(d.domain),`${e(d.recordType)} → ${e(d.target||'—')}<br>${e(d.sslNote)} ${e(d.remark)}`,true)).join('')}</dl>`:'<p class="field-hint section-space">暂无域名记录</p>'}<div class="section-title">${icon('overview',15)}用途记录 <span class="count-label">${s.usages?.length||0}</span></div>${s.usages?.length?`<dl class="detail-grid">${s.usages.map(u=>item(e(u.title),`${shortDate(u.date)}<br>${e(u.detail)}`,true)).join('')}</dl>`:'<p class="field-hint section-space">暂无用途记录</p>'}<div class="section-title">${icon('edit',15)}备注</div><dl class="detail-grid">${item('补充说明',e(s.notes||'暂无备注'),true)}</dl>`;
 showDialog(s.name,[s.provider||'未设置服务商',s.region||'未设置区域'].join(' · '),tabs+`<section class="detail-tab-content" id="detail-panel" role="tabpanel" aria-labelledby="detail-tab-${tab}" tabindex="0">${content}</section>`,action('provider-open','同商家','server','button left',providerKey(s))+action('renewal-add','已续费','calendar','button',id)+action('server-edit','编辑资料','edit','button primary',id));
 dialog.dataset.kind='server-detail';dialog.dataset.serverId=id;dialog.dataset.detailTab=tab;dialog.dataset.credential=credential;
 $('.dialog-head>div',dialog).insertAdjacentHTML('beforeend',badge(s.status));
 if(focusTab)$(`#detail-tab-${tab}`,dialog)?.focus({preventScroll:true});
}
function renewalHistory(server){
 const records=[...(server.renewalHistory||[])].sort((a,b)=>String(b.paidOn).localeCompare(String(a.paidOn))||String(b.createdAt).localeCompare(String(a.createdAt)));
 const totals=new Map();for(const r of records)totals.set(r.currency,(totals.get(r.currency)||0)+Number(r.amount||0));
 return `<section class="renewal-history"><div class="section-title">${icon('wallet',15)}续费记录 <span class="count-label">${records.length}</span></div>${records.length?`<div class="renewal-totals">${[...totals].map(([currency,total])=>`<span>累计已记录 <strong>${e(currency)} ${money(total)}</strong></span>`).join('')}</div><ol class="renewal-records">${records.map(r=>`<li><div class="renewal-record-head"><strong>${e(r.currency)} ${money(r.amount)}</strong><time>${shortDate(r.paidOn)}</time></div><p>${e(cycleMap[r.cycle]||'月')}付 × ${Number(r.periods)||1} 期 · 延至 ${shortDate(r.newExpiry)}</p>${r.previousExpiry?`<small>原到期日 ${shortDate(r.previousExpiry)}</small>`:''}${r.note?`<p class="renewal-record-note">${e(r.note)}</p>`:''}</li>`).join('')}</ol>`:'<p class="field-hint section-space">还没有续费记录。点击「已续费」记录付款，并更新到期日。</p>'}<p class="field-hint">累计金额仅包含在这里记录的续费，不含历史购机费用；不同币种分别统计。</p></section>`;
}
const credentialTimers=new Map();
function hideCredential(row){
 clearTimeout(credentialTimers.get(row));credentialTimers.delete(row);
 const value=$('[data-secret-value]',row),button=$('[data-action="secrets"]',row);
 if(value)value.textContent=row.dataset.masked||'••••••••';
 row.dataset.revealed='false';
 if(button){button.textContent='查看';button.setAttribute('aria-pressed','false');}
}
function clearCredentialViews(){passwordViewEpoch++;for(const row of credentialTimers.keys())hideCredential(row);}
function revealCredential(row,button,password){
 clearTimeout(credentialTimers.get(row));
 $('[data-secret-value]',row).textContent=password||'未保存';
 row.dataset.masked=password?'••••••••':'未保存';row.dataset.revealed='true';
 button.textContent='隐藏';button.setAttribute('aria-pressed','true');
 credentialTimers.set(row,setTimeout(()=>hideCredential(row),60000));
}
function credentialCard(s,title,ico,username,address,secretField,url='',ssh=false){
 const saved=s.hasSecrets?.[secretField]===true;
 const link=ssh?action('ssh-copy','复制 SSH','terminal','button small-button',s.id):url?`<a class="button small-button" href="${e(url)}" target="_blank" rel="noopener noreferrer">${icon('external',14)}打开</a>`:'';
 return `<section class="credential-card"><header class="credential-head"><h3>${icon(ico,16)}${title}</h3>${link}</header>${address?`<p class="credential-address">${e(address)}</p>`:''}<dl class="credential-grid"><div class="credential-account"><dt>用户名</dt><dd>${e(username||'未填写')}</dd></div><div class="credential-secret" data-secret-field="${secretField}"><dt>密码</dt><dd><span class="credential-value mono" data-secret-value>${saved?'••••••••':'未保存'}</span>${saved?`<span class="credential-actions"><button type="button" class="button small-button credential-toggle" data-action="secrets" data-secret="${secretField}" data-id="${e(s.id)}" aria-label="查看${title}密码" aria-pressed="false">查看</button><button type="button" class="button small-button credential-copy" data-action="secret-copy" data-secret="${secretField}" data-id="${e(s.id)}" aria-label="复制${title}密码">复制</button></span>`:''}</dd></div></dl></section>`;
}
function serverCredentials(s){
 const control=safeURL(s.serverURL),panel=safeURL(s.panelURL);
 return `<div class="section-title">${icon('lock',15)} 连接与账号</div><div class="credential-list">${credentialCard(s,'SSH 连接','terminal',s.username,(s.ipAddress||'未填写主机地址')+' · 端口 '+(s.sshPort||22),'sshPassword','',true)}${s.serverURL||s.serverURLUsername||s.hasSecrets?.serverURLPassword?credentialCard(s,'服务商控制台','globe',s.serverURLUsername,s.serverURL,'serverURLPassword',control):''}${s.panelURL||s.panelUsername||s.hasSecrets?.panelPassword?credentialCard(s,'管理面板','overview',s.panelUsername,s.panelURL,'panelPassword',panel):''}</div>`;
}
async function viewServerPasswords(id,node){
 const field=node?.dataset.secret,row=node?.closest('.credential-secret'),shell=node?.closest('.dialog-shell'),session=S.session,csrf=session?.csrfToken,page=S.page,epoch=passwordViewEpoch;
 if(!['sshPassword','serverURLPassword','panelPassword'].includes(field)||!row||row.dataset.secretField!==field||!shell||!dialog.open||node.disabled||!session?.authenticated||!csrf||document.hidden)return;
 if(row.dataset.revealed==='true'){hideCredential(row);return;}
 node.disabled=true;
 try{
  const r=await api('/servers/'+encodeURIComponent(id)+'/secrets','POST',{});
  if(epoch!==passwordViewEpoch||!dialog.open||$('.dialog-shell',dialog)!==shell||!row.isConnected||S.session!==session||!S.session?.authenticated||S.session.csrfToken!==csrf||S.page!==page||document.hidden)return;
  revealCredential(row,node,typeof r[field]==='string'?r[field]:'');
 }finally{node.disabled=false;}
}

let credentialCopyEpoch=0;
async function copyServerPassword(id,node){
 const field=node?.dataset.secret,row=node?.closest('.credential-secret'),shell=node?.closest('.dialog-shell'),session=S.session,csrf=session?.csrfToken,page=S.page,epoch=passwordViewEpoch;
 if(!['sshPassword','serverURLPassword','panelPassword'].includes(field)||!row||row.dataset.secretField!==field||!shell||!dialog.open||node.disabled||!session?.authenticated||!csrf||document.hidden)return;
 const sequence=++credentialCopyEpoch;
 const current=()=>sequence===credentialCopyEpoch&&epoch===passwordViewEpoch&&dialog.open&&$('.dialog-shell',dialog)===shell&&row.isConnected&&S.session===session&&S.session?.authenticated&&S.session.csrfToken===csrf&&S.page===page&&!document.hidden;
 node.disabled=true;
 const password=api('/servers/'+encodeURIComponent(id)+'/secrets','POST',{}).then(result=>{
  if(!current())throw new Error('密码复制已取消。');
  const value=typeof result[field]==='string'?result[field]:'';
  if(!value)throw new Error('该账号尚未保存密码。');
  return value;
 });
 try{
  try{
   if(typeof ClipboardItem==='function'&&typeof Blob==='function'&&navigator.clipboard?.write){
    // Start within the click gesture; the browser waits for the authenticated response.
    const data=password.then(value=>{if(!current())throw new Error('密码复制已取消。');return new Blob([value],{type:'text/plain'});});
    data.catch(()=>{});
    await navigator.clipboard.write([new ClipboardItem({'text/plain':data})]);
   }else{
    const value=await password;
    if(!current())return;
    if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
   }
   if(current())toast('密码已复制');
  }catch(error){
   const value=await password;
   if(!current())return;
   revealCredential(row,$('[data-action="secrets"]',row),value);
   const selected=$('[data-secret-value]',row),selection=document.getSelection?.();
   if(selection&&document.createRange){const range=document.createRange();range.selectNodeContents(selected);selection.removeAllRanges();selection.addRange(range);}
   selected.scrollIntoView?.({block:'nearest'});
   toast('浏览器未允许自动复制，已显示并选中密码，请手动复制');
  }
 }catch(error){if(current())throw error;}
 finally{node.disabled=false;}
}

function editCommand(id){const c=S.workspace.commands.find(x=>x.id===id)||{};showDialog(c.id?'编辑指令':'添加指令','保存可复用的命令与操作说明。',`<div class="form-grid">${field('title','指令名称',c.title,'text','例如：查看磁盘占用',true,'maxlength="120"')}${field('category','分类',c.category,'text','例如：系统维护')}${area('command','指令内容',c.command,'输入命令，保存后不会自动执行',5)}${area('note','使用说明',c.note,'适用范围、参数说明等',3)}</div>`,saveFoot('保存指令',c.id?action('command-delete','删除','trash','button danger left',c.id):''),'command',c.id||'');$('textarea[name="command"]',dialog).required=true;}
function authFields(){return `<div class="form-grid">${field('password','管理账户密码','','password','输入你的管理密码',true,'autocomplete="current-password" maxlength="128"',true)}${S.session.account?.totpEnabled?field('otp','动态验证码 / 恢复码','','text','验证器中的验证码',true,'autocomplete="one-time-code" maxlength="64"',true):''}</div>`;}
function securityDialog(kind){if(kind==='password-change')return showDialog('修改登录密码','使用独立、足够长的密码保护管理台。',`<div class="form-grid">${field('currentPassword','当前密码','','password','',true,'autocomplete="current-password" maxlength="128"',true)}${field('newPassword','新密码','','password','至少 14 位',true,'autocomplete="new-password" minlength="14" maxlength="128"',true)}${field('confirmPassword','确认新密码','','password','再次输入新密码',true,'autocomplete="new-password" minlength="14" maxlength="128"',true)}${S.session.account?.totpEnabled?field('otp','动态验证码 / 恢复码','','text','',true,'autocomplete="one-time-code"',true):''}</div>`,saveFoot('更新密码'),'password');if(kind==='totp-start')return showDialog('开启双重验证','先验证管理密码，再连接你的验证器。',authFields(),saveFoot('继续'),'totp-start');if(kind==='totp-disable')return showDialog('关闭双重验证','关闭后，登录将仅使用管理密码。',authFields(),saveFoot('确认关闭'),'totp-disable');if(kind==='backup')return showDialog('生成加密备份','备份仅保存在当前服务器的 VPS 文件夹内。',authFields()+`<p class="field-hint section-space">此操作不会下载文件到当前设备。恢复时需要服务器上的独立加密密钥。</p>`,saveFoot('生成备份'),'backup');}
function confirmDelete(kind,id){const record=(kind==='server'?S.workspace.servers:S.workspace.commands).find(x=>x.id===id);if(!record)return;showDialog('确认删除',`这项操作无法撤销。`,`<p class="small">确定删除「${e(record.name||record.title)}」及其已记录资料吗？</p>`,action('dialog-close','取消','','button')+`<button type="submit" class="button danger">${icon('trash',15)}删除</button>`,kind+'-delete',id);}

const editorStates=new WeakMap();
const secretKeys=new Set(['sshPassword','serverURLPassword','panelPassword']);
const editLabels={name:'服务器名称',provider:'服务商',ipAddress:'IP / 主机地址',username:'SSH 用户名',sshPort:'SSH 端口',region:'所在区域',plan:'配置 / 套餐',monthlyTraffic:'月流量',bandwidth:'带宽',purpose:'用途',notes:'备注',serverURL:'控制台网址',serverURLUsername:'控制台用户名',panelURL:'面板网址',panelUsername:'面板用户名',status:'状态',monthlyCostAmount:'单期价格',monthlyCostCurrency:'币种',monthlyCostCycle:'计费周期',tags:'标签',autoRenew:'自动续费',expiryReminder:'TG 到期提醒',excludeFromCosts:'费用统计',isPinned:'置顶',renewalDate:'续费日期',renewalDateText:'续费日期文字',domains:'域名记录',usages:'用途记录',sshPassword:'SSH 密码',serverURLPassword:'控制台密码',panelPassword:'面板密码',title:'指令名称',category:'分类',command:'指令内容',note:'使用说明'};
const sameEditValue=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function readEditor(form){
  const f=new FormData(form),get=name=>f.get(name)?.toString()||'';
  if(form.dataset.form==='command')return {title:get('title').trim(),category:get('category').trim(),command:get('command'),note:get('note')};
  const data={};for(const k of ['name','provider','ipAddress','username','region','plan','monthlyTraffic','bandwidth','purpose','notes','serverURL','serverURLUsername','panelURL','panelUsername','status','monthlyCostAmount','monthlyCostCurrency','monthlyCostCycle'])data[k]=get(k).trim();data.bandwidth=normalizeBandwidth(data.bandwidth);data.sshPort=Number(get('sshPort'));data.tags=get('tagsText').split(/[,，]/).map(x=>x.trim()).filter(Boolean);data.autoRenew=f.has('autoRenew');data.expiryReminder=f.has('expiryReminder');data.excludeFromCosts=f.has('costParticipationPresent')?!f.has('includeInCosts'):S.workspace.servers.find(s=>s.id===form.dataset.id)?.excludeFromCosts===true;data.isPinned=f.has('isPinned');data.renewalDate=get('renewalDate')?get('renewalDate')+'T00:00:00.000Z':null;data.renewalDateText=get('renewalDate');for(const k of ['sshPassword','serverURLPassword','panelPassword']){if(f.has('clear_'+k))data[k]='';else if(get(k))data[k]=get(k);}data.domains=[...form.querySelectorAll('.domain-entry')].map(row=>{const d={id:row.dataset.recordId,createdAt:row.dataset.created};for(const key of ['domain','recordType','target','sslNote','remark'])d[key]=$(`[name="${key}"]`,row).value.trim();return d;});data.usages=[...form.querySelectorAll('.usage-entry')].map(row=>({id:row.dataset.recordId,title:$('[name="usageTitle"]',row).value.trim(),kind:$('[name="usageKind"]',row).value,date:($('[name="usageDate"]',row).value||dateValue(new Date()))+'T00:00:00.000Z',detail:$('[name="usageDetail"]',row).value.trim()}));
  return data;
}
function rememberEditor(form,id){
  const records=form.dataset.form==='server'?S.workspace.servers:S.workspace.commands;
  editorStates.set(form,{revision:S.revision,original:readEditor(form),record:id?structuredClone(records.find(x=>x.id===id)):null,review:null});
}
function editedFields(data,original){return Object.fromEntries(Object.entries(data).filter(([key,value])=>!sameEditValue(value,original[key])));}
function conflictingFields(patch,record,latest){
  return Object.keys(patch).filter(key=>!(key==='renewalDateText'&&Object.hasOwn(patch,'renewalDate'))).filter(key=>secretKeys.has(key)||Array.isArray(patch[key])||!sameEditValue(record?.[key],latest?.[key])||(key==='renewalDate'&&!sameEditValue(record?.renewalDateText,latest?.renewalDateText)));
}
function editValueText(key,value){return key==='excludeFromCosts'?(value===true?'不参与统计':'参与统计'):String(value??'');}
function showEditConflict(form,state,data){
  const id=form.dataset.id,records=form.dataset.form==='server'?S.workspace.servers:S.workspace.commands;
  const latest=id?records.find(x=>x.id===id):null;
  const patch=id?editedFields(data,state.original):data;
  state.review={revision:S.revision,latest:latest?structuredClone(latest):null,draft:structuredClone(data),conflicts:id&&latest?conflictingFields(patch,state.record,latest):[],deleted:!!id&&!latest};
  $('.edit-conflict',form)?.remove();
  const panel=document.createElement('section');panel.className='edit-conflict info-box warning';
  if(state.review.deleted){
    panel.innerHTML='<p>这条记录已在其他页面删除。你的草稿仍保留，可另存为新记录。</p>'+action('edit-as-new','将草稿另存为新记录','','button small-button');
  }else{
    const summary=id?'其他页面的最新修改会保留；你的草稿仍在下方。请核对后确认合并。':'其他页面已更新资料。你的新记录草稿仍保留，请确认后保存。';
    panel.innerHTML=`<p>${summary}</p>`+state.review.conflicts.map(key=>{
      const restricted=secretKeys.has(key)||Array.isArray(patch[key]);
      const preview=restricted?'<p class="field-hint">此项不能安全自动合并，请明确选择；保留草稿将替换这一整项。</p>':`<p class="field-hint">最新值：${e(editValueText(key,latest[key]))}<br>你的草稿：${e(editValueText(key,patch[key]))}</p>`;
      return `<div class="field"><strong>${e(editLabels[key]||key)}</strong>${preview}<select class="input" data-edit-choice="${e(key)}" required><option value="">请选择处理方式</option><option value="latest">采用其他页面的最新值</option><option value="draft">保留我的草稿值</option></select></div>`;
    }).join('');
    $('button[type="submit"]',form).textContent=id?'确认合并并保存':'确认保存新记录';
  }
  $('.dialog-body',form).prepend(panel);panel.scrollIntoView({block:'nearest'});
}
async function saveEditor(form){
  const kind=form.dataset.form,id=form.dataset.id,state=editorStates.get(form);
  if(!state)throw new Error('编辑状态已失效，请关闭后重新打开。');
  const data=readEditor(form),patch=id?editedFields(data,state.original):{...data};
  let revision=state.revision;
  if(state.review){
    if(state.review.deleted)throw new Error('原记录已被删除，请将草稿另存为新记录。');
    if(!sameEditValue(data,state.review.draft)){showEditConflict(form,state,data);return false;}
    for(const key of state.review.conflicts){
      const choice=$(`[data-edit-choice="${key}"]`,form)?.value;
      if(!['latest','draft'].includes(choice))throw new Error('请为每个冲突项选择处理方式。');
      if(choice==='latest'){delete patch[key];if(key==='renewalDate')delete patch.renewalDateText;}
    }
    revision=state.review.revision;
  }
  try{
    if(!id||Object.keys(patch).length)await mutate('/'+(kind==='server'?'servers':'commands')+(id?'/'+encodeURIComponent(id):''),id?'PUT':'POST',patch,revision);
  }catch(err){if(err.status===409){showEditConflict(form,state,data);return false;}throw err;}
  return true;
}
function saveDraftAsNew(form){
  const state=editorStates.get(form);if(!state?.review?.deleted)return;
  form.dataset.id='';state.revision=S.revision;state.record=null;state.original={};state.review=null;
  $('.edit-conflict',form)?.remove();$('button[type="submit"]',form).textContent='另存为新记录';
  toast('草稿已保留，请检查后保存为新记录');
}

const val=(form,name)=>new FormData(form).get(name)?.toString()||'';
async function handleSubmit(form){const kind=form.dataset.form,id=form.dataset.id;const f=new FormData(form),get=name=>f.get(name)?.toString()||'';if(kind==='login'||kind==='setup'){if(kind==='setup'&&get('password')!==get('confirmPassword'))throw new Error('两次输入的密码不一致。');await api('/'+kind,'POST',{username:get('username').trim(),password:get('password'),...(kind==='setup'?{token:setupToken||get('token').trim()}:{otp:get('otp').trim()})});setupToken='';await init();return;}
if(kind==='renewal'){await saveRenewal(form);return;}
if(kind==='backup-restore'){await restoreBackup(form);return;}
if(kind==='custom-monthly-servers'){await saveCustomMonthlySelection(form);return;}
if(kind==='cost-servers'){await saveCostSelection(form);return;}
if(kind==='telegram-servers'){await saveTelegramSelection(form);return;}
if(kind==='telegram-settings'){if(!await saveTelegramSettings(form))return;closeDialog();render();toast('Telegram 提醒设置已保存');return;}
if(kind==='telegram-test'||kind==='telegram-retry'){if(kind==='telegram-retry'&&!f.has('confirmRetry'))throw new Error('请先检查 TG，并确认重试可能产生重复提醒。');const result=await api('/settings/telegram/'+(kind==='telegram-test'?'test':'retry'),'POST',{password:get('password'),otp:get('otp').trim(),...(kind==='telegram-retry'?{confirm:true}:{})});await loadWorkspace();closeDialog();render();toast(kind==='telegram-test'?'测试消息已发送，请查看 TG':`${Number(result.retried)||0} 条提醒已重新排队`);return;}
if(kind==='server'||kind==='command'){if(!await saveEditor(form))return;closeDialog();render();toast(kind==='server'?(id?'服务器资料已更新':'服务器已添加'):'指令已保存');return;}
if(kind==='server-delete'||kind==='command-delete'){await mutate('/'+(kind==='server-delete'?'servers':'commands')+'/'+encodeURIComponent(id),'DELETE');closeDialog();render();toast('已删除');return;}
if(kind==='password'){if(get('newPassword')!==get('confirmPassword'))throw new Error('两次输入的新密码不一致。');await api('/security/password','POST',{currentPassword:get('currentPassword'),newPassword:get('newPassword'),otp:get('otp').trim()});closeDialog();await init();toast('登录密码已更新');return;}
if(kind==='totp-start'){const r=await api('/security/totp/start','POST',{password:get('password')});showDialog('连接你的验证器','在验证器中选择手动输入密钥，然后验证动态验证码。',`<div class="info-box">账户：${e(S.session.account.username)}<br>类型：基于时间（TOTP）</div><div class="security-code" id="totp-secret">${e(r.secret)}</div><p class="field-hint section-space">妥善保存此密钥。不要把它发送给他人。</p>${field('code','动态验证码','','text','输入验证器中的 6 位数字',true,'autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"')}`,saveFoot('验证并开启',action('totp-copy','复制密钥','copy','button left')),'totp-confirm');return;}
if(kind==='totp-confirm'){const r=await api('/security/totp/confirm','POST',{code:get('code').trim()});S.session=await api('/session');render();showDialog('双重验证已开启','请保存恢复码，每个恢复码只能使用一次。',`<div class="info-box warning">无法使用验证器时，可用恢复码登录。这些恢复码只展示一次，关闭后无法再次查看。</div><div class="recovery-codes" id="recovery-codes">${(r.recoveryCodes||[]).map(c=>`<span>${e(c)}</span>`).join('')}</div>`,action('recovery-copy','复制恢复码','copy','button')+action('dialog-close','我已妥善保存','check','button primary'));return;}
if(kind==='totp-disable'){await api('/security/totp/disable','POST',{password:get('password'),code:get('otp').trim()});closeDialog();S.session=await api('/session');render();toast('双重验证已关闭');return;}
if(kind==='backup'){const r=await api('/backup','POST',{password:get('password'),otp:get('otp').trim()});S.backups=null;if(S.page==='backups')loadBackups();showDialog('加密备份已生成','文件保存在服务器上，没有下载到当前设备。',`<div class="info-box">${e(r.message||'备份已成功生成。')}</div><p class="command-code">${e(r.filename)}</p>`,action('dialog-close','完成','check','button primary'));return;}}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('已复制到剪贴板');}catch{if(dialog.open){$('.copy-fallback',dialog)?.remove();const box=document.createElement('div');box.className='copy-fallback';const hint=document.createElement('p');hint.className='field-hint';hint.textContent='浏览器未允许自动复制，请手动复制下方已选内容。';const input=document.createElement('textarea');input.className='input mono';input.readOnly=true;input.rows=3;input.value=text;box.append(hint,input);$('.dialog-body',dialog).append(box);input.focus();input.select();}else{showDialog('复制内容','当前浏览器未允许自动复制，可手动选中下方内容。',`<textarea class="input mono" readonly rows="5">${e(text)}</textarea>`,action('dialog-close','关闭','','button'));dialog.dataset.sensitive='true';$('textarea',dialog).select();}}}
function shellQuote(text){return "'"+String(text).replace(/'/g,"'\"'\"'")+"'";}
async function handleAction(name,id,node){if($('form',dialog)?.dataset.busy==='true'){toast('正在保存，请稍候');return;}switch(name){case'retry':return init();case'menu':$('.shell').classList.add('menu-open');break;case'menu-close':$('.shell').classList.remove('menu-open');break;case'dialog-close':closeDialog();break;case'edit-as-new':saveDraftAsNew(node.closest('form'));break;case'refresh':await loadWorkspace();if(S.page==='backups')S.backups=null;render();toast('资料已刷新');break;case'logout':passwordViewEpoch++;clearCredentialViews();await api('/logout','POST',{});S.workspace={servers:[],commands:[],settings:{},costs:{}};S.session=null;S.revision=0;S.backups=null;backupEpoch++;closeDialog();await init();break;case'provider-open':openProvider(id||'');break;case'provider-back':openProvider(null);break;case'provider-server-new':editServer(undefined,{provider:S.provider||''});break;case'server-new':editServer();break;case'server-edit':editServer(id);break;case'detail':detailServer(id);break;case'detail-tab':detailServer(id,node.dataset.tab,dialog.dataset.credential,true);break;case'detail-account':detailServer(id,'overview',node.dataset.secret);$(`[id="account-tab-${node.dataset.secret}"]`,dialog)?.focus({preventScroll:true});break;case'renewal-add':renewalDialog(id);break;case'renewal-reload':renewalDialog(id);break;case'backups-refresh':await loadBackups(true);break;case'backup-preview':await previewBackup(id,node);break;case'server-delete':confirmDelete('server',id);break;case'command-new':editCommand();break;case'command-edit':editCommand(id);break;case'command-delete':confirmDelete('command',id);break;case'command-copy':{const c=S.workspace.commands.find(c=>c.id===id);if(c)await copy(c.command);break;}case'ssh-copy':{const s=S.workspace.servers.find(s=>s.id===id);if(!s?.ipAddress)throw new Error('请先填写 IP 或主机地址。');const port=Number(s.sshPort||22);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('SSH 端口无效。');await copy(`ssh -p ${port} -- ${shellQuote((s.username||'root')+'@'+s.ipAddress)}`);break;}case'view-table':S.view='table';render();break;case'view-cards':S.view='cards';render();break;case'domain-add':$('#domain-entries',dialog).insertAdjacentHTML('beforeend',domainEntry());$('#domain-entries .domain-entry:last-child input',dialog).focus();break;case'usage-add':$('#usage-entries',dialog).insertAdjacentHTML('beforeend',usageEntry());$('#usage-entries .usage-entry:last-child input',dialog).focus();break;case'remove-entry':node.closest('.repeat-entry').remove();break;case'custom-monthly-servers':customMonthlySelectionDialog();break;case'custom-monthly-select-all':selectCustomMonthlyServers(node.closest('form'),true);break;case'custom-monthly-select-none':selectCustomMonthlyServers(node.closest('form'),false);break;case'custom-monthly-selection-reload':await reloadCustomMonthlySelection(node.closest('form'));break;case'cost-servers':costSelectionDialog();break;case'cost-select-all':selectCostServers(node.closest('form'),true);break;case'cost-select-none':selectCostServers(node.closest('form'),false);break;case'cost-selection-reload':await reloadCostSelection(node.closest('form'));break;case'telegram-servers':telegramSelectionDialog();break;case'telegram-select-all':selectTelegramServers(node.closest('form'),true);break;case'telegram-select-none':selectTelegramServers(node.closest('form'),false);break;case'telegram-selection-reload':await reloadTelegramSelection(node.closest('form'));break;case'telegram-settings':telegramSettingsDialog();break;case'telegram-test':case'telegram-retry':telegramSendDialog(name);break;case'telegram-review':reviewTelegramSettings(node.closest('form'));break;case'secrets':await viewServerPasswords(id,node);break;case'secret-copy':await copyServerPassword(id,node);break;case'password-change':case'totp-start':case'totp-disable':case'backup':securityDialog(name);break;case'totp-copy':await copy($('#totp-secret',dialog).textContent);break;case'recovery-copy':await copy([...$('#recovery-codes',dialog).children].map(x=>x.textContent).join('\n'));break;}}
document.addEventListener('click',async event=>{const nav=event.target.closest('[data-nav]');if(nav){if($('form',dialog)?.dataset.busy==='true'){toast('正在保存，请稍候');return;}passwordViewEpoch++;S.page=nav.dataset.nav;S.provider=null;S.query='';S.status='';render();return;}const node=event.target.closest('[data-action]');if(!node)return;try{await handleAction(node.dataset.action,node.dataset.id,node);}catch(err){toast(err.message||'操作未完成，请重试。');}});
document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[role="button"][data-action]')){event.preventDefault();event.target.click();}});
document.addEventListener('input',event=>{if(event.target.id==='search'){S.query=event.target.value;$('#results').innerHTML=S.page==='commands'?commandResults():S.page==='providers'&&S.provider===null?providerResults():serverResults();}});
document.addEventListener('change',event=>{if(event.target.matches('input[name="customMonthlyServerIds"]')){const form=event.target.closest('form[data-form="custom-monthly-servers"]');if(form?.dataset.form==='custom-monthly-servers')updateCustomMonthlySelectionCount(form);}if(event.target.matches('input[name="costServerIds"]')){const form=event.target.closest('form[data-form="cost-servers"]');if(form?.dataset.form==='cost-servers')updateCostSelectionCount(form);}if(event.target.matches('input[name="serverIds"]')){const form=event.target.closest('form[data-form="telegram-servers"]');if(form)updateTelegramSelectionCount(form);}if(event.target.closest('form[data-form="renewal"]')&&['cycle','periods','baseDate'].includes(event.target.name))updateRenewalDate(event.target.closest('form'));if(event.target.id==='status-filter'){S.status=event.target.value;$('#results').innerHTML=serverResults();}});
document.addEventListener('submit',async event=>{const form=event.target;if(!form.matches('form[data-form]'))return;event.preventDefault();const button=$('button[type="submit"]',form),error=$('.form-error',form);if(button.disabled)return;button.disabled=true;error.textContent='';try{await handleSubmit(form);}catch(err){if(error.isConnected){error.textContent=err.message||'操作未完成，请稍后重试。';error.scrollIntoView({block:'nearest'});}else toast(err.message);}finally{if(form.dataset.form==='custom-monthly-servers')lockCustomMonthlySelection(form,customMonthlySelectionState(form));else if(form.dataset.form==='cost-servers')lockCostSelection(form,costSelectionState(form));else button.disabled=false;}});
dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
dialog.addEventListener('close',()=>{if(!dialog.open){clearCredentialViews();dialog.innerHTML='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){passwordViewEpoch++;clearCredentialViews();if(dialog.dataset.autoHide==='true')closeDialog();}});
const renewalStates=new WeakMap(),restoreStates=new WeakMap();
let backupLoading=false,backupEpoch=0;
const beijingToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function addRenewalMonths(value,months){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');if(!match)return '';
 const [year,month,day]=match.slice(1).map(Number),d=new Date(Date.UTC(year,month-1,1));
 d.setUTCMonth(d.getUTCMonth()+months);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));
 return d.toISOString().slice(0,10);
}
function renewalDialog(id){
 const s=S.workspace.servers.find(x=>x.id===id);if(!s)return;
 const cycle=s.monthlyCostCycle||'monthly',base=dateValue(s.renewalDate||s.renewalDateText)||beijingToday(),next=addRenewalMonths(base,{monthly:1,quarterly:3,yearly:12}[cycle]||1);
 showDialog('记录已续费',s.name,`<div class="info-box renewal-purpose">记录你已向服务商支付的续费，并更新本地到期日。此处不会替你付款，也不会修改套餐常规价格。</div><div class="renewal-date-preview"><span>原到期日 <strong>${shortDate(s.renewalDate||s.renewalDateText)}</strong></span>${icon('arrow',16)}<span>更新至 <strong data-renewal-preview>${shortDate(next)}</strong></span></div><div class="form-grid">${field('amount','本次实际支付',s.monthlyCostAmount,'number','填写实付金额',true,'min="0" step="0.000001"')}${selectField('currency','支付币种',s.monthlyCostCurrency||'CNY',{CNY:'CNY · 人民币',USD:'USD · 美元',HKD:'HKD · 港币',EUR:'EUR · 欧元',JPY:'JPY · 日元',GBP:'GBP · 英镑',CAD:'CAD · 加元'})}${selectField('cycle','续费周期',cycle,{monthly:'月付',quarterly:'季付',yearly:'年付'})}${field('periods','续费期数',1,'number','1',true,'min="1" max="120" step="1"')}${field('paidOn','实际付款日期',beijingToday(),'date','',true)}${field('baseDate','续费起算日',base,'date','',true)}${field('newExpiry','新的到期日',next,'date','',true,'',true)}<p class="field-hint wide">默认从原到期日延长，月底自动取目标月份的最后一天；请以商家账单核对。修改起算日、周期或期数会重新计算建议日期。</p>${area('note','续费备注','','订单号、优惠或付款说明（可不填）',2)}</div>`,action('detail','返回详情','','button',id)+`<button class="button primary" type="submit">${icon('check',15)}保存续费记录</button>`,'renewal',id);
 renewalStates.set($('form',dialog),{requestId:crypto.randomUUID(),revision:S.revision,conflicted:false});
}
function updateRenewalDate(form){
 const periods=Number(val(form,'periods')),cycle=val(form,'cycle');
 if(!Number.isInteger(periods)||periods<1||periods>120)return;
 const next=addRenewalMonths(val(form,'baseDate'),({monthly:1,quarterly:3,yearly:12}[cycle]||1)*periods);
 if(next){$('[name="newExpiry"]',form).value=next;$('[data-renewal-preview]',form).textContent=shortDate(next);}
}
async function saveRenewal(form){
 const state=renewalStates.get(form);if(!state||state.conflicted)throw new Error('资料已变化，请重新核对本次续费。');
 const data={requestId:state.requestId,amount:val(form,'amount'),currency:val(form,'currency'),cycle:val(form,'cycle'),periods:Number(val(form,'periods')),paidOn:val(form,'paidOn'),baseDate:val(form,'baseDate'),newExpiry:val(form,'newExpiry'),note:val(form,'note')};
 form.dataset.busy='true';
 try{await api('/servers/'+encodeURIComponent(form.dataset.id)+'/renewals','POST',data,state.revision);await loadWorkspace();form.dataset.busy='false';render();detailServer(form.dataset.id,'billing');toast('续费已记录，到期日已更新');}
 catch(err){if(err.status===409){await loadWorkspace();state.conflicted=true;$('.form-error',form).insertAdjacentHTML('afterend',`<div class="renewal-conflict info-box warning">资料已在其他页面修改。为避免覆盖，请重新核对最新到期日。${action('renewal-reload','重新核对','refresh','button small-button',form.dataset.id)}</div>`);}throw err;}
 finally{form.dataset.busy='false';}
}
function backupsPage(){
 const data=S.backups,status=data?.status||{},records=data?.backups||[];
 const heading=pageHead('数据备份','每天自动加密保存，恢复前先核对变化。','BACKUPS',action('backups-refresh','刷新','refresh','button')+action('backup','立即备份','plus','button primary'));
 if(!data)return heading+`<section class="panel backup-loading" role="status">正在读取服务器上的加密备份…</section>`;
 if(data.error)return heading+`<section class="panel">${empty('暂时无法读取备份',e(data.error),'shield',action('backups-refresh','重试','refresh','button'))}</section>`;
 return heading+`<div class="backup-stats"><div><span>备份计划</span><strong>${status.enabled===false?'已暂停':'每天自动备份'}</strong><small>每日备份保留 ${Number(status.retentionDays)||7} 天；手动和恢复前各保留 30 份</small></div><div><span>最近成功备份</span><strong>${status.lastBackupAt?reminderTime(status.lastBackupAt):'等待首次备份'}</strong><small>下次检查：${status.nextBackupAt?reminderTime(status.nextBackupAt):'自动检查中'}</small></div></div>${status.lastError?`<div class="info-box warning section-space">最近备份未完成：${e(status.lastError)}。程序会继续重试。</div>`:''}<section class="panel backup-list"><div class="panel-head"><h2>可恢复的版本 <span class="count-label">${records.length}</span></h2><label class="backup-filter">查看范围 <select class="input" id="backup-range"><option value="all">全部保留版本</option><option value="30">最近 30 天</option><option value="7">最近 7 天</option></select></label></div><div class="backup-records">${records.length?records.map(b=>`<article class="backup-row" data-backup-created="${e(b.createdAt)}"><div class="backup-icon">${icon('shield',20)}</div><div class="backup-copy"><h3>${reminderTime(b.createdAt)}</h3><p>${e(({automatic:'自动备份',daily:'每日备份',manual:'手动备份','before-restore':'恢复前备份','pre-restore':'恢复前备份',restore:'恢复前备份'})[b.kind]||'加密备份')} · ${Number(b.serverCount)||0} 台服务器 · ${Number(b.commandCount)||0} 条指令</p><small>${e(b.filename)}</small></div>${action('backup-preview','查看并恢复','refresh','button small-button',b.filename)}</article>`).join(''):empty('还没有备份','首次自动备份生成后会显示在这里，也可以立即创建一份。','shield')}</div><p class="backup-filter-empty field-hint" hidden>这个时间范围内没有备份，可切换查看全部保留版本。</p></section><div class="bottom-note">${icon('lock',14)} 备份文件加密保存在服务器 VPS 文件夹内，不会下载到当前设备。</div>`;
}
async function loadBackups(force=false){
 if(backupLoading)return;backupLoading=true;const epoch=++backupEpoch,session=S.session;
 try{const data=await api('/backups');if(epoch===backupEpoch&&S.session===session){S.backups=data;if(S.page==='backups')render();}}
 catch(err){if(epoch===backupEpoch&&S.session===session){S.backups={error:err.message};if(S.page==='backups')render();}}
 finally{backupLoading=false;}
}
function filterBackups(select){
 const cutoff=select.value==='all'?-Infinity:Date.now()-Number(select.value)*86400000;let visible=0;
 for(const row of document.querySelectorAll('[data-backup-created]')){row.hidden=Number.isFinite(new Date(row.dataset.backupCreated).valueOf())&&new Date(row.dataset.backupCreated).valueOf()<cutoff;if(!row.hidden)visible++;}
 const hint=$('.backup-filter-empty');if(hint)hint.hidden=visible>0;
}
async function previewBackup(filename,node){
 const session=S.session,revision=S.revision;node.disabled=true;
 try{
  const result=await api('/backups/preview','POST',{filename});
  if(S.session!==session||S.page!=='backups'||!node.isConnected)return;
  const summary=result.summary||{},labels={added:'新增',removed:'移除',changed:'更新',unchanged:'不变'},changes=result.changes||[];
  showDialog('核对恢复内容',`备份时间：${reminderTime(result.createdAt)}`,`<div class="restore-summary">${Object.entries(labels).map(([key,label])=>`<div><strong>${Number(summary[key])||0}</strong><span>${label}服务器</span></div>`).join('')}</div><div class="info-box">恢复服务器资料、续费记录、指令和费用选择；当前登录账户、Telegram 设置及已发送提醒记录保留。恢复前会再保存一份当前数据。</div><p class="field-hint section-space">指令：${Number(summary.commandsBefore)||0} → ${Number(summary.commandsAfter)||0} 条（新增 ${Number(result.commands?.added)||0}、移除 ${Number(result.commands?.removed)||0}、更新 ${Number(result.commands?.changed)||0}）${result.settingsChanged?.length?' · '+result.settingsChanged.map(e).join('、')+'有变化':''}</p>${changes.length?`<ul class="restore-changes">${changes.map(change=>`<li><div><strong>${e(change.name||'未命名服务器')}</strong><span class="tag">${e(labels[change.type]||change.type)}</span></div>${change.fields?.length?`<p>${change.fields.map(name=>e(editLabels[name]||({renewalHistory:'续费记录'})[name]||name)).join('、')}</p>`:''}</li>`).join('')}</ul>`:'<p class="field-hint section-space">服务器资料没有变化。</p>'}<p class="field-hint">预览在 ${reminderTime(result.expiresAt)} 失效。备份：${e(filename)}</p>${checkbox('confirmRestore','我已核对差异，确认恢复这些资料')}`,saveFoot('确认恢复'),'backup-restore');
  restoreStates.set($('form',dialog),{previewToken:result.previewToken,filename,revision:result.revision??revision});
 }finally{node.disabled=false;}
}
async function restoreBackup(form){
 const state=restoreStates.get(form);if(!state)throw new Error('预览已失效，请重新查看备份。');
 if(!new FormData(form).has('confirmRestore'))throw new Error('请先勾选确认已核对恢复差异。');
 form.dataset.busy='true';
 try{const result=await api('/backups/restore','POST',{previewToken:state.previewToken,filename:state.filename,confirm:true},state.revision);await loadWorkspace();S.backups=null;form.dataset.busy='false';closeDialog();render();toast(result.message||'资料已恢复，恢复前的数据也已备份');}
 catch(err){if(err.status===409){await loadWorkspace();restoreStates.delete(form);err.message='资料已变化，请关闭后重新查看恢复差异。';}throw err;}
 finally{form.dataset.busy='false';}
}
document.addEventListener('keydown',event=>{
 const tab=event.target.closest('[role="tab"]');if(!tab||!dialog.contains(tab)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 event.preventDefault();const tabs=[...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')],i=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();
});
document.addEventListener('change',event=>{if(event.target.id==='backup-range')filterBackups(event.target);if(event.target.name==='newExpiry'&&event.target.closest('form[data-form="renewal"]'))$('[data-renewal-preview]',event.target.closest('form')).textContent=shortDate(event.target.value);});

init();
