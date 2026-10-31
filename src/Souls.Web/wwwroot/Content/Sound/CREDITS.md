# Sound credits

Every sound and both music tracks in this folder were generated for Souls with [ElevenLabs](https://elevenlabs.io)
on 31 October 2026, in the ElevenLabs flow `pFAhfjmAuL6Y5AEeG5ID` (the generation ids are below):

- the sound effects with **ElevenLabs Sound Effects v2** (`eleven_text_to_sound_v2`),
- the music with **ElevenLabs Music v2.5** (`eleven_music_v2_5`), instrumental.

They replace the 2014 sounds (`fjopp.ogg`, `card_mount.ogg`, `scroll.ogg`, `attack_1.ogg`, `defend_1.ogg`,
`chat_message.ogg`, `ability_heal.ogg`, `ability_sacrifice.ogg`, `menu.ogg`, `background-music.ogg`), which nothing
uses any more.

## Licence

ElevenLabs' terms (["Can I publish the content I generate on the platform?"](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform),
checked 31 October 2026):

- **Paid plans** include a commercial licence, as long as the output was not made with a Beta service and follows
  the Terms of Service, the Prohibited Use Policy and the Service-Specific Terms. The
  [sound effects page](https://elevenlabs.io/sound-effects/music) adds that the effects are royalty free for
  commercial projects, but asks not to "sell or license our tools or use the output to develop competitive products
  or services".
- The **free plan** has no commercial licence: free-plan output may only be used non-commercially and must credit
  ElevenLabs ("elevenlabs.io" in the title; "Eleven Music" for music).

So these files can ship in the game commercially if they were generated on a paid ElevenLabs plan (otherwise keep
this credit and the game non-commercial). They are part of the game, not a sound pack to pass on by themselves.

## Processing

From the MP3s ElevenLabs delivers (44.1 kHz effects, 48 kHz music) with ffmpeg:

- **Effects**: silence trimmed at both ends, a 3 ms fade in (the takes start abruptly) and a short fade out; mono
  unless the take is really stereo (side channel within 10 dB of the mid); loudness-normalised to -16 LUFS
  integrated (EBU R128) with the true peak at or below -1 dBTP, measured on the decoded Ogg. Very short transient
  takes (card snaps, clicks) get at most 3 dB of peak limiting rather than being crushed, so they sit below -16 LUFS
  with their peaks at about -1.5 dBTP.
- **Music and the crowd bed** (`music_*.ogg`, `crowd_loop.ogg`): stereo, -20 LUFS so they sit under the effects,
  and made to loop seamlessly: the last 6 s (2 s for the crowd) are crossfaded (equal power) into the start, with
  the start shifted (up to 3 s) so the beats line up.
- **Encoding**: Opus in Ogg (libopus, VBR): 64 kb/s mono and 96 kb/s stereo effects, 96 kb/s music. Ogg Opus plays in
  Chrome, Edge, Firefox and Safari 18.4+ (macOS and iOS). The 3D client decodes the effects with Web Audio and falls
  back to an `<audio>` element where Web Audio cannot decode them; spells fall back to synthesized sounds where
  nothing can.

## Files

| File | Model | Generation | Length | Loudness | True peak | Format | Size |
|---|---|---|---|---|---|---|---|
| `attack.ogg` | Sound Effects v2 | `qWmuk9ZqNYZn57AKvC1f` | 0.55 s | -17.9 LUFS | -1.3 dBTP | stereo, 96 kb/s | 8.2 KB |
| `block.ogg` | Sound Effects v2 | `2TefLFJ4xYF84i7O2WZ1` | 0.75 s | -16.4 LUFS | -2.0 dBTP | mono, 64 kb/s | 6.5 KB |
| `card_death.ogg` | Sound Effects v2 | `T6SrN8yOq4fiZccs2PrF` | 1.37 s | -16.1 LUFS | -1.9 dBTP | mono, 64 kb/s | 9.2 KB |
| `card_draw.ogg` | Sound Effects v2 | `kW7fgMSA9NhtBsMTsmPR` | 0.81 s | -23.0 LUFS | -1.4 dBTP | mono, 64 kb/s | 5.6 KB |
| `card_pickup.ogg` | Sound Effects v2 | `xfUX3gH8tLfwW9m7Y9hc` | 0.46 s | -28.2 LUFS | -2.1 dBTP | mono, 64 kb/s | 4.1 KB |
| `card_play.ogg` | Sound Effects v2 | `xxHBKvH3pdvhddPIhc3I` | 0.40 s | -24.1 LUFS | -1.8 dBTP | mono, 64 kb/s | 3.8 KB |
| `card_shuffle.ogg` | Sound Effects v2 | `H5eEp47ueNPD537Za9xC` | 1.21 s | -21.0 LUFS | -1.6 dBTP | mono, 64 kb/s | 10.0 KB |
| `coins.ogg` | Sound Effects v2 | `pt5KM2aD7WndpC0g9gwP` | 0.98 s | -16.1 LUFS | -1.4 dBTP | mono, 64 kb/s | 8.3 KB |
| `crowd_cheer.ogg` | Sound Effects v2 | `CpzAQdM75Sdc5L8WkK3T` | 3.39 s | -16.0 LUFS | -6.8 dBTP | stereo, 96 kb/s | 38.3 KB |
| `crowd_gasp.ogg` | Sound Effects v2 | `QLb7eFX44y5g2XxGv1wk` | 1.91 s | -16.0 LUFS | -7.6 dBTP | stereo, 96 kb/s | 20.7 KB |
| `crowd_loop.ogg` | Sound Effects v2 | `8Evr2Co54FYKoFxQBnkh` | 11.99 s | -20.0 LUFS | -8.7 dBTP | stereo, 96 kb/s, loop | 135.0 KB |
| `curse.ogg` | Sound Effects v2 | `QBWNAkHRuZ32r3EtvFqo` | 1.40 s | -16.0 LUFS | -6.2 dBTP | stereo, 96 kb/s | 15.7 KB |
| `defeat.ogg` | Sound Effects v2 | `WzwLGvRbsd7uQHc6MVhN` | 3.98 s | -16.0 LUFS | -7.0 dBTP | stereo, 96 kb/s | 47.7 KB |
| `drain.ogg` | Sound Effects v2 | `DbV5V7c2uLqSuzKM5aQ3` | 1.35 s | -16.0 LUFS | -4.7 dBTP | mono, 64 kb/s | 10.0 KB |
| `emote.ogg` | Sound Effects v2 | `n5xRmhn838nmmKXpuFAV` | 0.61 s | -18.2 LUFS | -1.8 dBTP | stereo, 96 kb/s | 9.2 KB |
| `end_turn.ogg` | Sound Effects v2 | `P16jsltJlS68hFJdRNJX` | 0.35 s | -19.9 LUFS | -1.7 dBTP | mono, 64 kb/s | 2.9 KB |
| `fatigue.ogg` | Sound Effects v2 | `b5WxenjDmPbx52NO3IWD` | 1.29 s | -19.2 LUFS | -1.2 dBTP | mono, 64 kb/s | 9.4 KB |
| `fire.ogg` | Sound Effects v2 | `SFaKDibBEHb4kOLWKMAQ` | 1.44 s | -16.1 LUFS | -5.3 dBTP | mono, 64 kb/s | 11.2 KB |
| `fireworks.ogg` | Sound Effects v2 | `6aYO2XwpCPsIWyoL5lEe` | 2.49 s | -16.1 LUFS | -1.6 dBTP | stereo, 96 kb/s | 24.8 KB |
| `grow.ogg` | Sound Effects v2 | `KDW1jtrnf0f1hecQcRJO` | 1.37 s | -16.0 LUFS | -1.4 dBTP | mono, 64 kb/s | 14.6 KB |
| `heal.ogg` | Sound Effects v2 | `iNBBFcv7PWHetmgJBgj0` | 1.49 s | -16.8 LUFS | -1.9 dBTP | stereo, 96 kb/s | 20.8 KB |
| `hero_hit.ogg` | Sound Effects v2 | `5l9mFm5aEPcB8SmgzwiK` | 1.01 s | -20.2 LUFS | -1.8 dBTP | mono, 64 kb/s | 7.3 KB |
| `hero_power.ogg` | Sound Effects v2 | `417HwkFaazfRplhL8oNf` | 1.29 s | -16.0 LUFS | -2.5 dBTP | mono, 64 kb/s | 9.3 KB |
| `ice.ogg` | Sound Effects v2 | `0yzLdB2522o92FHz9YaJ` | 1.49 s | -16.3 LUFS | -1.7 dBTP | mono, 64 kb/s | 12.4 KB |
| `insight.ogg` | Sound Effects v2 | `jHKJMcYk6kUCiCDG4oDU` | 1.37 s | -16.0 LUFS | -3.1 dBTP | stereo, 96 kb/s | 15.8 KB |
| `legendary.ogg` | Sound Effects v2 | `eR7f2UoI63VRf9Kiep61` | 3.49 s | -16.1 LUFS | -4.8 dBTP | stereo, 96 kb/s | 45.9 KB |
| `music_battle.ogg` | Music v2.5 | `93v6O9RU64bsp6ZLsSf1` | 142.17 s | -20.0 LUFS | -7.8 dBTP | stereo, 96 kb/s, loop | 1583.5 KB |
| `music_menu.ogg` | Music v2.5 | `1X38N4R8cTPYkPK1IN05` | 92.35 s | -20.0 LUFS | -6.3 dBTP | stereo, 96 kb/s, loop | 1157.8 KB |
| `pack_open.ogg` | Sound Effects v2 | `mcvVn0SwcbrE3VMI7Qme` | 1.54 s | -22.1 LUFS | -1.4 dBTP | mono, 64 kb/s | 14.3 KB |
| `quest_complete.ogg` | Sound Effects v2 | `O7n8q9G8VhPL4yEfdiMt` | 1.61 s | -16.0 LUFS | -4.6 dBTP | stereo, 96 kb/s | 26.1 KB |
| `rally.ogg` | Sound Effects v2 | `yKgfOqqpL6ahvTHk3muU` | 1.43 s | -17.0 LUFS | -1.4 dBTP | mono, 64 kb/s | 12.3 KB |
| `rare_reveal.ogg` | Sound Effects v2 | `x22FxENHvGLYtsj4BFJW` | 1.63 s | -16.0 LUFS | -7.6 dBTP | stereo, 96 kb/s | 19.6 KB |
| `shatter.ogg` | Sound Effects v2 | `T89pR2Q3hUN9gNowpiA7` | 1.09 s | -16.1 LUFS | -1.4 dBTP | stereo, 96 kb/s | 10.1 KB |
| `spell_whoosh.ogg` | Sound Effects v2 | `Jcaw0AVRLvBPcduffkSe` | 0.70 s | -15.9 LUFS | -3.1 dBTP | stereo, 96 kb/s | 7.3 KB |
| `summon.ogg` | Sound Effects v2 | `C25bIGXSRcg3SkFGKacO` | 1.18 s | -19.2 LUFS | -1.0 dBTP | mono, 64 kb/s | 8.4 KB |
| `taunt.ogg` | Sound Effects v2 | `5E3VIrxUFhoul7G4UV7r` | 1.21 s | -19.4 LUFS | -2.1 dBTP | mono, 64 kb/s | 8.4 KB |
| `timer_warning.ogg` | Sound Effects v2 | `vdqc7A9TigizWs06VCMA` | 2.01 s | -16.0 LUFS | -7.1 dBTP | stereo, 96 kb/s | 21.5 KB |
| `turn_start.ogg` | Sound Effects v2 | `ud3eVHwnpD4Ssz4fhmog` | 1.77 s | -16.0 LUFS | -5.9 dBTP | mono, 64 kb/s | 15.3 KB |
| `ui_click.ogg` | Sound Effects v2 | `DyWJFhwwFyRuTMoaieQz` | 0.49 s | -21.0 LUFS | -1.9 dBTP | mono, 64 kb/s | 4.1 KB |
| `venom.ogg` | Sound Effects v2 | `YQxu97osWnvKjI5MvPfz` | 1.29 s | -16.0 LUFS | -3.5 dBTP | stereo, 96 kb/s | 13.8 KB |
| `versus.ogg` | Sound Effects v2 | `WNLtquczRJhHPnkCCqOQ` | 2.49 s | -18.3 LUFS | -2.2 dBTP | mono, 64 kb/s | 17.5 KB |
| `victory.ogg` | Sound Effects v2 | `miXszyMDtFkOyYLlW6MW` | 4.49 s | -16.0 LUFS | -6.5 dBTP | stereo, 96 kb/s | 58.5 KB |
| `ward.ogg` | Sound Effects v2 | `geAX5C4Du6I31oeqCaAa` | 1.49 s | -16.2 LUFS | -2.0 dBTP | mono, 64 kb/s | 12.5 KB |

Total 3.4 MB (the music 2.7 MB of it, streamed when it plays; the effects 0.75 MB, loaded at start).

`emote` and `taunt` are second takes (the better of two each; the first takes were `l1doOV9e4Sx8xQGhBG30` and
`tH09FtdR1SEzjtZo3xyn`). `taunt` is still almost all below 300 Hz, so it is faint on phone speakers.
