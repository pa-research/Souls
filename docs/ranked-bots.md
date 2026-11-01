# Ranked bots: plan

Status on 1 November 2026: phases 1, 2 and 7 done (#43, #44, #49). Goal: with few players online, ranked still finds
an opponent of the right strength. When no human is waiting, the queue can match an AI opponent that plays like a
person of that rank, and the result counts for the human's rating.

## Decisions

- **No AI label** (owner, 1 November 2026, replacing an earlier decision to tag every bot): Souls is free, so its
  bots play as ordinary players. Personas have accounts, profiles and standings like anyone, and no "AI" tag. The
  practice bot stays a bot ("[BOT] Satan (Hard)").
- **Opting out** (owner, 1 November 2026): a player can choose to play ranked against people only. The setting sits
  next to the ranked button and on the profile; with it off the queue never seats a bot, and the waiting screen says
  that the wait can be longer.
- **A community of personas** (owner, 1 November 2026): about 1000 personas play each other through the day, so the
  site always has players online, games to watch and someone to challenge, at next to no cost.
- **Ratings**: Glicko-2 instead of Elo (phase 1). A rating carries its uncertainty, so new and returning players
  reach their rank in a few games, which matters when few people play.
- **Bots anchor the scale** (phase 4): a bot in ranked has a fixed rating, its measured strength, which games do not
  change; a human's rating moves against it as against a person.
- **Cheap**: one bot per human who is playing one, no model running in the live game, search budget by rank and a
  cap on concurrent searches.

## What exists

Elo (K 32, start 1000, 50 points a rank, Bronze III to Champion), matchmaking whose rating window widens with the
wait (`Ratings.MatchWindow`), a practice bot with three levels (`Ai/AiPlayer.cs`: Easy random, Normal greedy, Hard
one-turn lookahead with a 10 000-action budget), the bot-versus-bot simulator (`tools/Souls.Sim`), stored replays of
every game, and the opponent's card drags shown in both clients (`MoveCard`).

## Phases (one pull request each)

1. **Glicko-2**: rating, deviation and volatility per player, the deviation growing while a player is away and
   raised at a season reset; a floor of 75 keeps a settled player at about ±15 a game, as with Elo.
2. **Skill dial**: one number from 0 to 1 sets the bot's search budget, how often it takes a worse move (a softmax
   over the move scores), rank-typical mistakes (missing lethal, bad trades, overextending into a board clear) and
   deck quality. `Souls.Sim` plays round robins between dial settings and fits ratings; done when strength rises
   steadily over the 16 ranks (50 points: 57 % for the stronger side).
3. **Like a person**: think time from a log-normal that grows with the number of choices, card drags and hesitation
   over targets (`MoveCard`), mulligans and hero powers by rank, decks from a collection a player of that rank owns,
   emotes by personality and situation (muting respected), conceding when the game is lost now and then. Stored
   replays give the timing and choices of real players by rank.
4. **Bots in ranked**: about 200 persona accounts (name, favourite class, rank band, style, collection, match
   history, profile; system accounts, so off the standings), a bot only after a realistic wait (20-60 s, longer high
   up) and never when a human is waiting, a persona close to the player's rating, challenges declined. The disclosure
   and the opt-out above ship with this phase.
5. **Live calibration**: the bots' score against humans per rank band against the 50 % target, a daily nudge of the
   dial per band, flags for players who beat bots far above expectation (an exploit), an admin page, metrics.
6. **Validation**: play-testers guess which opponents were bots; bot timing compared with real replays.
7. **AI community**: each persona gets a home time zone and play hours, so the lobby has a daily rhythm. Online
   personas play each other in the background (headless, as in `Souls.Sim`; thousands of games a day cost seconds),
   so their streaks, histories and collections grow, their decks change and they move on an AI ladder beside the
   human one (a rating of its own: the fixed rating that anchors ranked does not move). An activity feed ("Morgana
   (AI) reached Gold I"), some bot games played at human pace for players to watch, bots that accept challenges.
   "Players online" and "AI online" are separate counts.

   Built (`Ai/AiCommunity.cs`): 200 personas (`persona` table, `player.is_ai`) made at the server's first start, each
   with a skill whose rating it starts at (`BotSkill.RatingOf`), a collection that grows with the skill and a themed
   deck; online five days in seven in its hours, by its time zone (most in Norway's, mostly evenings). Every 30 s
   (`Souls:Community`) the free online personas start games away at about 3 an hour each, against one of the three
   closest in rating, on a server of their own (headless, stored without a log or replay, rated on Glicko-2 like
   players). The matchmaker keeps 2 of their games on the server at human pace for players to watch and has a persona
   accept a challenge after 3 s. A win brings a new card one time in five (and a new deck); a new tier, a streak of
   five, ten... and a new card go to the feed (`ai_event`, kept 14 days). Phase 4 can build its ranked personas on these
   accounts: the fixed rating that anchors ranked is `BotSkill.RatingOf(skill)`, not the AI ladder's.

## Risks

- Miscalibrated bots move every human rating: phase 5 is part of the feature, not an extra.
- Few humans means little data at first: the dial table rests on the simulator until real games arrive.
- An exploitable bot habit lets players farm rating and rewards: the abuse checks of phase 5 come before bots enter
  ranked at scale.
- Personas share the leaderboard with players: the top of the table is mostly personas while few people play.
