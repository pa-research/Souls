# Voice credits

The heroes' voice lines were generated for Souls with [ElevenLabs](https://elevenlabs.io) on 1 November 2026, with
**ElevenLabs v4** text to speech (`eleven_v4`) and voices from the ElevenLabs voice library. The licence is the one in
`../CREDITS.md`: commercial use needs a paid ElevenLabs plan at the time of generation.

| Hero (type) | Voice (library id) | Flow (English / Norwegian) |
|---|---|---|
| Rabid Soul (1) | "Villain - harsh, abrasive, and volatile" (`TDTTIZEngvvWARkECefs`) | `gjD6XnWAgQVOW9LS9k6g` / `bRzh2nuphy7zeuQevGPP` |
| Lurker (2) | "Mordred - Evil Villain" (`UFO0Yv86wqRxAt1DmXUu`) | `A54EJWTjOLPBxrBnv0bo` / `9OQMomMxxhx6ZybbvyeW` |
| Harrison (3) | "Cormac - The Irish Fantasy Storyteller" (`tEo3d4j7gzVojBL5Z4Pt`) | `4yAYHSK82cr755w3VYwg` / `BiToH5PB1Lzn487hbqyg` |
| Fader (4) | "Bloodgrin VF - Evil, Demonic Villain" (`KTAbPR4QFlhaTpde6md8`) | `ejqgNae3eRf2E4l43cdj` / `xpUwGsrauDcKxES4SzDS` |

Files are `{lang}/{type}-{line}.ogg`, `lang` being `en` or `nb`. The lines, in the order of `VOICE_LINES` in
`Scripts/Game3D/assets.js`: the six emotes (`greet`, `wellPlayed`, `thanks`, `oops`, `threaten`, `sorry`, as in
`GameRules.Emotes`), then `intro` (after the VS splash), `low` (the hero falls to 30 % of its health, at least 8), `victory` (the
winner, after the game) and `defeat` (the hero falls).

## Scripts

Each hero and language was one generation: the ten lines with `[long pause]` between them. The script, with its
audio tags, is in the flow; the spoken words are:

- **Rabid Soul**: Greetings, little soul. / Hrrh. Well played. / Thanks. I'll remember that. / Gah! Oops. / Your soul
  is MINE! / Sorry. Not sorry. / The hunger wakes. Let's FEED! / Not yet! I'm not done! / Another soul for the pile! /
  The dark takes me.
  Norwegian: Hilsen, lille sjel. / Hrrh. Godt spilt. / Takk. Det skal jeg huske. / Gah! Oi. / Sjelen din er MIN! /
  Beklager. Ikke egentlig. / Sulten våkner. Nå skal vi ETE! / Ikke ennå! Jeg er ikke ferdig! / Enda en sjel til
  haugen! / Mørket tar meg.
- **Lurker**: Good evening. / Well played, for prey. / How generous. Thank you. / Oops. How clumsy of me. / Your soul
  is mine. / Sorry. It was nothing personal. / Stay still. This will only sting. / Blood. I need more blood. /
  Delicious. / Dawn, already?
  Norwegian: God kveld. / Godt spilt, til å være bytte. / Så raust. Takk. / Oi. Så klønete av meg. / Sjelen din er
  min. / Beklager. Det var ikke personlig. / Stå stille. Dette svir bare litt. / Blod. Jeg trenger mer blod. / Deilig.
  / Allerede morgengry?
- **Harrison**: Greetings, friend. Draw your blade. / Well played. Truly. / Thank you. Honour suits you. / Oops! That
  was not the plan. / By the light, your soul is mine! / My apologies. / For the light! Stand and fight! / The light
  does not fade! / Victory, by the light! / Forgive me. I have fallen.
  Norwegian: Vær hilset, venn. Trekk sverdet. / Godt spilt. Virkelig. / Takk. Ære kler deg. / Oi! Det var ikke planen.
  / Ved lyset, sjelen din er min! / Jeg ber om unnskyldning. / For lyset! Stå og kjemp! / Lyset slukner ikke! / Seier,
  ved lyset! / Tilgi meg. Jeg har falt.
- **Fader**: Hrm. Greetings, small one. / Well played. The forest saw it. / Thanks. / Hrm. Oops. / Your soul is MINE!
  / Sorry, little one. / The old forest wakes. COME! / The beast is not beaten! / Ha! The mountain stands! / Return me
  to the roots.
  Norwegian: Hrm. Hilsen, lille venn. / Godt spilt. Skogen så det. / Takk. / Hrm. Oi. / Sjelen din er MIN! / Beklager,
  lille venn. / Den gamle skogen våkner. KOM! / Udyret er ikke slått! / Ha! Fjellet står! / Før meg tilbake til
  røttene.

## Dialogue (2 November 2026)

Nine more lines per hero and language, in the same voices and model (`eleven_v4`), one generation each, generated
through the ElevenLabs connector: `vs1` to `vs4` (the hero's line to each class, the intro exchange: the opponent
speaks first, the player's hero answers) and the reactions `power` (hero power), `hit` (a big hit taken),
`legendary` (a legendary played), `finish` (the other hero falls low) and `hurry` (the other's turn runs out). Their
words are also the subtitles, `voice.<type>.<line>` in `Souls.Model/Localization/game3d.*.json`; the script for each
take is those nine lines in that order with `[long pause]` between them. Flows (English / Norwegian):

| Hero (type) | Flows |
|---|---|
| Rabid Soul (1) | `GKny9cquDoeOl6M7kvlk` / `SlkxpK0mbjGp5FSk0JNf` |
| Lurker (2) | `IH1fIzCfiu84MGygQp86` / `Br9WipmBr9lYQT4YAXEQ` |
| Harrison (3) | `k4Icu2DeDsfRxz8j1pUN` / `up6H5Vj8Iq2cpvVnN2M6` |
| Fader (4) | `ZcVHjEpNOmALKQt6L7pY` / `aaHh0avjk1f0gC2R92aW` |

Each take was cut at its eight longest pauses and processed as below.

## Processing

Each take was cut at its nine longest pauses (checked against an ElevenLabs Scribe transcript where two pauses were
close), then with ffmpeg: silence trimmed at both ends, short fades, mono 48 kHz, loudness-normalised to -16 LUFS
(two-pass `loudnorm`, true peak -1 dBTP; the shortest lines measure a little lower), Ogg Opus 64 kb/s VBR.
