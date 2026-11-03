# Discord Embedded App SDK

`discord-sdk.js` is [@discord/embedded-app-sdk](https://www.npmjs.com/package/@discord/embedded-app-sdk) 2.5.0 (MIT,
`LICENSE.md`) with its dependencies, bundled into one ES module for the Discord Activity's start page
(`Scripts/discord-activity.js`). It contains no `eval`, so the site's CSP (`script-src 'self'`) holds. To update it:

```bash
npm install --ignore-scripts @discord/embedded-app-sdk@<version> esbuild
echo "export { DiscordSDK, Events, Platform, patchUrlMappings } from '@discord/embedded-app-sdk';" > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --minify --legal-comments=eof --target=es2022 --outfile=discord-sdk.js
```
