# Two alignment perspectives

Choose **Alignment → Meaning groups** or **Word detail** in the course toolbar or extension popup. The choice is remembered. **Colors** still controls whether colors are always shown, shown on hover, or off; **Meaning** still controls hover explanations. These are independent controls.

**Meaning groups** is the default and retains the existing sentence-level meaning groups. A group can legitimately join several Japanese words and several translation words, including separated passages.

**Word detail** uses smaller links when they are supported. It separates the reviewed sore/da and March examples, and refines other courses using exact vocabulary entries, checked reading boundaries and unique matches inside an existing meaning group. It does not infer word meaning from word position or force every token into a pair. Unknown conjugations, ambiguous vocabulary matches and mismatched Japanese/Kana segmentation retain an explicitly identified phrase equivalent or remain neutral. A retained group explains this limitation in its Meaning hint. This is a conservative refinement, not a new general-purpose translator or a promise of perfect word alignment.

One Japanese unit may have an English counterpart, a German counterpart, both, or neither. In the March example, 忙しい links to the German expression “viel zu tun”, while there is no separate non-overlapping English word in the paraphrase “I have a lot of work”. The view does not incorrectly assign it to “lot”. Contextual material such as “I/ich”, supplied articles, and unaligned prepositions stays neutral in the reviewed fine-grained example. The が-marked subject there is 仕事 (“work”); “ich” is the perspective of the natural German translation.

Particles are not categorically meaningless or always uncolored. は/が/を are neutralized only when they are securely identified and lack a lexical counterpart in the retained link. も can correspond to “too/auch”, and の may participate in a larger grammatical expression. The fine-grained sore example separates それ ↔ That/Das and だ ↔ ’s/ist, with は and supplied articles left neutral.

Japanese script, Kana, Romaji and English/German translation spans share the resulting groups. In Both mode the hover explanation follows the translation line's language. This view runs locally on existing course data. It adds no model download or automatic preparation and does not rewrite saved alignments, source fingerprints, translations or audio.

## A reviewed source correction

The iKnow source for cue246987 contains “I think so too. Let's listen to one.” for 私もそう思います。. The second English sentence has no counterpart in that Japanese sentence. The normal enhanced display shows “I think so too.”; **Source** reveals the complete original. The correction applies only to the exact reviewed ID, signature and source text/readings. Other multi-sentence translations are not shortened automatically. Disabling the extension restores the native source display.

Underlying source text and cached hashes remain unchanged. If an imported/generated group incorrectly reaches into the omitted suffix, the entire questionable display group is excluded rather than clipped or reassigned. Existing German group indices remain aligned to retained groups.

## References and verification limits

- [iKnow public course19053 source](https://iknow.jp/api/v2/goals/19053): original cue/response246987/246988, checked2026-10-28.
- [Japan Foundation, Irodori Starter Lesson3, p.14](https://www.irodori.jpf.go.jp/assets/data/starter/pdf/X_L03.pdf#page=14): topic は and contextual omission. This does not make every absent English subject an omitted 私.
- [Japan Foundation, Marugoto noun grammar appendix](https://a2.marugotoweb.jp/en/grammar/reference/004.html): plain だ and polite です forms.
- [University of Texas, JOSHU: Liking and Disliking](https://www.laits.utexas.edu/japanese/joshu/grammar/glist/y1/ch2/gl_y1_ch2_suki_kirai.php): the construction with が and 好き illustrates why a particle does not have one fixed translation word.

Automated tests cover the two reviewed examples, independent English/German links, generic vocabulary anchors on additional sentences, ambiguous/mismatched cases, stored packs, unchanged sources, mode persistence and audio-target preservation. A400-record sweep verifies structural bounds, non-overlap and non-mutation; it is not a linguistic review of every generated link.
