# Souls game protocol

Both browser clients (Classic and Modern 3D) and the practice bot talk to the game server over the `/ws/game`
WebSocket with JSON messages `{"Type": n, "Payload": ...}`. The server is authoritative: clients send requests and
animate what the server reports.

## Rules in short

- Decks have 20 cards (at most 4 copies of a common card, 3 of a rare, 2 of an epic and 1 of a legendary), shuffled
  at the start. Each player starts with 3 cards and may replace any of them once ([mulligan](#mulligan)); then the
  player going second draws a 4th card. The player whose turn starts draws one. An empty deck deals fatigue damage
  (1, then 2, ...). Drawing with 10 cards in hand burns the drawn card.
- Mana each turn: the round number plus the class bonus, at most 10. The player going second gets 1 extra mana on
  their first turn. Hero powers cost 2 mana, once per turn.
- Armor absorbs damage before health (cards and heroes). Healing never goes above maximum health.
- Cards arrive exhausted: they cannot attack or use their ability the turn they are played, unless they have Charge.
  A card either attacks or uses its ability once per turn (Fury cards may attack twice). Heroes can attack once per
  turn.
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

Abilities have a value per card (`ability.value` in the card JSON; Burn 3 deals 3 damage). `X` below is that value;
the default is used when a card has none.

| Ability | Kind | Targets (UseAbility `type`) | Effect (default X) |
|---|---|---|---|
| 1 Heal | activated | 0 friendly card, 1 own hero | +X health (+2 more for Lightbringer); cards next to a healed card get +1 (3) |
| 2 Sacrifice | activated | 0 friendly card (not itself), 1 own hero | dies, target gains its attack, health (and max health) and armor |
| 3 Taunt | passive | | must be attacked first |
| 4 Summon | on play | | summons X 1/1 Lost Souls (card id 0) in the nearest free slots (1) |
| 5 Paralyze | activated | 3 enemy card | the target cannot attack or act during its owner's next turn |
| 6 Haunt | on death | | the first time it dies, a fresh copy returns to the owner's hand |
| 7 Harden | activated | 0 friendly card, 1 own hero | +X armor (3) |
| 8 Burn | activated | 2 enemy hero, 3 enemy card | X damage (2) |
| 9 Charge | passive | | can attack the turn it is played |
| 10 Ward | passive | | the first damage it would take breaks the ward instead (`ward: true` until then) |
| 11 Fury | passive | | can attack twice each turn |
| 12 Venom | passive | | destroys any card it damages (attacking or defending); a ward stops it |
| 13 Rally | on play | | the cards next to it gain +X attack (1) |
| 14 Insight | on play | | its owner draws X cards (1) |
| 15 Inferno | on play | | X damage to every enemy card (1) |
| 16 Regenerate | turn start | | restores X health to itself at the start of its owner's turn (2) |
| 17 Grow | turn start | | +X attack, +X health and max health at the start of its owner's turn (1) |
| 18 Drain | activated | 2 enemy hero, 3 enemy card | X damage, and +X health to its hero (2) |
| 19 Brood | on death | | summons X Lost Souls where it died (1) |
| 20 Empower | activated | 0 friendly card | +X attack, +X health and max health (1); only spells have it so far |

Cards have a rarity (`rarity`: 1 common, 2 rare, 3 epic, 4 legendary) that limits the copies in a deck and sets the
shop price.

Every class has two hero powers (cost 2, once per turn) and plays the one the player picked on the Deck page
(`player.hero_power`; nothing picked, or a power of another class, means the class's first one, which every player
had before). The bot picks one of its class's powers at random each game. Heroes carry the power's id as `power` (see
[hero info](#responses-server-to-client)); powers 1-4 have the id of their class, so a client or replay that only knows
`type` finds the first power under the same id.

| Class (hero `type`) | Power (`power`): effect | Targets (HeroPower `type`) |
|---|---|---|
| 1 Rabid Soul | 1 Rabid Bite: 1 damage | 2 enemy hero, 3 enemy card |
| | 5 Ravage: 2 damage, and 1 damage to your own hero | 3 enemy card |
| 2 Lurker | 2 Drain: 1 damage and +1 health to your hero | 2 enemy hero, 3 enemy card |
| | 6 Blood Gift: +1 attack, +2 health and max health | 0 friendly card |
| 3 Harrison | 3 Holy Light: +2 health | 0 friendly card, 1 own hero |
| | 7 Aegis: the card gains Ward (refused if it has one) | 0 friendly card |
| 4 Fader | 4 Fade: your hero gains 2 armor | none (send type 1) |
| | 8 Thick Hide: +1 armor | 0 friendly card |

A power used on a target it cannot take is refused with a GeneralMessage and costs nothing.

**Class cards**: a card with a class (`card.fk_class`) can only be owned and played by heroes of that class. The shop
neither shows nor sells another class's cards, packs never contain them, the deck builder refuses them (and a saved
deck with one is not used: the game server leaves another class's cards out and plays the automatic deck), and they
are never starter cards or season rewards. Two per class (ids 70-77), of the class's race.

Card upgrades: owning a card at level 2 or 3 gives +1/+1 per level above 1 (`level` in the card JSON). A spell gets +1
to its value per level instead (Burn 3 at level 2 deals 4; Paralyze has no value and does not change).

### Spells

Cards have a kind (`kind` in the card JSON): `minion` (the default) or `spell`. A spell has a cost, rarity, race and an
ability but no attack or health (both 0). It is cast from the hand with UseCard (201) and never takes a board slot:

- A spell with an **activated** ability (Burn, Drain, Heal, Harden, Paralyze, Empower) needs a target, sent and checked
  exactly like UseAbility (`type` and `target`, same target kinds). A spell with an **on-play** ability (Insight,
  Inferno) has none and is cast with `{"cid"}` alone. Sacrifice and the other abilities are not used on spells (the card
  editor refuses them).
- A refused cast (not your turn or the mulligan: NotYourTurn; not enough mana: 208; wrong or missing target:
  GeneralMessage) also sends Release (212) so the card goes back to the hand, and the spell stays there.
- When it works: the mana is paid, the spell goes from the hand to a used pile (it never comes back), the caster gets
  UseCardSpell (224) and the opponent OpponentUseCardSpell (225) with the card and its target, then events: a `log`
  line ("p casts X on Y."), the race passive (`blessing` for Lightbringer; Vampiric spells heal their hero by the damage
  they deal, `lifesteal`), then the same events as the ability: `ability` (`src` is the spell's cid) and its effects for
  activated abilities, `trigger` (`src` the spell) and its effects for on-play ones. GameSync follows as usual. The
  spell's `src` cid is not on any board: clients show the cast card until the GameSync.
- It counts as a card played (quests) and is logged as UseCard, so card statistics and the simulator count it.

### Mulligan

Before the first turn both players see their starting hand at the same time and may replace any of its cards, once
(request 227). A new card is drawn for each replaced one, then the replaced cards are shuffled back into the deck
(so they cannot come straight back). Every card of the new hand gets a new `cid`, kept cards stay in their place:
the opponent, spectators and replays only learn how many cards were replaced. A request with a card that is not in
the starting hand is refused (GeneralMessage) and the player may choose again; a second mulligan is ignored.

- The mulligan lasts 30 seconds (`Souls:Game:MulliganTime`). Whoever has not chosen by then keeps their hand; this
  is not a turn timeout.
- When both have chosen, player one's first turn starts (NextTurn), the player going second draws their extra card,
  and GameSync follows.
- During the mulligan nobody may act (turn requests get NotYourTurn), GameSync has `current: 0` and its
  `turnEndsIn` / `turnTime` count down the mulligan.
- A player who reconnects during the mulligan gets GameCreate with `mulligan` again (`done` if they already chose).
  Leaving the game during the mulligan forfeits it, like leaving later.

### Reconnecting

A player whose connection drops has 60 seconds (`Souls:Matchmaker:ReconnectGracePeriod`) to come back; then the game
is forfeited (at once in a practice game). To rejoin, a client opens a new connection, sends Login and its queue
request (QueueNormal or QueuePractice): a player in a running game gets GameCreate (`create: false`, `mulligan` while
it runs) and GameSync instead of being queued. A spectator sends Spectate with the same `gameId` again.

Running games survive a restart of the game server, with the same game ids, cids and state. When it stops, the
server closes every connection with the reason `Server restarting`; the next instance accepts connections once the
games are restored. The clients reconnect as above, retrying for about a minute. The turn (or the mulligan) keeps the
time it had left, but at least 15 seconds; the grace period starts again when the server starts. The game's chat
room comes back with the same id: a player who logs in to the chat again is a member, and gets ChatClientConnect
(1094, `{name, room}`) like after any reconnect. There are no new messages.

## Requests (client to server)

| Type | Name | Payload |
|---|---|---|
| 0 | Login | `{}` (the connection is authenticated by the session cookie) |
| 100 | QueueNormal | `{}` |
| 101 | QueuePractice | `{"difficulty": 0 easy, 1 normal, 2 hard}` |
| 197 | ChallengeCancel | `{}`: withdraws your pending challenge |
| 198 | ChallengeAnswer | `{"accept": bool}`: answers the challenge you received |
| 199 | Challenge | `{"name"}`: challenges an online player to a friendly game (below) |
| 200 | Attack | `{"source": cid or -1, "target": cid or -1, "type": 0 card→card, 1 card→hero, 2 hero→card, 3 hero→hero}` |
| 201 | UseCard | `{"cid", "slotId": 0-6}`; a spell: `{"cid", "target": cid or -1, "type": as UseAbility}`, or `{"cid"}` for an untargeted one ([spells](#spells)) |
| 203 | MoveCard | `{"cid", "x", "y"}` (relays a dragged card to the opponent) |
| 204 | ReleaseCard | `{"cid"}` |
| 205 | UseAbility | `{"source": cid, "target": cid or -1, "type": 0 friendly card, 1 own hero, 2 enemy hero, 3 enemy card}` |
| 206 | HeroPower | `{"target": cid or -1, "type": as UseAbility}` |
| 226 | NextTurn | `{}` |
| 227 | Mulligan | `{"replace": [cid...]}`: the starting hand cards to replace (`[]` keeps the hand); once, during the mulligan |
| 240 | ListLiveGames | `{}` |
| 241 | Spectate | `{"gameId"}` |
| 242 | StopSpectating | `{}` |
| 298 | MuteEmotes | `{"muted": bool}`: stop (or resume) receiving the opponent's emotes in this game |
| 299 | Emote | `{"emote": 0-5}` (below) |

## Responses (server to client)

Unchanged from the original game: 10 LoginOk, 100 QueueOk, 101 QueueAlreadyIn, 202 NotYourTurn, 208 Out of mana
(string), 209 OpponentMove `{cid,x,y}`, 210 OpponentRelease `{cid}`, 212 Release `{cid}`, 213 SlotOccupied
`{slot,message}`, 232 GeneralMessage (string).

| Type | Name | Payload |
|---|---|---|
| 197 | ChallengeClosed | string: your pending challenge ended without a game (declined, withdrawn, expired, a player left or started another game), or your request was refused |
| 198 | ChallengeSent | `{name, expiresIn: ms}`: to the challenger |
| 199 | ChallengeInvite | `{name, type, rating, expiresIn: ms}`: to the challenged player (`type`: the challenger's class) |
| 206 | GameCreate | `{gameId, ident: 1\|2, create, yourTurn, player: {info, board: {slot: card}, hand: {cid: card}}, opponent: {info, board, hand: [{cid}]}, mulligan: {endsIn: ms, time: ms, done} \| null}` (`mulligan` while it runs) |
| 207 | UseCardOk | `{card, pInfo}`: your card moved from hand to `card.slotId` |
| 211 | OpponentUseCardOk | `{card, pInfo}`: the opponent played `card` |
| 224 | UseCardSpell | `{card, pInfo, target: ref \| null}`: your spell `card` left your hand and is cast on `target` (events follow) |
| 225 | OpponentUseCardSpell | `{card, pInfo, target: ref \| null}`: the opponent cast the spell `card` |
| 222 | NewCard | `{card: [card...], returned: bool}`: cards added to your hand (`returned`: Haunt). Spectators get `{card: [{cid}], hidden: true}` |
| 223 | OpponentNewCard | `{card: [{cid}...], returned}` |
| 226 | NextTurn | `{yourTurn, playerInfo, opponentInfo, turnEndsIn: ms}` (also when the first turn starts after the mulligan) |
| 227 | Mulligan | `{hand: [card...], replaced: n}`: your whole starting hand after the mulligan, in order, all with new cids. Spectators get `{hand: [{cid}], replaced, hidden: true}` |
| 228 | OpponentMulligan | `{hand: [{cid}...], replaced: n}`: the opponent's starting hand after their mulligan (all new cids) |
| 230/231/233 | Victory/Defeat/Draw | `{statistics: gameId, text, coins, rating, ratingChange (null in practice), quests: [{text, progress, target, reward, done}], season}` (`season` in ranked games only); a friendly game: `{statistics, text, friendly: true, coins: 0, ratingChange: null}` (see [End of the game](#end-of-the-game)) |
| 235 | GameEvents | `{events: [event...]}`: what happened, in order (below) |
| 236 | GameSync | the full public state after every action (below) |
| 240 | LiveGames | `{games: [{gameId, practice, turn, round, spectators, startedAt, players: [{name, type, rating, health, bot}]}]}` |
| 241 | SpectateStart | like GameCreate from player one's side, with `spectator: true` and player one's hand as `[{cid}]` |
| 242 | SpectateEnd | `{winner: ident or 0 for a draw, text, statistics}` |
| 243 | SpectateError | string |
| 299 | Emote | `{ident, emote, text}`: a player emoted (to both players, spectators and the replay) |

The legacy 218 Attack and 234 UseAbility responses are no longer sent; attacks and abilities are reported as events.

**Card JSON**: `{cid, id, name, kind: "minion" | "spell", attack, health, maxHealth, armor, cost, slotId, level, rarity, portrait, flavor, ability: {id, name, value, label, text, activated} | null, race: {id, name, cardUrl} | null, paralyzed, taunt, ward, token, hasAttacked, isDead}` (example below).
In GameSync board cards also have `canAct` (it is that player's turn and the card can attack or use its ability).

**Hero info** (`info`, `pInfo`, `playerInfo`, `opponentInfo`, GameSync heroes): `{name, type, power, ident, health, maxHealth, armor, attack, mana, maxMana, rating}`.
`type` is the class, `power` the id of the hero power the hero plays (1-8, see the table above; replays recorded
before hero powers could be picked have no `power`: use `type`).
Numbers in the original fields (`health`, `attack`, `mana`, `type`) are strings for compatibility; the new ones are numbers.

### Message order

A game starts with GameCreate and GameSync, then each player's Mulligan/OpponentMulligan (with a `log` event) as
they choose; when both have chosen, NextTurn, OpponentNewCard/NewCard (the extra card of the player going second)
and GameSync.

For each action the server sends, in this order: the primary message (UseCardOk/OpponentUseCardOk,
UseCardSpell/OpponentUseCardSpell, NextTurn), then
GameEvents (events up to a draw), NewCard/OpponentNewCard, more GameEvents, and finally GameSync. If a hero died, the
result (Victory/Defeat/Draw) follows the GameSync. Clients should process messages in order (queue them and finish
each animation before the next) and treat GameSync as the truth for all numbers.

### End of the game

Each player gets Victory, Defeat or Draw (spectators get SpectateEnd). The game is stored first, so `statistics` is
its id for `/Game/Stats/{id}` and `/Game/Replay/{id}` (0 if storing failed: then there are no rewards either).

- `coins`: the soul coins earned, daily quests included. `quests`: today's daily quests after the game.
- `rating` and `ratingChange`: the rating after the game and the change (`ratingChange` is `null` in practice games).
- `season` (ranked games only): the current season, and the player's rank before and after the game. A season's
  standings go by rating (its points); the rank follows from the rating (`rank` 1 is Bronze III up to 15 Diamond I,
  then 16 Champion, 50 points each, see the Season page). `tier` is the rank's name and `css` its emblem class in
  `theme.css` (`tier-bronze` ... `tier-champion`). `promoted`/`demoted`: the rank went up or down.
- `friendly: true`: a friendly challenge earns nothing (no coins, quests, rating or season points). The game is still
  stored with its statistics and replay; the clients say "Friendly game: no rewards".

```json
{"Type": 230, "Payload": {
  "statistics": 4711, "text": "ann wins against ben!", "coins": 3, "rating": 1056, "ratingChange": 16,
  "quests": [{"text": "Win 2 normal games", "progress": 1, "target": 2, "reward": 4, "done": false}],
  "season": {"number": 3, "name": "Season 3",
             "before": {"rating": 1040, "rank": 1, "tier": "Bronze III", "css": "tier-bronze"},
             "after": {"rating": 1056, "rank": 2, "tier": "Bronze II", "css": "tier-bronze"},
             "promoted": true, "demoted": false}}}
```

### Events

Events are the same for both players and spectators. They refer to heroes by `ident` (1 = player one, 2 = player two;
your own ident is in GameCreate) and to cards by `cid`. A target `ref` is `{"k": "card", "cid": n}` or `{"k": "hero", "id": ident}`.

| `t` | Fields | Meaning |
|---|---|---|
| `attack` | `src`, `dst` (refs) | an attack starts (the damage events follow) |
| `damage` | `to`, `amount`, `armorLost`, `health`, `armor` | damage taken (`amount` includes what armor absorbed) |
| `heal` | `to`, `amount`, `health` | health restored |
| `armor` | `to`, `amount`, `armor` | armor gained |
| `buff` | `to`, `attack`, `health`, `maxHealth`, `armor`, `src` (ref, optional) | new stats after Sacrifice, Rally (`src` is the rallying card), Grow, Empower or Blood Gift |
| `lifesteal` | `src` (ref), `to` (hero ref), `amount`, `health` | Vampiric heal, or the heal of Drain (`src` is the drained target) |
| `blessing` | `cid`, `to` (hero ref) | Lightbringer card played (a `heal` follows) |
| `ability` | `abilityId`, `src` (card ref), `dst` (ref) | an activated ability is used (effects follow) |
| `heroPower` | `id` (ident), `power` (hero power id), `name`, `dst` (ref) | a hero power is used (effects follow); `dst` is the own hero for powers without a target |
| `paralyze` | `cid`, `on` | a card is paralyzed |
| `summon` | `src` (cid), `owner` (ident), `card` | a token appears in `card.slotId` (Summon, or Brood from a dead card) |
| `trigger` | `abilityId`, `src` (card ref), `label` | an on-play, turn-start or on-death ability fires (its effects follow) |
| `ward` | `to` (card ref), `on` | a ward broke (`on: false`): the damage was blocked; or the card gained a ward (`on: true`, Aegis) |
| `venom` | `src` (card ref), `to` (card ref) | venom destroys the damaged card (a `death` follows) |
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
    "1": {"name", "type", "power", "ident", "health", "maxHealth", "armor", "attack", "mana", "maxMana", "rating",
          "hand": 4, "deck": 15, "fatigue": 0, "heroPowerUsed": false, "canAttack": true, "canUsePower": true},
    "2": {}
  },
  "board": {"1": [card + canAct], "2": [card + canAct]}
}
```

`current` is the ident of the player whose turn it is, or 0 during the mulligan.

### Card JSON

```json
{"cid": 12, "id": 27, "name": "Pesta", "kind": "minion", "cost": 6, "attack": 4, "health": 5, "maxHealth": 5, "armor": 0, "level": 1,
 "rarity": 3, "ward": false, "paralyzed": false, "taunt": false, "token": false, "slotId": 2, "isDead": false,
 "hasAttacked": false, "portrait": "/Content/Images/Card/Portraits/27.jpg",
 "flavor": "Where she rakes, a few survive. Where she sweeps, nobody does.",
 "race": {"id": 1, "name": "Darkness", "cardUrl": "/Content/Images/Card/Texture/darkness.png"},
 "ability": {"id": 15, "name": "Inferno", "value": 2, "label": "Inferno 2", "activated": false,
             "text": "When played, deals 2 damage to every enemy card."}}
```

`ability.label` is what the card face prints and `ability.text` the rules text with the card's numbers filled in.

## Friendly challenges

A player who is logged in to the game server (both clients: "Friendly" in the menu, or waiting in a queue) can be
challenged by name instead of using the ranked queue; the clients open `/Game?challenge=<name>` straight into a
challenge. The 3D client declines invites while it shows the live games. Neither player may be in a game, watching one, or part of
another pending challenge (one at a time, sent or received); the challenged player may be waiting in a queue and
leaves it by accepting. Challenges are limited to a burst of 3, then one every 10 seconds per account, and expire
after 30 seconds (`Souls:Game:ChallengeTimeout`). A challenge also ends when either player disconnects or starts
another game.

Accepting starts the game at once (GameCreate to both, the first player is picked at random). Friendly games are
**unranked and earn nothing**: they are stored and listed like practice games (`practice: true`, with statistics and a
replay), but give no coins, no daily quest progress, no rating and no season points, so two accounts cannot farm them.
The result says `friendly: true` (see [End of the game](#end-of-the-game)).

## Emotes

During a game each player can send one of six emotes: 0 Greetings!, 1 Well played!, 2 Thanks!, 3 Oops!, 4 Your soul
is mine!, 5 Sorry! (also in the page config as `rules.emotes`). The server sends them to both players, the
spectators and the replay; a player who muted the opponent (MuteEmotes) no longer receives the opponent's emotes in
that game. Emotes are limited to a burst of 3, then one every 3 seconds (more are answered with a GeneralMessage).
The practice bot sometimes greets at the start.

## Replays

Every message player one receives that is public (and the spectator versions of GameCreate, NewCard and Mulligan) is recorded
with its time, and so are emotes. When the game ends the recording is stored (`game_replay`) and served as JSON by
`/Game/ReplayData/{id}`: `[{"t": ms since start, "m": {"Type", "Payload"}}]`, played back by the 3D client
(`/Game/Replay/{id}`).
