export interface ViewOptions { embedded:boolean; compact:boolean; language:'de'|'en'; theme:'auto'|'light'|'dark'; parentOrigin:string|null }
export function readViewOptions(href:string):ViewOptions
export function resolveApiUrl(base:string,path:string):string
export function validFrameMessage(value:unknown):boolean
export function readSetting<T extends string>(key:string,fallback:T,allowed:T[]):T
export function writeSetting(key:string,value:string):void
