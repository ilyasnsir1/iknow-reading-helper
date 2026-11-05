(() => {
  'use strict';
  const japanese=/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
  const kanaOnly=/^[\p{Script=Hiragana}\p{Script=Katakana}\p{M}\p{N}\p{P}\sー]+$/u;
  const roman=()=>globalThis.IKnowRomajiKana||(typeof require==='function'?require('./romaji-kana.js'):null);
  const hiragana=text=>text.replace(/[\u30a1-\u30f6]/gu,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
  const katakana=text=>text.replace(/[\u3041-\u3096]/gu,char=>String.fromCharCode(char.charCodeAt(0)+0x60));
  function analyze(value){
    const text=typeof value==='string'?value.trim().normalize('NFC'):'';
    if(!text||text.length>5000)return null;
    if(japanese.test(text)){
      const runs=text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{M}\p{N}\sー。、！？!?「」『』（）()・]+/gu)?.filter(part=>japanese.test(part))||[];
      const full=!/\p{Script=Latin}/u.test(text);
      return {kind:'japanese',text,speech:full?text:runs.map(part=>part.trim()).join('。'),full,...(kanaOnly.test(text)?{hiragana:hiragana(text),katakana:katakana(hiragana(text))}:{})};
    }
    const converted=roman()?.convert(text);
    return converted?.ok?{kind:'romaji',text,speech:converted.kana,hiragana:converted.kana,katakana:katakana(converted.kana),full:true,needsReview:converted.needsReview}:null;
  }
  function faces(record){
    const front=record.german||record.english||'',back=record.japanese||'';
    const result={front:analyze(front),back:analyze(back)};
    if(record.script==='romaji'&&record.kana&&result.back?.kind==='romaji')result.back={...result.back,speech:record.kana,hiragana:hiragana(record.kana),katakana:katakana(hiragana(record.kana))};
    for(const side of ['front','back']){
      const other=side==='front'?'back':'front';
      if(result[side]?.kind==='romaji'&&result[side].text.length<4&&result[other]?.kind==='japanese')result[side]=null;
    }
    return result;
  }
  function primary(record){
    const sides=faces(record),eligible=[sides.back,sides.front].filter(side=>side?.full);
    return eligible.find(side=>side.kind==='japanese')||eligible[0]||null;
  }
  function practiceRecord(record){
    const reading=primary(record);if(!reading)return null;
    const {cardMode,script,...result}=record;
    return {...result,japanese:reading.kind==='romaji'?reading.hiragana:reading.text,kana:reading.hiragana||'',romaji:reading.kind==='romaji'?reading.text:''};
  }
  const api=Object.freeze({analyze,faces,primary,practiceRecord});
  globalThis.IKnowNojiCardReading=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
