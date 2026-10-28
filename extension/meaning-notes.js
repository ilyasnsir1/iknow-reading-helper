/* Small, bilingual usage hints for clearly identifiable constructions.
 * Specific authored sentence notes always take priority in content.js.
 * References and conservative matching limits: MEANING-NOTES.md.
 */
(() => {
  "use strict";
  const note = (en, de) => Object.freeze({ en, de });
  const visit = note(
    "A verb’s te-form + ください makes a polite request. Here it asks the listener to come over for a visit.",
    "Mit der te-Form + ください bittet man höflich um eine Handlung. Hier gehört ください zur Bitte, zu Besuch zu kommen."
  );
  const negativeRequest = note(
    "The form 〜ないでください asks someone not to do something. It is a polite negative request.",
    "Mit der Form 〜ないでください bittet man jemanden, etwas nicht zu tun. Es ist eine höfliche verneinte Bitte."
  );
  const actionRequest = note(
    "A verb’s te-form + ください makes a polite request to do something. This form is also common in instructions; the English word “please” expresses the request.",
    "Mit der te-Form + ください bittet man höflich um eine Handlung. Die Form ist auch bei Anweisungen üblich; im Deutschen wird die Bitte oft mit „bitte“ ausgedrückt."
  );
  const objectRequest = note(
    "A noun + をください asks for an item. Here, ください is a request for something, whereas a verb’s te-form + ください asks someone to do something.",
    "Mit Nomen + をください bittet man um einen Gegenstand. Hier wird also um etwas gebeten; mit der te-Form eines Verbs + ください bittet man dagegen um eine Handlung."
  );
  const suggestion = note(
    "The ending ましょう can suggest doing something together. Here it corresponds to “Let’s …”, rather than describing something that has already happened.",
    "Mit ましょう kann man eine gemeinsame Handlung vorschlagen. Hier entspricht es „Lass uns …“ und beschreibt keine bereits geschehene Handlung."
  );
  function context(japanese, english) {
    const ja = typeof japanese === "string" ? japanese.replace(/\s+/gu, "") : "";
    const en = typeof english === "string" ? english.trim() : "";
    if (/^家に遊びに(?:き|来)てください[。！？!?]*$/u.test(ja)) return visit;
    // Match complete terminal constructions, not a quoted or conditional clause.
    if (/ないでください[。！？!?]*$/u.test(ja) && /\b(?:don[’']t|do not)\b/iu.test(en)) return negativeRequest;
    // Do not mislabel negative requests or causative permission requests. The
    // broad せて exclusion deliberately also skips ambiguous lexical endings.
    if (/(?:ないで|せて)ください[。！？!?]*$/u.test(ja)) return null;
    if (/[てで]ください[。！？!?]*$/u.test(ja) && /\bplease\b/iu.test(en)) return actionRequest;
    if (/をください[。！？!?]*$/u.test(ja) && /\bplease\b/iu.test(en)) return objectRequest;
    // English corroborates the shared-action reading; ましょうか offers and
    // other context-dependent uses receive no generic suggestion annotation.
    if (/ましょう[。！？!?]*$/u.test(ja) && /^let[’']s\b/iu.test(en)) return suggestion;
    return null;
  }
  const reviewedNotes = Object.freeze({
    "246971:3a8569d9": note(
      "行きましょう is the polite volitional form of 行く. With 私が, the speaker offers to go personally. This is a proposal, not a request for a reason.",
      "行きましょう ist die höfliche Willensform von 行く. Mit 私が bietet der Sprecher hier an, selbst zu gehen. Gemeint ist ein Vorschlag, keine Frage nach einem Grund."
    ),
    "246977:bae90119": note(
      "医者 (isha) means a medical doctor. With なる, に marks the resulting state, not the article “a”. Japanese does not express an English-style article here.",
      "医者（いしゃ） heißt „Arzt“. に markiert bei なる das Ergebnis der Veränderung, keinen Artikel. „Er ist Arzt geworden“ ist die übliche deutsche Berufsangabe ohne „ein“."
    )
  });
  function reviewed(id, signature) { return reviewedNotes[`${id}:${signature}`] || null; }
  const api = Object.freeze({ context, reviewed });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.IKnowReaderMeaningNotes = api;
})();
