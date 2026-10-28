# Meaning explanations

Meaning shows a word/group mapping plus an explanatory note when one is available. These are contextual language tips, not random cultural facts. Notes do not certify automatically generated translations or color alignments.

Alignment → Word detail can add a grammatical explanation or explicitly identify a retained phrase when a smaller link cannot be established. The reviewed March note distinguishes the が-marked subject 仕事 from the translation viewpoint I/ich. A separately reviewed source correction takes priority over the older “unmarked extra sentence” note because the unrelated suffix is now omitted from the enhanced display. See [ALIGNMENT-MODES.md](ALIGNMENT-MODES.md).

In Both mode the hint uses the hovered or keyboard-focused phrase's language: English for an English translation phrase, German for a German phrase. Both mappings/explanations are no longer combined in one hint. Japanese/Kana/Romaji default to English. Clicking to pin retains that source language until it is changed or dismissed.

The explanation remains reachable when moving the pointer into it. Select text and copy with the browser's normal controls. Pin keeps the hint visible after the pointer leaves; Shift-clicking a colored group is a shortcut that does not play audio or extend the browser text selection. Unpin and Escape dismiss it immediately; a later normal hover can open it again. No clipboard permission or automated clipboard writes are used. Pins retain their chosen language, clear when Meaning is disabled, and are not persisted as course data.

A German explanation may intentionally quote English when discussing a translation choice. This alone is not a language-routing failure or a reason to rewrite the note. The offer/doctor changes in1.30.1 were specific reviewed clarifications, not a general rewrite or proof that all other note content is error-free. Existing wording is retained in1.30.2.

Two source-bound reviewed notes explain the offer in 私が行きましょう。 directly in each language and the result-state use of に in 彼は医者になりました。. The German suggestion note no longer quotes the English construction. The doctor note explains why the natural German profession wording is “Er ist Arzt geworden”; the translation is not changed to force an article.

Specific sentence notes take priority. Their reviewed English/German pairs are retained in `extension/english-notes.js`; the German-specific field takes priority in German. Existing explanations survive compatible stored-pack merges, including when a later preparation result contains only a technical model stamp. German-specific explanations are retained only for the same German translation text. Different sentence signatures are never combined.

`extension/meaning-notes.js` supplies a small bilingual fallback for clear request forms and corroborated shared-action suggestions. It includes a specific explanation for 家に遊びにきてください。 These hints run locally and do not start preparation or change saved data. They are not a general grammar parser: unsupported or ambiguous constructions intentionally receive no generic note. In particular, negative/causative requests, quoted/conditional clauses, and ましょうか are not mislabeled as ordinary positive requests or shared-action suggestions. The English translation corroborates the generic request/suggestion matches. Existing sentence-specific explanations always win.

## Primary references

- [Japan Foundation, Irodori Starter Lesson10, grammar p.19](https://www.irodori.jpf.go.jp/assets/data/starter/pdf/X_L10.pdf#page=19): te-form requests and instructions; distinction between 〜てください and more casual forms.
- [University of Texas, JOSHU Negative Request](https://www.laits.utexas.edu/japanese/joshu/grammar/glist/y2/ch2/gl_y2_ch2_negrequest.php): 〜ないでください and negative-request examples.
- [Agency for Cultural Affairs, everyday Japanese teaching material, p.30](https://www.bunka.go.jp/seisaku/kokugo_nihongo/kyoiku/seikatsusha/h25_nihongo_program_a/pdf/a_35.pdf#page=30): noun + をください for requesting goods/ordering.
- [Japan Foundation, Vましょう](https://www.jpf.go.jp/j/urawa/j_rsorcs/textbook/setsumei_pdf/setsumei05_4.pdf): proposals/invitations and context-dependent uses. The fallback requires an English “Let's …” reading instead of inferring it from the ending alone.
- [Japan Foundation, Irodori Elementary1 Lesson3, p.13](https://www.irodori.jpf.go.jp/assets/data/elementary01/pdf/Y_L03.pdf#page=13): noun + に + なります for a resulting state/change.
- [IDS grammis: Prädikativ](https://grammis.ids-mannheim.de/vggf/2281?termini=term): article-free profession predicates and their contrast with modified noun phrases.
- [Japan Foundation, CareNavi 医師/医者](https://eng.nihongodecarenavi.jp/sp/jpn/entry_366.html): medical profession vocabulary.

The short bilingual explanations are original paraphrases of these grammatical points. A note is not available for every sentence.
