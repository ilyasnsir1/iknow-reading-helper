# Local Japanese word voice

The extension uses one **Mei** Japanese voice through Open JTalk. Only the chosen
word's known pronunciation is synthesized; no sentence audio is cut for this mode.
All synthesis stays on this computer. No API, account or paid service is used.

- **pyopenjtalk-plus**: MIT. [Source and license](https://github.com/tsukumijima/pyopenjtalk-plus).
- **Open JTalk**: modified BSD. [Project](https://open-jtalk.sourceforge.net/).
- **HTS Voice Mei**: copyright 2009–2013 Nagoya Institute of Technology,
  Department of Computer Science, released by the MMDAgent Project Team.
  Licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
  [Original voice license](https://github.com/tsukumijima/pyopenjtalk-plus/blob/master/pyopenjtalk/htsvoice/LICENSE_mei_normal.htsvoice).
  The original license is also retained inside the installed wheel's
  `pyopenjtalk/htsvoice/` folder. This project is not endorsed by those authors.
- **Pydantic, pydantic-core, annotated-types, typing-inspection**: MIT;
  their original license notices are retained in installed package metadata.
- **SudachiPy**: Apache 2.0; its original license is retained in installed
  package metadata. The additional Sudachi core dictionary is not downloaded.
- **PySegmentKit**: BSD 3-Clause package wrapping the Julius segmentation kit;
  used only for improved original-recording timing when available. Its original
  notices are retained in installed package metadata. See the accompanying
  phoneme-alignment acknowledgements for upstream Julius/model terms.

The Mei voice is a compact statistical speech voice. Its pronunciation and
intonation can differ from the site's human recordings. Normal iKnow sentence
playback remains available for learning the original phrasing and intonation.
