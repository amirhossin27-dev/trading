import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readViewOptions, resolveApiUrl, validFrameMessage } from '../src/runtime.mjs';

test('standalone stays full; embedded compact mode has an explicit parent', () => {
 assert.deepEqual(readViewOptions('https://example.com/live-scores/'), {embedded:false,compact:false,language:'de',theme:'auto',parentOrigin:null});
 assert.deepEqual(readViewOptions('https://example.com/live-scores/?embed=1&view=compact&lang=en&theme=dark&parentOrigin=https%3A%2F%2Fdashboard.example'), {embedded:true,compact:true,language:'en',theme:'dark',parentOrigin:'https://dashboard.example'});
});
test('invalid embed options cannot turn into script URLs or unsupported themes', () => {
 const opts=readViewOptions('https://example.com/?view=compact&lang=fr&theme=evil&parentOrigin=javascript:alert(1)');
 assert.equal(opts.compact,false); assert.equal(opts.parentOrigin,null); assert.equal(opts.language,'de'); assert.equal(opts.theme,'auto');
});
test('API URL preserves configured prefix and rejects insecure production endpoints', () => {
 assert.equal(resolveApiUrl('https://api.example/prefix/', '/api/sports/scores?q=one'), 'https://api.example/prefix/api/sports/scores?q=one');
 assert.equal(resolveApiUrl('http://localhost:5181', '/api/health'), 'http://localhost:5181/api/health');
 assert.throws(()=>resolveApiUrl('http://remote.example', '/api/health'));
 assert.throws(()=>resolveApiUrl('', '/api/health'));
 assert.throws(()=>resolveApiUrl('https://api.example', '//evil.example'));
});
test('frame size messages are bounded and have a strict protocol', () => {
 assert.equal(validFrameMessage({type:'standalone-app:resize',height:850}),true);
 for(const value of [{type:'other',height:850},{type:'standalone-app:resize',height:999999},{type:'standalone-app:resize',height:'850'},null]) assert.equal(validFrameMessage(value),false);
});
