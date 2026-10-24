import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('production offline worker serves its cached shell and retains unrelated caches',async()=>{
 const source=await readFile(new URL('../../../workspace/sw.js',import.meta.url),'utf8');
 const handlers={},stores=new Map([['hub-v6',new Map()],['pocket-old',new Map()]]),base='https://tool-hub.me/workspace/';
 const key=x=>new URL(typeof x==='string'?x:x.url,base).href;
 const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());return {async addAll(files){for(const file of files)stores.get(name).set(key(file),'cached:'+key(file));}};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);},async match(request){for(const store of stores.values()){const value=store.get(key(request));if(value)return value;}}};
 vm.runInNewContext(source,{URL,Promise,caches,fetch:()=>Promise.reject(Error('offline')),self:{location:new URL(base+'sw.js'),addEventListener:(type,fn)=>handlers[type]=fn,skipWaiting:()=>Promise.resolve(),clients:{claim:()=>Promise.resolve()}}});
 async function lifecycle(type){let pending;handlers[type]({waitUntil:p=>pending=p});await pending;}
 await lifecycle('install');await lifecycle('activate');assert.ok(stores.has('hub-v6'));assert.ok(!stores.has('pocket-old'));
 let response;handlers.fetch({request:{url:base,method:'GET',mode:'navigate'},respondWith:p=>response=p});assert.equal(await response,'cached:'+base);
 response=undefined;handlers.fetch({request:{url:base+'icon-192.png',method:'GET',mode:'no-cors'},respondWith:p=>response=p});assert.equal(await response,'cached:'+base+'icon-192.png');
 for(const url of ['https://tool-hub.me/unit-price/','https://external.example/workspace/']){response=undefined;handlers.fetch({request:{url,method:'GET',mode:'navigate'},respondWith:p=>response=p});assert.equal(response,undefined);}
});
