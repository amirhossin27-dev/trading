export interface ViewOptions { embedded:boolean; compact:boolean; language:'de'|'en'; theme:'auto'|'light'|'dark'; parentOrigin:string|null }
export function readViewOptions(href:string):ViewOptions
export function resolveApiUrl(base:string,path:string):string
export function validFrameMessage(value:unknown):boolean
