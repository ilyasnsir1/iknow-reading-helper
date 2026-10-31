/* Durable learning for the shared workspace, using existing background transactions. */
(() => {
  'use strict';
  const KEY='iknowReaderStudyWorkspaceView',LIMIT=1800000;
  function create({runtime,practice,reviewQuestion,getLanguage,getGapPosition}){
    const storage=()=>globalThis.sessionStorage;
    function persistView(round){
      if(!round?.runtimeId)return;
      const value={id:round.runtimeId,index:round.index,keys:round.keys,results:round.results,lastSubmitted:round.lastSubmitted,answerAttempts:round.answerAttempts,answerHistory:round.answerHistory,finishedAt:round.finishedAt||0,complete:round.complete};
      try{const text=JSON.stringify(value);if(text.length<=LIMIT)storage().setItem(KEY,text);else storage().removeItem(KEY);}catch{}
    }
    function readView(stored){
      try{const text=storage().getItem(KEY);if(!text||text.length>LIMIT)return null;const view=JSON.parse(text),keys=stored.cards.map(card=>card.key);
        if(view.id!==stored.id||JSON.stringify(view.keys)!==JSON.stringify(keys)||!Number.isSafeInteger(view.index)||view.index<0||view.index>keys.length)return null;
        const strings=value=>Array.isArray(value)&&value.length===keys.length&&value.every(text=>typeof text==='string'&&text.length<=5000);
        if(!strings(view.lastSubmitted)||!Array.isArray(view.answerAttempts)||view.answerAttempts.length!==keys.length||view.answerAttempts.some(n=>!Number.isSafeInteger(n)||n<0||n>1000000))return null;
        return view;
      }catch{return null;}
    }
    async function begin(round){const stored=await runtime.beginRound(round,{language:getLanguage(),gapPosition:getGapPosition()});round.runtimeId=stored.id;persistView(round);return stored;}
    async function answer(round,correct,submitted,shown){
      if(!round?.runtimeId)throw Error('This practice session is not ready.');
      const index=round.index,attempt=round.answerAttempts[index]+(shown?0:1);
      if(!shown)await runtime.submitAttempt(round.runtimeId,index,attempt);
      const done=correct||shown||round.attempts==='single'||attempt>=2;
      const outcome=correct?(attempt===1?'good':'hard'):'again';
      if(done)await runtime.commitAnswer(round.runtimeId,index,outcome);
      return{done,outcome};
    }
    async function finish(round){
      if(!round?.runtimeId)return;
      if(!round.results.some(row=>row.key===round.keys[round.index])&&round.answerAttempts[round.index]>0)await runtime.commitAnswer(round.runtimeId,round.index,'again');
      await runtime.endRound(round.runtimeId);
      try{storage().removeItem(KEY);}catch{}
    }
    function restore(stored){
      if(!stored)return null;
      const pool=stored.pool||stored.cards,keys=stored.cards.map(card=>card.key),byKey=new Map(pool.map(card=>[card.key,card]));
      const exercises=keys.map(key=>{const card=byKey.get(key);return stored.mode==='cloze'?practice.buildCloze(card,{targetIndex:stored.targets[key],romajiStyle:'source'}):stored.mode==='listening'?practice.buildListening(card,{romajiStyle:'source'}):reviewQuestion(card,pool);});
      if(exercises.some(value=>!value))throw Error('This saved session has unavailable questions. Its progress has been kept.');
      const expected=index=>stored.mode==='review'?exercises[index].choices.find(choice=>choice.id===exercises[index].correctId)?.label||byKey.get(keys[index]).english:stored.mode==='cloze'?[exercises[index].answerJapanese,exercises[index].answerRomaji].filter(Boolean).join(' · '):exercises[index].displayRomaji||exercises[index].details.japanese;
      const view=readView(stored),round={keys,pool,index:stored.index,mode:stored.mode,test:stored.kind==='test',exercises,attempts:stored.attemptPolicy,results:[],answerAttempts:keys.map(()=>0),answerHistory:keys.map(()=>[]),lastSubmitted:keys.map(()=>''),complete:false,startedAt:stored.createdAt,finishedAt:0,courseId:stored.courseId||'',courseTitle:stored.label||'',runtimeId:stored.id};
      const savedResults=new Map((view?.results||[]).filter(row=>row&&typeof row.key==='string').map(row=>[row.key,row]));
      for(let index=0;index<stored.results.length;index++){
        const grade=stored.results[index],cached=savedResults.get(grade.key),compatible=cached?.outcome===grade.outcome;
        const submitted=compatible&&typeof cached.submitted==='string'?cached.submitted.slice(0,5000):'';
        const attempts=compatible&&Number.isSafeInteger(cached.attempts)?cached.attempts:grade.outcome==='hard'?2:1;
        const history=compatible&&Array.isArray(cached.attemptsHistory)?cached.attemptsHistory.slice(-50).filter(row=>row&&typeof row.submitted==='string').map(row=>({submitted:row.submitted.slice(0,5000),correct:row.correct===true,shown:row.shown===true})):[];
        round.results.push({key:grade.key,japanese:byKey.get(grade.key).japanese,expected:expected(index),submitted,outcome:grade.outcome,attempts,attemptsHistory:history});round.answerAttempts[index]=attempts;round.answerHistory[index]=history;round.lastSubmitted[index]=submitted;
      }
      if(view&&view.index===stored.index-1&&savedResults.has(keys[view.index]))round.index=view.index;
      if(stored.index<keys.length){
        const index=stored.index;round.answerAttempts[index]=stored.attempts;
        if(view&&view.index===index){round.lastSubmitted[index]=view.lastSubmitted[index];
          round.answerHistory[index]=(Array.isArray(view.answerHistory?.[index])?view.answerHistory[index]:[]).slice(-Math.min(50,stored.attempts)).filter(row=>row&&typeof row.submitted==='string').map(row=>({submitted:row.submitted.slice(0,5000),correct:row.correct===true,shown:row.shown===true}));}
      }
      if(stored.index===keys.length){round.index=Math.max(0,keys.length-1);round.complete=true;round.finishedAt=Date.now();}
      return round;
    }
    return Object.freeze({begin,answer,finish,restore,persistView});
  }
  globalThis.IKnowStudyWorkspaceRounds=Object.freeze({create});
})();
