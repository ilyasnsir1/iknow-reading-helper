'use strict';
const assert=require('node:assert/strict'),Kana=require('./study-focus-kana.js');
for(const [group,count]of[['basic',46],['voiced',25],['combinations',33]]){
 const hira=Kana.entries(group),kata=Kana.entries(group,'katakana');assert.equal(hira.length,count);assert.equal(kata.length,count);
 assert.equal(new Set(hira.map(entry=>entry.id)).size,count);assert.equal(new Set(hira.map(entry=>entry.kana)).size,count);
 hira.forEach((entry,index)=>{
  assert.ok(Kana.check(entry.id,entry.romaji));assert.ok(Kana.check(entry.id,' '+entry.romaji.toUpperCase()+' '));
  assert.equal(kata[index].romaji,entry.romaji);assert.equal(kata[index].kana,Array.from(entry.kana,char=>String.fromCharCode(char.charCodeAt(0)+0x60)).join(''));
  entry.accepted.forEach(alias=>assert.equal(Kana.check(entry.id,alias),true));assert.equal(Kana.check(entry.id,'not-a-reading'),false);
 });
}
assert.equal(Kana.check('basic:は','ha'),true);assert.equal(Kana.check('basic:は','wa'),false,'Isolated chart ha does not become the topic particle');
assert.equal(Kana.check('basic:へ','he'),true);assert.equal(Kana.check('basic:へ','e'),false);
assert.equal(Kana.check('basic:を','wo'),true);assert.equal(Kana.check('basic:を','o'),true);
assert.equal(Kana.check('basic:し','si'),true);assert.equal(Kana.check('basic:し','ｓｈｉ'),true);
assert.equal(Kana.check('voiced:ぢ','ji'),true);assert.equal(Kana.check('voiced:ぢ','di'),true);
assert.equal(Kana.check('voiced:づ','zu'),true);assert.equal(Kana.check('voiced:づ','du'),true);
assert.equal(Kana.check('basic:ん',"n'"),true);assert.equal(Kana.check('basic:ん','nn'),true);
assert.equal(Kana.check('combinations:しゃ','sya'),true);assert.equal(Kana.check('combinations:ちゃ','tya'),true);
assert.equal(Kana.check('unknown','a'),false);assert.deepEqual(Kana.entries('invalid'),[]);assert.deepEqual(Kana.entries('basic','invalid'),[]);
const source=Kana.entries();source[0].accepted.push('bad');source[0].kana='changed';assert.equal(Kana.entries()[0].kana,'あ');assert.equal(Kana.check('basic:あ','bad'),false);
const input=['a','b','c','d'],shuffled=Kana.shuffled(input,()=>0);assert.deepEqual([...shuffled].sort(),[...input].sort());assert.notDeepEqual(shuffled,input);assert.deepEqual(input,['a','b','c','d']);
assert.match(Kana.render(),/data-kana-root/);assert.match(Kana.render(),/Hiragana/);assert.doesNotMatch(Kana.render(),/—|speechSynthesis|AudioContext/);
console.log('PASS Kana: 46 basic,25 voiced,33 combinations; exact scripts, Hepburn/typing alternatives, isolated ha/he, wo/o, input normalization and immutable data');
