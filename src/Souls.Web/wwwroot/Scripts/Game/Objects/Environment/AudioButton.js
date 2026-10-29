// Sound on / off for the classic client (switched in the settings panel, see Settings.js; this replaces the old
// audio on/off image button). Muting sets the SoundJS master volume to 0, as the old button did. The choice is
// remembered per browser under the key the 3D client uses too, so both clients share it.
define("audio", ["asset"], function (Asset) {

    var STORAGE_KEY = 'souls.muted';

    function Read() {
        try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
    }

    function Write(muted) {
        try { window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch (e) { /* storage is optional */ }
    }

    var muted = Read();

    var Sound = {
        IsMuted: function () {
            return muted;
        },

        SetMuted: function (value) {
            muted = !!value;
            Write(muted);
            this.Apply();
            return muted;
        },

        Toggle: function () {
            return this.SetMuted(!muted);
        },

        /// Applies the remembered choice (at start-up, before the first sound plays).
        Apply: function () {
            try { Asset.SetVolume(muted ? 0 : 1); } catch (e) { /* sound is optional */ }
        }
    };

    return Sound;
});
