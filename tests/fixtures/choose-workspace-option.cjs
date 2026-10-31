/* Drive the visible arrow controls as a user would, without mutating controller state. */
'use strict';
module.exports=async function chooseWorkspaceOption(page,selector,value){
 const output=page.locator(selector);
 await output.waitFor();
 for(let count=0;count<5;count++){
  if(await output.getAttribute('data-value')===value)return;
  await output.locator('..').locator('[data-choice-step="next"]').click();
 }
 throw Error(`The visible setting ${selector} does not offer ${value}.`);
};
