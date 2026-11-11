import {parseRenewalDate} from './renewal-date.mjs';
import {reminderKey,stageOf} from './telegram.mjs';
import {DAY,DIVIDER,html,clean,beijingClock,weekday,remainingText,footer,paginate} from './telegram-format.mjs';

const COMMAND_HINT="💡 可发送：检查 · 到期 30 · 开销 · 帮助";
// Status follows the reminder point that is current today (7–2 days, 1 day, due day).
function receiptFor(state, server, due, daysLeft, config) {
  if (!due || daysLeft < 0 || daysLeft > 7 || typeof config.botToken !== 'string' || typeof config.chatId !== 'string' || !config.botToken || !config.chatId) return null;
  return state.telegramDeliveries?.[reminderKey(server.id, due.date, stageOf(daysLeft), config)] || null;
}
function deliveryLabel(state, server, due, daysLeft, config) {
  if (!due) return '缺日期';
  if (config.enabled !== true) return '已暂停';
  if (!config.botToken || !config.chatId) return '未配置';
  const receipt = receiptFor(state, server, due, daysLeft, config);
  const labels = {sent:'已发送',failed:'发送失败',uncertain:'待确认',pending:'发送中'};
  if (receipt && Object.hasOwn(labels, receipt.state)) return labels[receipt.state];
  return daysLeft < 0 ? '已过期' : daysLeft > 7 ? '待提醒' : '待发送';
}

// The stable export is shared with the query worker; rendering uses normal wrapping text.
export function formatReminderTable(state, {now = new Date()} = {}) {
  const clock = beijingClock(now);
  const config = state?.settings?.telegram || {};
  const selected = (state?.servers || []).filter(server => server.expiryReminder === true).map(server => {
    const due = parseRenewalDate(server.renewalDate || server.renewalDateText);
    return {server, due, daysLeft:due ? Math.round((due.day-clock.day)/DAY) : null};
  }).sort((a,b) => (a.due?.day ?? Infinity) - (b.due?.day ?? Infinity) || clean(a.server.name).localeCompare(clean(b.server.name),'zh-CN'));
  const switchLabel = config.enabled !== true ? '⏸ 自动提醒已暂停' : config.botToken && config.chatId ? '' : '⚙️ 自动提醒未配置';
  const soon = selected.filter(row=>row.daysLeft!==null && row.daysLeft>=0 && row.daysLeft<=7).length;
  const heading = `🗂 <b>VPS 到期清单</b>\n已选 <b>${selected.length}</b> 台 · 7 天内到期 <b>${soon}</b> 台${switchLabel?`\n${switchLabel}`:''}`;
  if (!selected.length) return [`${heading}\n${DIVIDER}\n尚未选择需要提醒的机器。\n请到「系统设置 → Telegram 到期提醒」中选择。\n\n${footer(clock, COMMAND_HINT)}`];
  const sections = {overdue:'🔴 已过期',soon:'🟠 7 天内到期',later:'🔵 后续提醒',missing:'⚪ 待补日期'};
  const totals = {};
  const entries = selected.map(({server,due,daysLeft}) => {
    const section=daysLeft===null?'missing':daysLeft<0?'overdue':daysLeft<=7?'soon':'later';
    totals[section]=(totals[section]||0)+1;
    const status=deliveryLabel(state,server,due,daysLeft,config);
    const extra={已发送:'✓ 已发送',发送失败:'⚠ 发送失败',待确认:'⚠ 待确认',发送中:'发送中',待发送:'等待发送'}[status];
    const first=due?`📅 ${due.date} ${weekday(due.day)} · <b>${remainingText(daysLeft)}</b>`:'⚠️ 未填写续费日期，暂无法提醒';
    const details=[clean(server.provider)&&`🏢 ${html(clean(server.provider))}`,extra&&`<i>${extra}</i>`].filter(Boolean).join(' · ');
    return {section,body:`<b>${html(clean(server.name)||'未命名机器')}</b>\n${details?`├ ${first}\n└ ${details}`:`└ ${first}`}`};
  });
  const render=(part,total,records,last)=>{
    const groups=new Map();
    for(const record of records){if(!groups.has(record.section))groups.set(record.section,[]);groups.get(record.section).push(record.body);}
    const body=[...groups].map(([key,items])=>`<b>${sections[key]} · ${totals[key]} 台</b>\n\n${items.join('\n\n')}`).join('\n\n');
    return `${heading}${total>1?`\n<i>第 ${part}/${total} 页</i>`:''}\n${DIVIDER}\n\n${body}\n\n${footer(clock, last?COMMAND_HINT:'')}`;
  };
  return paginate(entries,render,5);
}
