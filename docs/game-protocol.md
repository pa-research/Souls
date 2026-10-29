# Souls game protocol

Both browser clients (Classic and Modern 3D) and the practice bot talk to the game server over the `/ws/game`
WebSocket with JSON messages `{"Type": n, "Payload": ...}`. The server is authoritative: clients send requests and
animate what the server reports.

## Rules in short

- Decks have 20 cards (at most 4 copies of a card), shuffled at the start. Each player starts with 3 cards; the player
  whose turn starts draws one. An empty deck deals fatigue damage (1, then 2, ...). Drawing with 10 cards in hand
  burns the drawn card.
- Mana each turn: the round number plus the class bonus, at most 10. The player going second gets 1 extra mana on
  their first turn. Hero powers cost 2 mana, once per turn.
- Armor absorbs damage before health (cards and heroes). Healing never goes above maximum health.
- Cards arrive exhausted: they cannot attack or use their ability the turn they are played, unless they have Charge.
  A card either attacks or uses its ability once per turn. Heroes can attack once per turn.
- Attacks deal the attacker's attack to the defender and the defender's attack back to the attacker (heroes included).
- If the enemy has a Taunt card, attacks (card and hero attacks) must target a Taunt card. Abilities and hero powers
  ignore Taunt.
- A turn lasts 75 seconds; then it ends automatically. Three timeouts in a row forfeit the game.

| Race | Passive |
|---|---|
| 1 Darkness | Death curse: when it dies, deals 2 damage to a random enemy (card or hero). |
| 2 Vampiric | Lifesteal: damage it deals heals its hero. |
| 3 Lightbringer | Blessing: when played, restores 2 health to its hero. Its Heal restores 2 more. |
| 4 Ferocious | Frenzy: +1 attack when it attacks. |

| Ability | Kind | Targets (UseAbility `type`) | Effect |
|---|---|---|---|
| 1 Heal | activated | 0 friendly card, 1 own hero | +3 health (+5 Lightbringer); cards next to a healed card get +1 |
| 2 Sacrifice | activated | 0 friendly card (not itself), 1 own hero | dies, target gains its attack, health (and max health) and armor |
| 3 Taunt | passive | | must be attacked first |
| 4 Summon | on play | | summons a 1/1 Lost Soul (card id 0) in the nearest free slot |
| 5 Paralyze | activated | 3 enemy card | the target cannot attack or act during its owner's next turn |
| 6 Haunt | on death | | the first time it dies, a fresh copy returns to the owner's hand |
| 7 Harden | activated | 0 friendly card, 1 own hero | +3 armor |
| 8 Burn | activated | 2 enemy hero, 3 enemy card | 2 damage |
| 9 Charge | passive | | can attack the turn it is played |

| Class (hero `type`) | Hero power (cost 2) | Targets (HeroPower `type`) |
|---|---|---|
| 1 Rabid Soul | Rabid Bite: 1 damage | 2 enemy hero, 3 enemy card |
| 2 Lurker | Drain: 1 damage and +1 health to your hero | 2 enemy hero, 3 enemy card |
| 3 Harrison | Holy Light: +2 health | 0 friendly card, 1 own hero |
| 4 Fader | Fade: your hero gains 2 armor | none (send type 1) |

Card upgrades: owning a card at level 2 or 3 gives +1/+1 per level above 1 (`level` in the card JSON).

## Requests (client to server)

| Type | Name | Payload |
|---|---|---|
| 0 | Login | `{}` (the connection is authenticated by the session cookie) |
| 100 | QueueNormal | `{}` |
| 101 | QueuePractice | `{"difficulty": 0 easy, 1 normal, 2 hard}` |
| 200 | Attack | `{"source": cid or -1, "target": cid or -1, "type": 0 card→card, 1 card→hero, 2 hero→card, 3 hero→hero}` |
| 201 | UseCard | `{"cid", "slotId": 0-6}` |
| 203 | MoveCard | `{"cid", "x", "y"}` (relays a dragged card to the opponent) |
| 204 | ReleaseCard | `{"cid"}` |
| 205 | UseAbility | `{"source": cid, "target": cid or -1, "type": 0 friendly card, 1 own hero, 2 enemy hero, 3 enemy card}` |
| 206 | HeroPower | `{"target": cid or -1, "type": as UseAbility}` |
| 226 | NextTurn | `{}` |
| 240 | ListLiveGames | `{}` |
| 241 | Spectate | `{"gameId"}` |
| 242 | StopSpectating | `{}` |

## Responses (server to client)

Unchanged from the original game: 10 LoginOk, 100 QueueOk, 101 QueueAlreadyIn, 202 NotYourTurn, 208 Out of mana
(string), 209 OpponentMove `{cid,x,y}`, 210 OpponentRelease `{cid}`, 212 Release `{cid}`, 213 SlotOccupied
`{slot,message}`, 232 GeneralMessage (string).

