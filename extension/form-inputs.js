(() => {
  'use strict';
  const editable='input,textarea,[contenteditable]';
  function configure(input){
    if(!input?.matches?.(editable))return;
    input.spellcheck=false;
    input.setAttribute('autocorrect','off');
  }
  document.documentElement.spellcheck=false;
  document.querySelectorAll(editable).forEach(configure);
  document.addEventListener('focusin',event=>configure(event.target),true);
})();
