import { describe,it,expect } from 'vitest';
import { createPublicFetcher,isPublicAddress,publicUrl,robotsPermits,robotsCrawlDelay } from '../server/secureWeb';
import { retryDelay } from '../server/http';
const ctx=()=>({signal:new AbortController().signal,budget:{used:0,limit:20},meter:{requests:0}});
const publicDns=async()=>[{address:'93.184.216.34',family:4}];
describe('public web request security (synthetic transport)',()=>{
  it('honors Retry-After seconds and dates without reducing the existing cooldown',()=>{
    expect(retryDelay('120',30000)).toBe(120000);expect(retryDelay('1',30000)).toBe(30000);expect(retryDelay('invalid',30000)).toBe(30000);
    const future=new Date(Date.now()+180000).toUTCString();expect(retryDelay(future,30000)).toBeGreaterThan(178000);
  });
  it('blocks local, private, metadata, mapped IPv6 and reserved destinations',()=>{
    for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','100.100.100.200','192.168.1.2','172.20.1.2','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::'])expect(isPublicAddress(ip),ip).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    for(const url of ['file:///etc/passwd','http://2130706433/','http://localhost/','http://user:pass@example.com/','https://example.com:8443/'])expect(()=>publicUrl(url)).toThrow();
  });
  it('rejects hostname with mixed public/private DNS answers before transport',async()=>{
    let calls=0;const fetch=createPublicFetcher({spacing:0,resolve:async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}],transport:async()=>{calls++;return{status:200,headers:{},body:''};}});
    await expect(fetch('https://example.com/article',ctx())).rejects.toThrow('內部');expect(calls).toBe(0);
  });
  it('checks redirect destinations before issuing an internal request',async()=>{
    const paths:string[]=[];const fetch=createPublicFetcher({spacing:0,resolve:publicDns,transport:async url=>{paths.push(url.pathname);return url.pathname==='/robots.txt'?{status:200,headers:{},body:'User-agent: *\nAllow: /'}:{status:302,headers:{location:'http://169.254.169.254/latest/meta-data'},body:''};}});
    await expect(fetch('https://example.com/article',ctx())).rejects.toThrow('內部');expect(paths).toEqual(['/robots.txt','/article']);
  });
  it('obeys specific robots rules and longest allow exception',()=>{
    const text='User-agent: *\nDisallow: /\nUser-agent: SiteBite-Web\nDisallow: /private\nAllow: /private/public';
    expect(robotsPermits(text,new URL('https://example.com/article'))).toBe(true);
    expect(robotsPermits(text,new URL('https://example.com/private/data'))).toBe(false);
    expect(robotsPermits(text,new URL('https://example.com/private/public/article'))).toBe(true);
  });
  it('fails closed when robots policy cannot be obtained and never reads article',async()=>{
    const paths:string[]=[];const fetch=createPublicFetcher({spacing:0,resolve:publicDns,transport:async url=>{paths.push(url.pathname);return{status:403,headers:{},body:'Forbidden'};}});
    await expect(fetch('https://example.com/article',ctx())).rejects.toThrow('robots');expect(paths).toEqual(['/robots.txt']);
  });
  it('enforces body size, API allowlist and request accounting; cache does not make new requests',async()=>{
    const fetch=createPublicFetcher({spacing:0,resolve:publicDns,transport:async()=>({status:200,headers:{},body:'{"ok":true}'})});const context=ctx();
    await expect(fetch('https://example.com/api',context,{api:true})).rejects.toThrow('未授權');
    await expect(fetch('https://en.wikipedia.org/w/api.php',context,{api:true,maxBytes:2})).rejects.toThrow('大小');
    const first=await fetch('https://en.wikipedia.org/w/api.php',context,{api:true});const second=await fetch('https://en.wikipedia.org/w/api.php',context,{api:true});
    expect(first.cached).toBe(false);expect(second.cached).toBe(true);expect(context.budget.used).toBe(2);expect(context.meter.requests).toBe(2);
  });
  it('checks robots again at redirected host and passes the verified DNS address to transport',async()=>{
    const requests:string[]=[];const fetch=createPublicFetcher({spacing:0,resolve:publicDns,transport:async(url,address)=>{
      expect(address.address).toBe('93.184.216.34');requests.push(url.href);
      if(url.hostname==='other.example')return{status:200,headers:{},body:'User-agent: *\nDisallow: /'};
      return url.pathname==='/robots.txt'?{status:200,headers:{},body:'User-agent: *\nAllow: /'}:{status:302,headers:{location:'https://other.example/private'},body:''};
    }});
    await expect(fetch('https://example.com/article',ctx())).rejects.toThrow('robots');expect(requests).toEqual(['https://example.com/robots.txt','https://example.com/article','https://other.example/robots.txt']);
  });
  it('cancels a pending DNS resolution and never issues a request',async()=>{
    const controller=new AbortController();let requests=0;const fetch=createPublicFetcher({spacing:0,resolve:()=>new Promise(()=>{}),transport:async()=>{requests++;return{status:200,headers:{},body:''};}});
    const pending=fetch('https://en.wikipedia.org/w/api.php',{...ctx(),signal:controller.signal},{api:true});setTimeout(()=>controller.abort(),10);
    await expect(pending).rejects.toThrow();expect(requests).toBe(0);
  });
  it('respects applicable crawl-delay and cancels waiting work without requesting page',async()=>{
    expect(robotsCrawlDelay('User-agent: *\nCrawl-delay: 5\nUser-agent: SiteBite-Web\nCrawl-delay: 20')).toBe(20);
    const controller=new AbortController();const paths:string[]=[];const fetch=createPublicFetcher({spacing:0,resolve:publicDns,transport:async url=>{paths.push(url.pathname);return{status:200,headers:{},body:'User-agent: *\nCrawl-delay: 60\nAllow: /'};}});
    const pending=fetch('https://example.com/article',{...ctx(),signal:controller.signal});setTimeout(()=>controller.abort(),30);
    await expect(pending).rejects.toThrow();expect(paths).toEqual(['/robots.txt']);
  });
  it('rejects cross-origin robots redirection instead of trusting unrelated policy',async()=>{
    const paths:string[]=[];const fetch=createPublicFetcher({spacing:0,resolve:publicDns,transport:async url=>{paths.push(url.href);return{status:302,headers:{location:'https://unrelated.example/robots.txt'},body:''};}});
    await expect(fetch('https://example.com/article',ctx())).rejects.toThrow('不同來源');expect(paths).toEqual(['https://example.com/robots.txt']);
  });
});