| Type | Name | Payload |
|---|---|---|
| 206 | GameCreate | `{gameId, ident: 1\|2, create, yourTurn, player: {info, board: {slot: card}, hand: {cid: card}}, opponent: {info, board, hand: [{cid}]}}` |
| 207 | UseCardOk | `{card, pInfo}`: your card moved from hand to `card.slotId` |
| 211 | OpponentUseCardOk | `{card, pInfo}`: the opponent played `card` |
| 222 | NewCard | `{card: [card...], returned: bool}`: cards added to your hand (`returned`: Haunt). Spectators get `{card: [{cid}], hidden: true}` |
| 223 | OpponentNewCard | `{card: [{cid}...], returned}` |
| 226 | NextTurn | `{yourTurn, playerInfo, opponentInfo, turnEndsIn: ms}` |
| 230/231/233 | Victory/Defeat/Draw | `{statistics: gameId, text, coins, rating, ratingChange (null in practice), quests: [{text, progress, target, reward, done}]}` |
| 235 | GameEvents | `{events: [event...]}`: what happened, in order (below) |
| 236 | GameSync | the full public state after every action (below) |
| 240 | LiveGames | `{games: [{gameId, practice, turn, round, spectators, startedAt, players: [{name, type, rating, health, bot}]}]}` |
| 241 | SpectateStart | like GameCreate from player one's side, with `spectator: true` and player one's hand as `[{cid}]` |
| 242 | SpectateEnd | `{winner: ident or 0 for a draw, text, statistics}` |
| 243 | SpectateError | string |

The legacy 218 Attack and 234 UseAbility responses are no longer sent; attacks and abilities are reported as events.

**Card JSON**: `{cid, id, name, attack, health, maxHealth, armor, cost, slotId, level, portrait, ability: {id, name} | null, race: {id, name, cardUrl} | null, paralyzed, taunt, token, hasAttacked, isDead}`.
In GameSync board cards also have `canAct` (it is that player's turn and the card can attack or use its ability).

**Hero info** (`info`, `pInfo`, `playerInfo`, `opponentInfo`, GameSync heroes): `{name, type, ident, health, maxHealth, armor, attack, mana, maxMana, rating}`.
Numbers in the original fields (`health`, `attack`, `mana`, `type`) are strings for compatibility; the new ones are numbers.

### Message order

For each action the server sends, in this order: the primary message (UseCardOk/OpponentUseCardOk, NextTurn), then
GameEvents (events up to a draw), NewCard/OpponentNewCard, more GameEvents, and finally GameSync. If a hero died, the
result (Victory/Defeat/Draw) follows the GameSync. Clients should process messages in order (queue them and finish
each animation before the next) and treat GameSync as the truth for all numbers.

### Events

Events are the same for both players and spectators. They refer to heroes by `ident` (1 = player one, 2 = player two;
your own ident is in GameCreate) and to cards by `cid`. A target `ref` is `{"k": "card", "cid": n}` or `{"k": "hero", "id": ident}`.

| `t` | Fields | Meaning |
|---|---|---|
| `attack` | `src`, `dst` (refs) | an attack starts (the damage events follow) |
| `damage` | `to`, `amount`, `armorLost`, `health`, `armor` | damage taken (`amount` includes what armor absorbed) |
| `heal` | `to`, `amount`, `health` | health restored |
| `armor` | `to`, `amount`, `armor` | armor gained |
| `buff` | `to`, `attack`, `health`, `maxHealth`, `armor` | new stats after Sacrifice |
| `lifesteal` | `src` (card ref), `to` (hero ref), `amount`, `health` | Vampiric heal |
| `blessing` | `cid`, `to` (hero ref) | Lightbringer card played (a `heal` follows) |
| `ability` | `abilityId`, `src` (card ref), `dst` (ref) | an activated ability is used (effects follow) |
| `heroPower` | `id` (ident), `power` (class), `name`, `dst` (ref) | a hero power is used (effects follow) |
| `paralyze` | `cid`, `on` | a card is paralyzed |
| `summon` | `src` (cid), `owner` (ident), `card` | a token appears in `card.slotId` |
| `death` | `cid`, `owner` | a card died and left the board |
| `curse` | `src` (cid of the dead card), `owner`, `dst` (ref) | Darkness death curse (a `damage` follows) |
| `haunt` | `cid`, `newCid`, `owner` | a dead Haunt card returns (the owner then gets NewCard `returned: true`) |
| `burned` | `owner`, `card` | a drawn card burned (hand full); the card is revealed to everyone |
| `fatigue` | `id` (ident), `amount` | fatigue damage from an empty deck (a `damage` follows) |
| `timeout` | `id` (ident) | the turn timer ran out |
| `heroDeath` | `id` (ident) | a hero died |
| `log` | `text` | a line for the battle log |

### GameSync

```json
{
  "turn": 3, "round": 2, "current": 1, "turnEndsIn": 74850, "turnTime": 75000,
  "heroes": {
    "1": {"name", "type", "ident", "health", "maxHealth", "armor", "attack", "mana", "maxMana", "rating",
          "hand": 4, "deck": 15, "fatigue": 0, "heroPowerUsed": false, "canAttack": true, "canUsePower": true},
    "2": {}
  },
  "board": {"1": [card + canAct], "2": [card + canAct]}
}
```

## Replays

Every message player one receives that is public (and the spectator versions of GameCreate and NewCard) is recorded
with its time. When the game ends the recording is stored (`game_replay`) and served as JSON by
`/Game/ReplayData/{id}`: `[{"t": ms since start, "m": {"Type", "Payload"}}]`, played back by the 3D client
(`/Game/Replay/{id}`).
