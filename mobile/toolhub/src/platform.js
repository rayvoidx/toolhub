import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
export const native = Capacitor.isNativePlatform();
const KEY='toolhub-pocket-v1';
export const storage={async get(){return native?(await Preferences.get({key:KEY})).value:localStorage.getItem(KEY);},async set(value){if(native)await Preferences.set({key:KEY,value});else localStorage.setItem(KEY,value);}};
export async function exportFile(text,name,type='application/json'){
 if(native){const file=await Filesystem.writeFile({path:name,data:text,directory:Directory.Cache,encoding:Encoding.UTF8});await Share.share({title:'ToolHub Pocket 백업',files:[file.uri],dialogTitle:'백업 파일 저장 또는 공유'});return;}
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function shareText(text){
 if(native){await Share.share({title:'ToolHub Pocket 계산 기록',text,dialogTitle:'계산 기록 공유'});return;}
 if(navigator.share){await navigator.share({title:'ToolHub Pocket 계산 기록',text});return;}
 await exportFile(text,'toolhub-project.txt','text/plain;charset=utf-8');
}
export function setupBack(handler){if(native)App.addListener('backButton',async()=>{if(!handler())await App.minimizeApp();});}
