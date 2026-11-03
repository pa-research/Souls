// The Discord Activity's start page (DiscordController): Discord's Embedded App SDK asks the player to let Souls see
// their Discord account, the server exchanges the code it gets for the account and signs the player in, and the page
// goes on to the game (or, the first time, to picking a hero and starter cards).
// lib/discord/discord-sdk.js is @discord/embedded-app-sdk 2.5.0 bundled into one module (see its README.md).
import { DiscordSDK } from '/lib/discord/discord-sdk.js';

const root = document.getElementById('discord-activity');
const status = root.querySelector('[data-status]');

try {
    const sdk = new DiscordSDK(root.dataset.clientId);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({ client_id: root.dataset.clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
    const response = await fetch(root.dataset.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': root.dataset.csrf },
        body: JSON.stringify({ code }),
    });
    if (!response.ok) throw new Error(`sign-in answered ${response.status}`);
    location.replace((await response.json()).next);
} catch (error) {
    console.error(error);
    status.textContent = root.dataset.failed;
}
