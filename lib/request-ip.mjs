import {isIP} from 'node:net';

function normalizeIP(value){
  if(typeof value!=='string'||!isIP(value)||value.includes('%'))return null;
  if(isIP(value)===4)return value;
  const canonical=new URL(`http://[${value}]/`).hostname.slice(1,-1);
  const mapped=canonical.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/i);
  if(mapped){const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);return [high>>>8,high&255,low>>>8,low&255].join('.');}
  return canonical;
}

export function createClientIPResolver(trustedProxies=[]){
  if(!Array.isArray(trustedProxies))throw Error('trustedProxies must be an array of explicit IP addresses.');
  const trusted=new Set(trustedProxies.map(value=>{const ip=normalizeIP(value);if(!ip)throw Error('Invalid trusted proxy IP address.');return ip;}));
  return req=>{
    const peer=normalizeIP(req.socket.remoteAddress)||'unknown';
    // The configured proxy must overwrite X-Real-IP with its actual client address.
    // Never trust forwarded headers from direct clients or an appended XFF chain.
    const forwarded=trusted.has(peer)?normalizeIP(req.headers['x-real-ip']):null;
    return forwarded||peer;
  };
}
