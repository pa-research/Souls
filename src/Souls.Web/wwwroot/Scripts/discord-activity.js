// The Discord Activity's start page (DiscordController): Discord's Embedded App SDK asks the player to let Souls see
// their Discord account and set their status, the server exchanges the code it gets for the account and signs the
// player in, and the page goes on to the game (or, the first time, to picking a hero and starter cards). The game
// reconnects to Discord with what it leaves in sessionStorage (Game3D/discord.js).
// lib/discord/discord-sdk.js is @discord/embedded-app-sdk 2.5.0 bundled into one module (see its README.md).
import { DiscordSDK } from '/lib/discord/discord-sdk.js';

const root = document.getElementById('discord-activity');
const status = root.querySelector('[data-status]');

try {
    const sdk = new DiscordSDK(root.dataset.clientId);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({ client_id: root.dataset.clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify', 'rpc.activities.write'] });
    const response = await fetch(root.dataset.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': root.dataset.csrf },
        body: JSON.stringify({ code }),
    });
    if (!response.ok) throw new Error(`sign-in answered ${response.status}`);
    const { next, accessToken } = await response.json();
    sessionStorage.setItem('souls.discord', JSON.stringify({ clientId: root.dataset.clientId, query: location.search, accessToken }));
    location.replace(next);
} catch (error) {
    console.error(error);
    status.textContent = root.dataset.failed;
}
