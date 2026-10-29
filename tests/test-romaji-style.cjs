"use strict";
const assert = require("node:assert/strict"), Core = require("../extension/core.js");
const sentence = {
  kind: "sentence", japanese: "私は学校へ本を持って行きます。",
  kana: "わたし は がっこう へ ほん を もって いきます。",
  jpan: "私 は 学校 へ 本 を 持って 行きます 。",
  romaji: "  watashi\tha gakkou he hon wo motte ikimasu.  "
};
assert.equal(Core.normalizeSettings({}).romajiStyle, "source");
assert.equal(Core.normalizeSettings({romajiStyle:"spoken"}).romajiStyle, "spoken");
assert.equal(Core.normalizeSettings({romajiStyle:"invalid",pronunciation:true}).romajiStyle, "source");
assert.equal(Core.normalizeSettings({pronunciation:true}).pronunciation, false);
assert.equal(Core.displayRomaji(sentence, "source"), sentence.romaji);
assert.equal(Core.displayRomaji(sentence, "spoken"), "  watashi\twa gakkou e hon o motte ikimasu.  ");
assert.equal(Core.displayRomaji({...sentence,kind:"word"}, "spoken"), sentence.romaji);
assert.equal(Core.displayRomaji({...sentence,jpan:""}, "spoken"), sentence.romaji);
assert.equal(Core.displayRomaji({...sentence,jpan:"",japanese:sentence.jpan}, "spoken"), "  watashi\twa gakkou e hon o motte ikimasu.  ");
assert.equal(Core.displayRomaji({...sentence,jpan:"私 は 学校へ 本 を 持って 行きます 。"}, "spoken"), "  watashi\twa gakkou he hon o motte ikimasu.  ");
for (const value of [
  {kind:"word",romaji:"ha",kana:"は",jpan:"は",japanese:"は"},
  {kind:"sentence",romaji:"ha ga itai.",kana:"は が いたい。",jpan:"歯 が 痛い 。",japanese:"歯が痛い。"},
  {kind:"sentence",romaji:"he wo kaku.",kana:"へ を かく。",jpan:"屁 を かく 。",japanese:"屁をかく。"},
  {kind:"sentence",romaji:"haha ha hahaoya desu.",kana:"はは は ははおや です。",jpan:"母 は 母親 です 。",japanese:"母は母親です。"}
]) {
 const expected = value.romaji === "he wo kaku." ? "he o kaku." : value.romaji === "haha ha hahaoya desu." ? "haha wa hahaoya desu." : value.romaji;
 assert.equal(Core.displayRomaji(value,"spoken"), expected);
}
assert.equal(Core.displayRomaji({kind:"sentence",romaji:'"ha" to yomu.',kana:'「は」 と よむ。',jpan:'「は」 と 読む 。',japanese:'「は」と読む。'},"spoken"),'"ha" to yomu.');
assert.equal(Core.displayRomaji({kind:"sentence",romaji:'kana no "ha" to yomu.',kana:'かな の 「 は 」 と よむ。',jpan:'仮名 の 「 は 」 と 読む 。'},"spoken"),'kana no "ha" to yomu.');
assert.equal(Core.displayRomaji({kind:"sentence",romaji:"watashi HA, gakkou HE hon WO.",kana:"わたし は、 がっこう へ ほん を。",jpan:"私 は 、 学校 へ 本 を 。"},"spoken"),"watashi WA, gakkou E hon O.");
for (const [romaji,kana,jpan,expected] of [
 ["soko ni ooki na en wo kaite.","そこ に おおき な えん を かいて。","そこ に 大きな 円 を 描いて 。","soko ni ooki na en o kaite."],
 ["3gatsu ha  shigoto ga isogashii .","3がつ は  しごと が いそがしい 。","3 月 は 仕事 が 忙しい 。","3gatsu wa  shigoto ga isogashii ."],
 ["watashi ha mainichi,nikki wo tsukete imasu.","わたし は まいにち、にっき を つけて います。","私 は 毎日 、 日記 を つけて います 。","watashi wa mainichi,nikki o tsukete imasu."],
 ["ima,asa gohan wo tsukutte imasu.","いま、あさ ごはん を つくって います。","今 、 朝 ご飯 を 作っています 。","ima,asa gohan o tsukutte imasu."],
 ["watashi no ha ha itai.","わたし の は は いたい。","私 の 歯 は 痛 い 。","watashi no ha ha itai."],
 ["watashi no ha niha tsumemono ga aru.","わたし の は には つめもの が ある。","私 の 歯 に は 詰め物 が ある 。","watashi no ha niha tsumemono ga aru."],
 ["kono hon wo watashi ha miru.","この ほん を わたし は みる。","この 本 は 私 を 見 る 。","kono hon wo watashi ha miru."]
]) assert.equal(Core.displayRomaji({kind:"sentence",romaji,kana,jpan},"spoken"),expected);
assert.equal(sentence.kana,"わたし は がっこう へ ほん を もって いきます。");
console.log("PASS Romaji style defaults/migration, three confirmed particle readings, spacing/punctuation/case, lexical words, quoted kana, ambiguous fallback and source immutability");
