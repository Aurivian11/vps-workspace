// Imported records may store a calendar date only in renewalDateText.
// Preserve calendar meaning; do not apply timezone conversion to recorded days.
export function parseRenewalDate(value) {
  if(typeof value!=='string')return null;
  const match=/^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:T\d.*)?$/.exec(value.trim());
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[3]),day=Number(match[4]);
  if(month<1||month>12||day<1||day>31)return null;
  const result=new Date(0);result.setUTCFullYear(year,month-1,day);result.setUTCHours(0,0,0,0);
  if(result.getUTCFullYear()!==year||result.getUTCMonth()!==month-1||result.getUTCDate()!==day)return null;
  return {date:[String(year).padStart(4,'0'),String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-'),day:result.getTime()};
}
