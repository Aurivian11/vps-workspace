import {createHash} from 'node:crypto';
import {parseRenewalDate} from './renewal-date.mjs';

const DAY = 86400000;
const MAX_MESSAGE = 3499;
const digest = value => createHash('sha256').update(value).digest('hex');
const html = value => String(value).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const clean = value => String(value ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,' ').replace(/\s+/gu,' ').trim();
function receiptFor(state, server, due, config) {
  if (!due || typeof config.botToken !== 'string' || typeof config.chatId !== 'string' || !config.botToken || !config.chatId) return null;
  const destination = digest(config.botToken.split(':')[0] + '\n' + config.chatId);
  return state.telegramDeliveries?.[digest(server.id + '\n' + due.date + '\n' + destination)] || null;
}
function deliveryLabel(state, server, due, daysLeft, config) {
  if (!due) return '缺日期';
  if (config.enabled !== true) return '已暂停';
  if (!config.botToken || !config.chatId) return '未配置';
  const receipt = receiptFor(state, server, due, config);
  const labels = {sent:'已发送',failed:'发送失败',uncertain:'待确认',pending:'发送中'};
  if (receipt && Object.hasOwn(labels, receipt.state)) return labels[receipt.state];
  return daysLeft < 0 ? '已过期' : daysLeft > 7 ? '待提醒' : '待发送';
}

// The stable export is shared with the query worker; rendering uses normal wrapping text.
export function formatReminderTable(state, {now = new Date()} = {}) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Invalid reminder query time');
  const beijing = new Date(instant.getTime() + 8 * 3600000).toISOString();
  const currentDay = Date.parse(beijing.slice(0,10) + 'T00:00:00Z');
  const config = state?.settings?.telegram || {};
  const selected = (state?.servers || []).filter(server => server.expiryReminder === true).map(server => {
    const due = parseRenewalDate(server.renewalDate || server.renewalDateText);
    return {server, due, daysLeft:due ? Math.round((due.day-currentDay)/DAY) : null};
  }).sort((a,b) => (a.due?.day ?? Infinity) - (b.due?.day ?? Infinity) || clean(a.server.name).localeCompare(clean(b.server.name),'zh-CN'));
  const switchLabel = config.enabled !== true ? '已暂停' : config.botToken && config.chatId ? '已开启' : '未配置';
  const soon = selected.filter(row=>row.daysLeft!==null && row.daysLeft>=0 && row.daysLeft<=7).length;
  const heading = `<b>VPS 到期提醒</b>\n已选 ${selected.length} 台 · 7 天内到期 ${soon} 台${switchLabel==='已开启'?'':`\n自动提醒${switchLabel}`}`;
  const footer = `<i>北京时间：${beijing.slice(0,10)} ${beijing.slice(11,16)}</i>`;
  if (!selected.length) return [heading+'\n\n尚未选择需要提醒的机器。\n请到系统设置 → Telegram 提醒中选择。\n\n'+footer];
  const sections = {overdue:'🔴 已过期',soon:'🟠 7 天内到期',later:'🔵 后续提醒',missing:'⚪ 待补日期'};
  const entries = selected.map(({server,due,daysLeft}) => {
    const section=daysLeft===null?'missing':daysLeft<0?'overdue':daysLeft<=7?'soon':'later';
    const remaining=daysLeft===0?'今天到期':daysLeft<0?`已过期 ${-daysLeft} 天`:`${daysLeft} 天后到期`;
    const detail=due?`${due.date}  ·  <b>${remaining}</b>`:'未填写续费日期，暂无法提醒';
    const status=deliveryLabel(state,server,due,daysLeft,config);
    const extra={已发送:'✓ 已发送',发送失败:'⚠ 发送失败',待确认:'⚠ 待确认',发送中:'发送中',待发送:'等待发送'}[status];
    return {section,body:`<b>${html(clean(server.name)||'未命名机器')}</b>\n${detail}${extra?`\n<i>${extra}</i>`:''}`};
  });
  const message=(part,total,records)=>{
    const groups=new Map();
    for(const record of records){if(!groups.has(record.section))groups.set(record.section,[]);groups.get(record.section).push(record.body);}
    const body=[...groups].map(([key,items])=>`<b>${sections[key]}</b>\n\n${items.join('\n\n')}`).join('\n\n');
    return `${heading}${total>1?`\n第 ${part}/${total} 页`:''}\n\n${body}\n\n${footer}`;
  };
  const pages=[];let current=[];
  for(const entry of entries){
    if(current.length&&(current.length>=5||message(entries.length,entries.length,[...current,entry]).length>MAX_MESSAGE)){pages.push(current);current=[];}
    current.push(entry);
  }
  if(current.length)pages.push(current);
  return pages.map((records,index)=>message(index+1,pages.length,records));
}
