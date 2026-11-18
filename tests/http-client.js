const assert=require('node:assert/strict');
module.exports=async function createClient(base,username,password,sessions=new Set()){
 let cookie='',csrf='';
 async function request(path,fields){
  const multipart=fields instanceof FormData;
  const r=await fetch(base+path,{redirect:'manual',method:fields?'POST':'GET',headers:{Cookie:cookie,...(fields&&!multipart?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(fields?{body:multipart?fields:new URLSearchParams(fields)}:{})});
  for(const value of r.headers.getSetCookie())if(value.startsWith('shiguang.sid=')){cookie=value.split(';')[0];const s=decodeURIComponent(cookie.split('=').slice(1).join('='));if(s.startsWith('s:'))sessions.add(s.slice(2).split('.')[0]);}
  const body=await r.text(),match=body.match(/name="_csrf" value="([a-f0-9]{64})"/);if(match)csrf=match[1];return {status:r.status,headers:r.headers,body};
 }
 const post=(path,fields={})=>{if(fields instanceof FormData){const data=new FormData();data.set('_csrf',fields.has('_csrf')?fields.get('_csrf'):csrf);for(const [key,value]of fields)if(key!=='_csrf')data.append(key,value);return request(path,data);}return request(path,{_csrf:csrf,...fields});};
 if(username){await request('/login');assert.equal((await post('/login',{identifier:username,password})).status,303);await request('/account');}
 return {request,post};
};
