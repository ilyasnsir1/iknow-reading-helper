# Local neural voices: sources and licenses

Checked against the publisher's model pages and the pinned engine source on **2026-10-28**. These components are downloaded by `Setup-neural-voice.cmd`; the friend-sharing folder contains the integration scripts and notices, not their binaries or model weights. Each upstream license applies to its respective component.

## AivisSpeech Engine

- Project: **AivisSpeech Engine**, Aivis Project / contributors, based on VOICEVOX ENGINE.
- Pinned runtime: **1.0.0**, downloaded unchanged from its [official release](https://github.com/Aivis-Project/AivisSpeech-Engine/releases/tag/1.0.0).
- Engine license: **GNU Lesser General Public License, version 3 (LGPL-3.0)**. [Version 1.0.0 source and full license](https://github.com/Aivis-Project/AivisSpeech-Engine/blob/1.0.0/LICENSE).
- The downloaded runtime retains its own `resources/engine_manifest_assets/terms_of_service.md` and `dependency_licenses.json`. These cover the engine and its bundled dependencies; the engine license does not replace the separate model licenses below.

The extension communicates with the unmodified engine through its local HTTP API. It uses no Aivis Cloud API account or billed cloud synthesis service.

## Female · Mao Plain

- Published name: **まお (Mao)**; model version **1.2.0**.
- Selected style: **ふつー**, shown as **Mao Plain** in this extension.
- Model creators: **Oz Chat / Trippy / ねゆたろ**; character credit **©Oz Chat/Trippy**.
- Publisher requests this credit wording when crediting the voice: **AivisSpeech: まお**.
- License: **Aivis Common Model License (ACML) 1.0**.
- [Official model page, creator information, license, and checksum](https://hub.aivis-project.com/aivm-models/a59cb814-0083-4369-8542-f51a29e72af7?owner=ozchat).

Model UUID: `a59cb814-0083-4369-8542-f51a29e72af7`  
Speaker UUID: `e756b8e4-b606-4e15-99b1-3f9c6a1b2317`  
SHA-256: `f87ccea2e8e2de0e0bfe52e803945af903b4086bf25621a015111628f00e4119`

## Male · Nise

- Published name: **にせ (Nise)**; model version **1.0.0**.
- Selected style: **ノーマル (Normal)**.
- Model creator: **にせ**; publisher account **魔法プログラム / MAHOPROGRAM**.
- License: **Aivis Common Model License (ACML) 1.0**.
- [Official model page, creator information, license, and checksum](https://hub.aivis-project.com/aivm-models/6d11c6c2-f4a4-4435-887e-23dd60f8b8dd?owner=MAHOPROGRAM).

Model UUID: `6d11c6c2-f4a4-4435-887e-23dd60f8b8dd`  
Speaker UUID: `bf56410a-d8e6-430d-a477-f789e16206d3`  
SHA-256: `6ff7eaa61c24d37434e2c6ab672fc3ba189ecc9118c08918a486ed5316e5c9d3`

## Model license text

Both selected models list **ACML 1.0**, rather than ACML-NC or the engine's LGPL license. [Read the complete official ACML 1.0 license](https://github.com/Aivis-Project/ACML/blob/master/ACML-1.0.md). It permits personal and commercial use subject to its restrictions; attribution is optional. If redistributing a model, include the full license document with it. Its Japanese text governs. This notice is an attribution/source index, not a replacement for that license.

## Shared Japanese language model

The engine uses **tsukumijima/deberta-v2-large-japanese-char-wwm-onnx**, an ONNX conversion of **ku-nlp/deberta-v2-large-japanese-char-wwm** from Kyoto University's Language Media Processing Lab. Both publisher model cards identify **Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)**:

- [tsukumijima's ONNX conversion and conversion source](https://huggingface.co/tsukumijima/deberta-v2-large-japanese-char-wwm-onnx).
- [Kyoto University base model and model card](https://huggingface.co/ku-nlp/deberta-v2-large-japanese-char-wwm).
- [CC BY-SA 4.0 license text](https://creativecommons.org/licenses/by-sa/4.0/).

The helper downloads/uses the publisher's resource without retraining it. Do not strip upstream metadata or attribution when separately redistributing those files. Portable Python and other engine dependencies retain their own notices in the downloaded runtime.

The selected neural voices are separate from iKnow's recordings and from the older Mei / Open JTalk mode documented in [WORD-VOICE-LICENSES.md](WORD-VOICE-LICENSES.md). Their availability and license terms do not make synthesized speech a guaranteed pronunciation or pitch-accent reference.
