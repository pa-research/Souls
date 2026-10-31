// Game texts in the page's language for both game clients (window.SoulsL10n). The string table comes with the page
// config (GameConfig.strings: Souls.Model/Localization/*.{language}.json, the page's language over English).
//
//   SoulsL10n.t('g3d.yourTurn')                         -> "Din tur"
//   SoulsL10n.t('log.plays', {player: 'ann', card: 'Pesta'})
//   SoulsL10n.text(event)            -> event.text in the page's language, from event.textKey / event.textArgs
//   SoulsL10n.text(msg, 'Payload')   -> a text payload: msg.PayloadKey / msg.PayloadArgs (docs/game-protocol.md)
(function () {
    'use strict';

    var config = {};
    try {
        config = JSON.parse(document.getElementById('souls-game-config').textContent);
    } catch (e) { /* no config: keys and the server's English texts */ }

    var lang = config.lang || document.documentElement.lang || 'en';
    var table = config.strings || {};
    var plurals = null;
    try { plurals = new Intl.PluralRules(lang); } catch (e) { /* old browser: one/other */ }

    function template(key, args) {
        // A key with _one/_other (and other CLDR forms) variants is picked by its n argument.
        if (args && typeof args.n === 'number' && (key + '_other') in table) {
            var form = plurals ? plurals.select(args.n) : (args.n === 1 ? 'one' : 'other');
            return table[key + '_' + form] !== undefined ? table[key + '_' + form] : table[key + '_other'];
        }
        return table[key];
    }

    function argument(value) {
        if (value && typeof value === 'object' && value.key) return t(value.key, value.args);
        return value === undefined || value === null ? '' : String(value);
    }

    /** The text of a key with its {placeholders} filled in; `fallback` (else the key) when there is no such key. */
    function t(key, args, fallback) {
        var text = template(key, args);
        if (text === undefined) return fallback !== undefined && fallback !== null ? fallback : key;
        return text.replace(/\{(\w+)\}/g, function (match, name) {
            return args && name in args ? argument(args[name]) : match;
        });
    }

    /** A text the server sent: obj[field] in English, shown from obj[field + 'Key'] and obj[field + 'Args'] (field defaults to 'text'). */
    function text(obj, field) {
        if (!obj) return '';
        field = field || 'text';
        var english = obj[field] === undefined || obj[field] === null ? '' : String(obj[field]);
        var key = obj[field + 'Key'];
        return key ? t(key, obj[field + 'Args'], english) : english;
    }

    // Practice bots are named "[BOT] <name> (<Easy|Normal|Hard>)" by the server (Matchmaker).
    var BOT_NAME = /^(\[BOT\] .+) \((Easy|Normal|Hard)\)$/;

    /**
     * A message from the server with the bots' difficulty in the page's language: every string that is a whole bot
     * name (hero names, live games, text arguments) is rewritten in place. Returns the message.
     */
    function localizeMessage(node) {
        if (node && typeof node === 'object') {
            for (var k in node) {
                if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
                var value = node[k];
                if (typeof value === 'string') {
                    var bot = BOT_NAME.exec(value);
                    if (bot) node[k] = bot[1] + ' (' + t('difficulty.' + bot[2].toLowerCase(), null, bot[2]) + ')';
                } else if (value && typeof value === 'object') {
                    localizeMessage(value);
                }
            }
        }
        return node;
    }

    /** Switches the language: the page reloads in it (posts the #sg-language form, see HomeController.Language). */
    function setLanguage(language) {
        var form = document.getElementById('sg-language');
        if (!form || language === lang) return;
        form.elements.language.value = language;
        form.submit();
    }

    window.SoulsL10n = {
        lang: lang,
        /** [{code, name}] of every language, for a settings menu. */
        languages: config.languages || [],
        t: t,
        text: text,
        has: function (key) { return key in table; },
        localizeMessage: localizeMessage,
        setLanguage: setLanguage
    };
})();
