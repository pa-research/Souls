// The game in the Discord Activity (the start page, discord-activity.js, left Discord's launch parameters and an access
// token in sessionStorage): what the player is doing shows as their Discord status, and the menu lists who else is in
// the channel's Activity, to challenge them, invites more friends, and links a Souls account the player already has.
import { DiscordSDK } from '/lib/discord/discord-sdk.js';
import { el, button, icon } from './ui.js';

const { t } = window.SoulsL10n;

/**
 * Connects to the Discord client around the iframe with the Activity's session ({clientId, query, accessToken});
 * null if that fails (the game goes on without it). track(getGame) keeps the player's status, channel(menu) adds the
 * channel panel to the menu.
 */
export async function connect() {
    try {
        const session = JSON.parse(sessionStorage.getItem('souls.discord'));
        // The SDK reads Discord's launch parameters (frame_id, instance_id, ...) from the address.
        const url = new URL(location.href);
        for (const [key, value] of new URLSearchParams(session.query)) if (!url.searchParams.has(key)) url.searchParams.set(key, value);
        history.replaceState(history.state, '', url);
        const sdk = new DiscordSDK(session.clientId);
        await sdk.ready();
        const auth = await sdk.commands.authenticate({ access_token: session.accessToken });
        const context = { sdk, me: auth.user.id };
        return { track: getGame => trackPresence(context, getGame), channel: menu => showChannel(context, menu) };
    } catch (error) {
        console.warn('Discord Activity:', error);
        return null;
    }
}

/** The player's Discord status, kept up to date from the game (getGame: the current game, or null in the menu). */
function trackPresence({ sdk }, getGame) {
    let last = '', since = null;
    const update = () => {
        const game = getGame();
        const playing = !!(game && game.active && !game.ended);
        since = playing ? since ?? Math.floor(Date.now() / 1000) : null;
        const activity = { type: 0, details: presenceDetails(game), ...(since ? { timestamps: { start: since } } : {}) };
        const opponent = playing && !game.spectator ? game.opponent?.hero?.info?.name : null;
        if (opponent) activity.state = t('g3d.discord.versus', { name: opponent });
        const key = JSON.stringify(activity);
        if (key === last) return;
        last = key;
        sdk.commands.setActivity({ activity }).catch(error => console.warn('Discord status:', error));
    };
    update();
    setInterval(update, 5000);
}

function presenceDetails(game) {
    if (!game) return t('g3d.discord.inMenu');
    if (game.spectator) return t('g3d.discord.watching');
    if (!game.active) return game.friendly ? t('g3d.discord.waitingFriendly') : t('g3d.discord.queueing');
    return game.normalGame ? t('g3d.discord.ranked') : game.friendly ? t('g3d.discord.friendly') : t('g3d.discord.practice');
}

/**
 * The menu's "In this channel" panel: everyone in the channel's Activity, a Challenge button for those who play Souls
 * (their names come from /Discord/Players), and an invite for more.
 */
function showChannel({ sdk, me }, menu) {
    const side = menu.querySelector('.sg-menu-side') || el('aside', 'sg-menu-side', menu);
    const panel = el('section', 's-panel sg-discord', side);
    panel.setAttribute('aria-label', t('g3d.discord.channel'));
    const head = el('div', 's-panel-head', panel);
    head.appendChild(icon('users'));
    el('h3', '', head, t('g3d.discord.channel'));
    const list = el('ul', 'sg-discord-list', panel);
    const actions = el('div', 'sg-discord-actions', panel);
    const invite = button('s-btn s-btn-ghost s-btn-sm', actions, t('g3d.discord.invite'), 'user-plus');
    invite.addEventListener('click', () => sdk.commands.openInviteDialog().catch(error => console.warn('Discord invite:', error)));
    // Discord opened a new Souls account for this player; one they already have can take its place.
    const link = el('a', 's-btn s-btn-ghost s-btn-sm', actions);
    link.href = '/Discord/Link';
    link.append(icon('login'), t('g3d.discord.link'));

    const render = async participants => {
        const others = participants.filter(p => p.id !== me);
        const names = others.length
            ? await fetch(`/Discord/Players?ids=${others.map(p => p.id).join(',')}`, { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
            : {};
        list.replaceChildren();
        if (!others.length) el('li', 's-muted s-small', list, t('g3d.discord.alone'));
        for (const p of others) {
            const item = el('li', '', list);
            const who = el('span', 'sg-discord-who', item);
            el('b', '', who, p.global_name || p.username);
            const souls = names[p.id];
            el('small', 's-muted', who, souls ? souls : t('g3d.discord.notPlaying'));
            if (souls) {
                const challenge = button('s-btn s-btn-primary s-btn-sm', item, t('g3d.discord.challenge'), 'swords');
                challenge.addEventListener('click', () => location.assign(`/Game?mode=3d&challenge=${encodeURIComponent(souls)}`));
            }
        }
    };
    sdk.commands.getInstanceConnectedParticipants().then(r => render(r.participants)).catch(error => console.warn('Discord participants:', error));
    sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', r => render(r.participants)).catch(() => { });
}
